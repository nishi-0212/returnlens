"""Root-cause investigation.

For every recurring complaint group on a product, test where the problem concentrates:

* batch      – is it much worse in one manufacturing batch than in the product's other batches?
* supplier   – … from one supplier?
* carrier    – … with one carrier?
* warehouse  – … from one fulfilment centre?
* changes    – did it jump after a listing update, supplier change, packaging change or size-chart update?

Each test compares the complaint rate (complaint units / ordered units) inside vs outside the
group with a two-proportion z-test. The strongest *expected* explanation for that kind of
complaint wins (e.g. a carrier for delivery damage, a batch for defects).

Status rules (never stronger than the evidence):
* confirmed – a strong statistical pattern AND an independent record that documents the cause itself:
              a failed/deviating inspection report for that batch or supplier, or the carrier's own
              damage scans on the affected shipments.
* likely    – a strong, significant pattern (p < 0.01, at least 2x, 8+ complaints) without such a record.
* possible  – a weaker or small-sample pattern, or a problem spread across the product with no clear source.
A correlation alone is never reported as a confirmed supplier or manufacturing defect.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import pandas as pd

from .clustering import CATEGORIES, normalize
from .dataset import Data, iso
from .stats import finite, lift, rate, z_test

MIN_COMPLAINTS = 5
CHANGE_WINDOW_DAYS = 90
MATURITY_DAYS = 14

CAUSES = {
    "manufacturing": "Manufacturing / batch quality",
    "supplier_change": "Supplier change",
    "packaging": "Packaging",
    "shipping": "Shipping / carrier handling",
    "product_description": "Product listing / description",
    "sizing": "Sizing information",
    "fulfillment": "Fulfilment / picking",
}
# which explanations fit each complaint group, strongest first
PREFERENCE = {
    "defective": [("batch", "manufacturing"), ("change:supplier_change", "supplier_change"), ("supplier", "manufacturing"),
                  ("carrier", "shipping")],
    "quality": [("batch", "manufacturing"), ("change:supplier_change", "supplier_change"), ("supplier", "manufacturing")],
    "missing_parts": [("batch", "manufacturing"), ("warehouse", "fulfillment"), ("change:packaging_change", "packaging"),
                      ("supplier", "manufacturing")],
    "packaging_damage": [("change:packaging_change", "packaging"), ("carrier", "shipping"), ("warehouse", "packaging"),
                         ("batch", "packaging")],
    "delivery_damage": [("carrier", "shipping"), ("change:packaging_change", "packaging"), ("warehouse", "shipping"),
                        ("change:carrier_change", "shipping")],
    "not_as_described": [("change:listing_update", "product_description"), ("change:supplier_change", "supplier_change"),
                         ("batch", "manufacturing"), ("supplier", "supplier_change")],
    "sizing": [("change:supplier_change", "supplier_change"), ("supplier", "supplier_change"),
               ("change:size_chart_update", "sizing"), ("change:listing_update", "sizing"), ("batch", "manufacturing")],
    "wrong_item": [("warehouse", "fulfillment"), ("batch", "fulfillment")],
    "late_delivery": [("carrier", "shipping"), ("warehouse", "shipping")],
}
SPREAD_CAUSE = {"defective": "manufacturing", "quality": "manufacturing", "missing_parts": "manufacturing",
                "packaging_damage": "packaging", "delivery_damage": "shipping", "not_as_described": "product_description",
                "sizing": "sizing", "wrong_item": "fulfillment", "late_delivery": "shipping"}
CORROBORATING_TERMS = {
    "defective": r"defect|fail|fault|misalign|contact|charg|solder|dead|short",
    "quality": r"defect|fail|stitch|seam|material|thin|colou?r|fade",
    "missing_parts": r"missing|incomplete|kit|component|accessor|seal|lid|count",
    "sizing": r"size|sizing|length|short|narrow|last|width|measure|mm|fit",
    "not_as_described": r"colou?r|shade|fabric|material|composition|spec",
    "packaging_damage": r"packag|box|carton|drop.?test",
}
ALTERNATIVES = {
    "manufacturing": ["Rough handling in transit can look like a product fault; check the carrier mix of the affected orders.",
                      "A single bad component lot inside the batch, rather than the whole batch.",
                      "Customer misuse or unclear instructions, if setup instructions changed in the same period."],
    "supplier_change": ["A listing or size-chart change at around the same time.",
                        "One bad batch from the new supplier rather than the supplier as a whole.",
                        "A different customer mix after the change (promotions, new markets)."],
    "packaging": ["A carrier or hub handling problem in the same period.",
                  "The product itself became more fragile (new material or a new batch).",
                  "Seasonal volume peaks causing rushed packing."],
    "shipping": ["Packaging that is too weak for this carrier's network rather than careless handling.",
                 "Damage at one hub or route rather than the carrier overall.",
                 "Fragile items being sent with this carrier more often than with others."],
    "product_description": ["The product itself changed (new batch or supplier) rather than the listing.",
                            "Colour differences caused by screens and lighting.",
                            "New customers from a promotion with different expectations."],
    "sizing": ["The listing's size guidance is unclear rather than the product being off-spec.",
               "The product's measurements changed at the supplier.",
               "Customers buying different sizes than before."],
    "fulfillment": ["Mislabelled stock arriving from the supplier.", "Look-alike products stored next to each other."],
}
MISSING = {
    "manufacturing": ["Test results for returned units (what exactly failed).",
                      "Supplier's own QC records for the batch."],
    "supplier_change": ["A side-by-side QA comparison of old and new supplier units (measurements, materials).",
                        "The new supplier's spec sheet."],
    "packaging": ["Packaging spec or drop-test results before and after the change.", "Photos of damaged returns."],
    "shipping": ["The carrier's damage claims or exception scans.", "Hub/route for each affected shipment."],
    "product_description": ["Listing version history (old vs new photos and text).",
                            "A spec or lab sheet for the actual colour/material."],
    "sizing": ["Measured product dimensions vs the size chart.", "The size each customer bought and usually wears."],
    "fulfillment": ["Pick/pack logs for the affected orders."],
}


@dataclass
class Test:
    dimension: str      # batch | supplier | carrier | warehouse | change:<type>
    value: str          # batch id, supplier id, carrier, warehouse, change id
    k_in: float
    n_in: float
    k_out: float
    n_out: float
    p: float
    lift: float
    label: str = ""
    since: pd.Timestamp | None = None   # change date
    extra: dict[str, Any] = field(default_factory=dict)
    n_tests: int = 1                    # tests run for this product + complaint group (multiple-testing correction)

    @property
    def p_adj(self) -> float:
        return min(1.0, self.p * max(1, self.n_tests))

    @property
    def rate_in(self) -> float:
        return rate(self.k_in, self.n_in)

    @property
    def rate_out(self) -> float:
        return rate(self.k_out, self.n_out)

    def strong(self) -> bool:
        return self.p_adj < 0.01 and self.lift >= 2 and self.k_in >= 8

    def significant(self) -> bool:
        return self.p_adj < 0.05 and self.lift >= 1.5 and self.k_in >= 5


def _group_tests(o: pd.DataFrame, r: pd.DataFrame, col: str, dim: str) -> list[Test]:
    o = o[o[col].notna() & (o[col] != "Unknown")]
    if o[col].nunique() < 2:
        return []
    units = o.groupby(col)["qty"].sum()
    comp = r.groupby(col)["qty"].sum()
    tu, tk = float(units.sum()), float(comp.sum())
    out = []
    for v, n in units.items():
        k = float(comp.get(v, 0))
        if n < 30 or tu - n < 30:
            continue
        _, p = z_test(k, n, tk - k, tu - n)
        out.append(Test(dim, str(v), k, float(n), tk - k, tu - n, p, finite(lift(k, n, tk - k, tu - n))))
    return out


def _change_tests(o: pd.DataFrame, r: pd.DataFrame, changes: pd.DataFrame, sku: str, end: pd.Timestamp) -> list[Test]:
    out = []
    ch = changes[(changes["sku"] == sku) | (changes["sku"].isna())].dropna(subset=["date"])
    mature_end = end - timedelta(days=MATURITY_DAYS)
    for _, c in ch.iterrows():
        t = c["date"]
        b0, a1 = t - timedelta(days=CHANGE_WINDOW_DAYS), min(t + timedelta(days=CHANGE_WINDOW_DAYS), mature_end)
        if a1 <= t + timedelta(days=14):
            continue
        ob, oa = o[(o["order_date"] >= b0) & (o["order_date"] < t)], o[(o["order_date"] >= t) & (o["order_date"] < a1)]
        rb, ra = r[(r["cohort_date"] >= b0) & (r["cohort_date"] < t)], r[(r["cohort_date"] >= t) & (r["cohort_date"] < a1)]
        nb, na, kb, ka = float(ob["qty"].sum()), float(oa["qty"].sum()), float(rb["qty"].sum()), float(ra["qty"].sum())
        if nb < 30 or na < 30:
            continue
        _, p = z_test(ka, na, kb, nb)
        out.append(Test(f"change:{c['change_type']}", str(c["change_id"]), ka, na, kb, nb, p, finite(lift(ka, na, kb, nb)),
                        label=c.get("description") or c.get("label") or c["change_type"], since=t,
                        extra={"change_type": c["change_type"], "date": iso(t), "description": c.get("description")}))
    return out


def _corroboration(cluster: str, best: Test, d: Data, sku: str, rs: pd.DataFrame, os_: pd.DataFrame) -> list[dict[str, Any]]:
    """Independent records that document the cause itself (not just a correlation)."""
    found: list[dict[str, Any]] = []
    terms = CORROBORATING_TERMS.get(cluster)
    ins = d.inspections
    if not ins.empty and terms is not None:
        cand = pd.DataFrame()
        if best.dimension == "batch":
            cand = ins[ins["batch_id"] == best.value]
        elif best.dimension in ("supplier", "change:supplier_change"):
            new_sup = best.value if best.dimension == "supplier" else None
            batches = d.orders[(d.orders["sku"] == sku)]
            if best.since is not None:
                batches = batches[batches["order_date"] >= best.since]
            if new_sup:
                batches = batches[batches["supplier_id"] == new_sup]
            cand = ins[ins["batch_id"].isin(set(batches["batch_id"].dropna()))]
        for _, row in cand.iterrows():
            text = f"{row.get('findings') or ''}"
            bad = row.get("result") in ("fail", "conditional")
            matches = bool(re.search(terms, text, re.I))
            if (bad and matches) or (matches and re.search(r"deviat|out of (spec|tolerance)|shorter|longer|below spec", text, re.I)):
                found.append({"type": "inspection", "id": row["inspection_id"], "batch": row.get("batch_id"),
                              "result": row.get("result"), "defect_rate": row.get("defect_rate"),
                              "text": normalize(text)[:400], "date": iso(row.get("date")), "source": row.get("source")})
    if best.dimension == "carrier" and cluster in ("delivery_damage", "packaging_damage"):
        aff = rs[rs["carrier"] == best.value]
        flagged = aff[aff["damaged"] == True]  # noqa: E712
        if len(aff) >= 5 and len(flagged) / len(aff) >= 0.5:
            found.append({"type": "carrier_scans", "id": f"{best.value} damage scans",
                          "text": f"The carrier recorded damage on {len(flagged)} of {len(aff)} affected shipments "
                                  f"({len(flagged) / len(aff):.0%}).", "count": int(len(flagged)), "of": int(len(aff))})
    return found


def _status(best: Test | None, corroborated: bool, spread_significant: bool) -> tuple[str, float]:
    if best is None:
        return ("possible", 0.35) if spread_significant else ("", 0.0)
    strength = min(1.0, -math.log10(max(best.p_adj, 1e-12)) / 8) * 0.5 + min(1.0, best.k_in / 40) * 0.3 + min(1.0, best.lift / 6) * 0.2
    if best.strong() and corroborated:
        return "confirmed", round(0.8 + 0.15 * strength, 2)
    if best.strong():
        return "likely", round(0.55 + 0.25 * strength, 2)
    return "possible", round(0.3 + 0.25 * strength, 2)


def _weekly(o: pd.DataFrame, r: pd.DataFrame, start: pd.Timestamp | None = None) -> list[dict[str, Any]]:
    if o.empty:
        return []
    per = lambda s: s.dt.tz_convert(None).dt.to_period("W-MON").dt.start_time  # noqa: E731
    if start is not None:
        o, r = o[o["order_date"] >= start], r[r["cohort_date"] >= start]
    u = o.groupby(per(o["order_date"]))["qty"].sum()
    k = r.groupby(per(r["cohort_date"]))["qty"].sum() if not r.empty else pd.Series(dtype=float)
    return [{"period": p.date().isoformat(), "units": int(n), "complaints": int(k.get(p, 0)),
             "rate": round(rate(float(k.get(p, 0)), float(n)), 4)} for p, n in u.items()]


def _record(row: pd.Series, kind: str) -> dict[str, Any]:
    if kind == "return":
        return {"type": "return", "id": row["return_id"], "date": iso(row.get("return_date")), "order_id": row.get("order_id"),
                "sku": row.get("sku"), "batch": row.get("batch_id"), "carrier": row.get("carrier"),
                "supplier": row.get("supplier_id"), "text": row.get("comment") or row.get("reason"),
                "reason": row.get("reason"), "damaged_scan": bool(row.get("damaged") is True)}
    return {"type": "review", "id": row["review_id"], "date": iso(row.get("date")), "sku": row.get("sku"),
            "rating": row.get("rating"), "text": row.get("text")}


def investigate(d: Data, returns_with_costs: pd.DataFrame, labels: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    """Return findings (plain dicts ready to store)."""
    if d.orders.empty or returns_with_costs.empty:
        return []
    end = d.end
    r_all = returns_with_costs
    findings: dict[str, dict[str, Any]] = {}
    sup_label = labels.get("supplier_id", {})
    sku_label = labels.get("sku", {})
    for cluster, prefs in PREFERENCE.items():
        rc = r_all[r_all["cluster"] == cluster]
        if len(rc) < MIN_COMPLAINTS:
            continue
        cluster_rate_all = rate(rc["qty"].sum(), d.orders["qty"].sum())
        for sku, rs in rc.groupby("sku"):
            if len(rs) < 4:
                continue
            os_ = d.orders[d.orders["sku"] == sku]
            rs_m = rs[rs["matched"]]
            tests: list[Test] = []
            tests += _group_tests(os_, rs_m, "batch_id", "batch")
            tests += _group_tests(os_, rs_m, "supplier_id", "supplier")
            tests += _group_tests(os_, rs_m, "carrier", "carrier")
            tests += _group_tests(os_, rs_m, "warehouse", "warehouse")
            tests += _change_tests(os_, rs_m, d.changes, sku, end)
            for t in tests:  # Bonferroni: many places were checked, so each needs stronger evidence
                t.n_tests = len(tests)
            best: Test | None = None
            cause = None
            for dim, c in prefs:
                cands = [t for t in tests if t.dimension == dim and t.significant() and t.lift > 1]
                if cands:
                    best = min(cands, key=lambda t: (t.p, -t.lift))
                    cause = c
                    break
            # a supplier change seen through batches/supplier column counts as a supplier change
            if best is not None and best.dimension == "supplier" and cluster in ("sizing", "not_as_described"):
                cause = "supplier_change"
            # is the problem at least unusually high on this product overall?
            other = r_all[(r_all["cluster"] == cluster) & (r_all["sku"] != sku)]
            other_units = d.orders[d.orders["sku"] != sku]["qty"].sum()
            k_s, n_s = float(rs["qty"].sum()), float(os_["qty"].sum())
            _, p_spread = z_test(k_s, n_s, float(other["qty"].sum()), float(other_units))
            spread_sig = p_spread < 0.01 and k_s >= 8 and rate(k_s, n_s) >= 2 * rate(other["qty"].sum(), other_units)
            if best is None and not spread_sig:
                continue
            cause = cause or SPREAD_CAUSE.get(cluster, "manufacturing")
            corro = _corroboration(cluster, best, d, sku, rs_m, os_) if best is not None else []
            status, conf = _status(best, bool(corro), spread_sig)
            if not status:
                continue

            # the returns this finding explains
            if best is None:
                scope_r = rs
                scope_desc = "across all batches, suppliers and carriers"
                dim, val = "product", sku
            elif best.dimension.startswith("change:"):
                scope_r = rs[rs["cohort_date"] >= best.since]
                scope_desc = f"since {best.extra.get('date')}"
                dim, val = best.dimension, best.value
            else:
                col = {"batch": "batch_id", "supplier": "supplier_id", "carrier": "carrier", "warehouse": "warehouse"}[best.dimension]
                scope_r = rs[rs[col] == best.value]
                scope_desc = {"batch": f"batch {best.value}", "supplier": f"supplier {sup_label.get(best.value, best.value)}",
                              "carrier": f"carrier {best.value}", "warehouse": f"warehouse {best.value}"}[best.dimension]
                dim, val = best.dimension, best.value
            merge_key = f"{cause}|{dim}:{val}|{cluster}" if dim in ("carrier", "warehouse", "supplier") else f"{cause}|{dim}:{val}|{cluster}|{sku}"
            label_c = CATEGORIES[cluster]["label"]
            prod = sku_label.get(sku, sku)
            f = findings.get(merge_key)
            if f is None:
                f = {"key": merge_key, "cluster": cluster, "cluster_label": label_c, "cause": cause, "cause_label": CAUSES[cause],
                     "status": status, "confidence": conf, "dimension": dim, "value": val, "skus": [], "products": [],
                     "tests": [], "evidence": {"returns": [], "reviews": [], "inspections": [], "shipments": [],
                                               "changes": []},
                     "corroborated": bool(corro), "return_ids": [], "series": [], "scope_desc": scope_desc,
                     "change_date": best.extra.get("date") if best is not None and best.since is not None else None}
                findings[merge_key] = f
            else:  # merged across products: keep the strongest status/confidence
                order = ["possible", "likely", "confirmed"]
                if order.index(status) > order.index(f["status"]):
                    f["status"], f["confidence"] = status, conf
                f["corroborated"] = f["corroborated"] or bool(corro)
            f["skus"].append(sku)
            f["products"].append(prod)
            f["return_ids"] += scope_r["return_id"].tolist()
            sku_tests = sorted([t for t in tests if t.k_in > 0], key=lambda t: t.p)[:8]
            f["tests"] += [{"sku": sku, "dimension": t.dimension, "value": t.value,
                            "value_label": sup_label.get(t.value, t.label or t.value), "complaints": int(t.k_in),
                            "units": int(t.n_in), "rate": round(t.rate_in, 4), "rate_elsewhere": round(t.rate_out, 4),
                            "lift": t.lift, "p_value": round(t.p, 5), "p_adjusted": round(t.p_adj, 5),
                            "chosen": best is t} for t in sku_tests]
            if best is None:
                f["tests"].insert(0, {"sku": sku, "dimension": "product", "value": sku, "value_label": prod,
                                      "complaints": int(k_s), "units": int(n_s), "rate": round(rate(k_s, n_s), 4),
                                      "rate_elsewhere": round(rate(other["qty"].sum(), other_units), 4),
                                      "lift": finite(lift(k_s, n_s, other["qty"].sum(), other_units)),
                                      "p_value": round(p_spread, 5), "chosen": True})
            ev = f["evidence"]
            ev["returns"] += [_record(x, "return") for _, x in scope_r.sort_values("return_date", ascending=False).head(10).iterrows()]
            rv = d.reviews[(d.reviews["cluster"] == cluster) & (d.reviews["sku"] == sku)]
            ev["reviews"] += [_record(x, "review") for _, x in rv.sort_values("date", ascending=False).head(4).iterrows()]
            ev["inspections"] += [c for c in corro if c["type"] == "inspection"]
            ev["shipments"] += [c for c in corro if c["type"] == "carrier_scans"]
            if best is not None and best.since is not None:
                ev["changes"].append({"type": "change", "id": best.value, **best.extra})
            ev["changes"] += [{"type": "change", "id": c["change_id"], "date": iso(c["date"]), "change_type": c["change_type"],
                               "description": c.get("description"), "context": True}
                              for _, c in d.changes[(d.changes["sku"] == sku)].iterrows()
                              if best is None or c["change_id"] != best.value]
            if best is not None and best.dimension.startswith("change:") and not f["series"]:
                start = best.since - timedelta(days=CHANGE_WINDOW_DAYS)
                f["series"] = _weekly(os_, rs_m, start)
            elif not f["series"]:
                f["series"] = _weekly(os_, rs_m)
            f.setdefault("_best", []).append((sku, best, k_s, n_s, cluster_rate_all, rs, corro))

    out = []
    for f in findings.values():
        _write_text(f, sup_label)
        f.pop("_best", None)
        f["return_ids"] = sorted(set(f["return_ids"]))
        chosen = [t for t in f["tests"] if t.get("chosen")] or f["tests"][:1]
        if chosen:  # headline numbers for charts: the explanation's rate vs elsewhere, across its products
            n = sum(t["units"] for t in chosen) or 1
            f["rate"] = round(sum(t["rate"] * t["units"] for t in chosen) / n, 4)
            f["rate_elsewhere"] = round(sum(t["rate_elsewhere"] * t["units"] for t in chosen) / n, 4)
            f["lift"] = round(float(max(finite(t["lift"]) for t in chosen)), 2)
        out.append(f)
    order = {"confirmed": 0, "likely": 1, "possible": 2}
    out.sort(key=lambda x: (order[x["status"]], -x["confidence"]))
    return out


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _write_text(f: dict[str, Any], sup_label: dict[str, str]) -> None:
    """Plain-language title, summary, alternatives and missing data, built only from computed facts."""
    sku, best, k_s, n_s, base, rs, corro = f["_best"][0]
    prods = " and ".join(dict.fromkeys(f["products"]))
    cl = f["cluster_label"].lower()
    cause = f["cause"]
    if best is None:
        f["title"] = f"{f['cluster_label']} on {prods}"
        f["summary"] = (f"{_pct(rate(k_s, n_s))} of {prods} units come back for {cl}, vs {_pct(base)} across the store, "
                        f"but it isn't concentrated in any batch, supplier, carrier or recent change.")
    else:
        verb = {"batch": f"batch {best.value}", "supplier": f"units from {sup_label.get(best.value, best.value)}",
                "carrier": f"orders shipped with {best.value}", "warehouse": f"orders from warehouse {best.value}"}
        if best.dimension.startswith("change:"):
            what = best.extra.get("description") or best.extra.get("change_type")
            f["title"] = f"{f['cluster_label']} on {prods} rose after the {best.extra.get('change_type', 'change').replace('_', ' ')} on {best.extra.get('date')}"
            f["summary"] = (f"Since {best.extra.get('date')} ({what}), {_pct(best.rate_in)} of {prods} units come back for {cl}, "
                            f"up from {_pct(best.rate_out)} in the {CHANGE_WINDOW_DAYS} days before ({best.lift:.1f}x).")
        else:
            subject = verb[best.dimension]
            multi = len(set(f["skus"])) > 1
            parts = [b for (_, b, *_rest) in f["_best"] if b is not None]
            ki, ni = sum(b.k_in for b in parts), sum(b.n_in for b in parts)
            ko, no = sum(b.k_out for b in parts), sum(b.n_out for b in parts)
            f["title"] = f"{f['cluster_label']} concentrated in {subject}" + ("" if multi else f" ({prods})")
            f["summary"] = (f"{_pct(rate(ki, ni))} of {subject} of {prods} come back for {cl}, vs {_pct(rate(ko, no))} "
                            f"for the rest ({finite(lift(ki, ni, ko, no)):.1f}x, {int(ki)} complaints).")
        if f["corroborated"]:
            docs = [c for c in corro]
            if docs:
                c = docs[0]
                f["summary"] += (f" Inspection {c['id']} ({c.get('result')}) documents it: \"{c['text'][:160]}\""
                                 if c["type"] == "inspection" else f" {c['text']}")
    f["status_reason"] = {
        "confirmed": "A strong pattern plus an independent record that documents the cause itself.",
        "likely": "A strong, statistically significant pattern, but no record that directly documents the cause. "
                  "Treat it as a lead to verify, not a proven defect.",
        "possible": "A weaker or small-sample pattern. Worth watching; don't act on it alone.",
    }[f["status"]]
    alts = list(ALTERNATIVES.get(cause, []))
    if best is not None and not best.dimension.startswith("change:"):
        carriers = rs["carrier"].value_counts(normalize=True)
        if cause == "manufacturing" and len(carriers) and carriers.iloc[0] > 0.6:
            alts.insert(0, f"{carriers.index[0]} carried {carriers.iloc[0]:.0%} of the affected orders; transit damage "
                           f"should be ruled out.")
    ctx = [c for c in f["evidence"]["changes"] if c.get("context")]
    if ctx:
        alts.append("Other changes on this product: " + "; ".join(f"{c['date']} {c['change_type'].replace('_', ' ')}"
                                                                    for c in ctx[:3]) + ".")
    f["alternatives"] = alts[:4]
    missing = list(MISSING.get(cause, []))
    if cause in ("manufacturing", "supplier_change") and not f["evidence"]["inspections"]:
        target = f"batch {best.value}" if best is not None and best.dimension == "batch" else "the affected batches"
        missing.insert(0, f"No inspection report that documents the problem for {target}. Upload one to confirm or rule "
                          f"out a defect.")
    if cause == "shipping" and not f["evidence"]["shipments"]:
        missing.insert(0, "Shipment records don't show carrier damage scans for these orders.")
    unmatched = int((~rs["matched"]).sum())
    if unmatched:
        missing.append(f"{unmatched} of these returns couldn't be linked to an order, so their batch and carrier are unknown.")
    f["missing_data"] = missing[:4]
    f["skus"] = sorted(set(f["skus"]))
    f["products"] = sorted(set(f["products"]))
