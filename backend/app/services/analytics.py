"""Return analytics: rates, breakdowns, trends, baselines and unusual increases.

Return rate = returned units / ordered units, counted by the *order* date (cohort). That way an
order and its return always fall in the same period, which is what before/after comparisons need.
Orders from the last ~2 weeks are still collecting returns, so those weeks are marked "maturing"
and left out of baseline and spike tests.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import pandas as pd

from . import costs as costmod
from .clustering import CATEGORIES
from .dataset import Data, iso
from .stats import finite, lift, rate, z_test

MATURITY_DAYS = 14
CURRENT_DAYS = 30
BASELINE_DAYS = 90


@dataclass
class Filters:
    date_from: pd.Timestamp | None = None
    date_to: pd.Timestamp | None = None
    sku: str | None = None
    category: str | None = None
    supplier: str | None = None
    batch: str | None = None
    cluster: str | None = None
    cause: str | None = None

    @classmethod
    def parse(cls, **kw: Any) -> "Filters":
        def t(v):
            if not v:
                return None
            x = pd.Timestamp(v)
            return x.tz_localize("UTC") if x.tzinfo is None else x
        return cls(date_from=t(kw.get("date_from")), date_to=t(kw.get("date_to")),
                   **{k: (kw.get(k) or None) for k in ("sku", "category", "supplier", "batch", "cluster", "cause")})

    def as_dict(self) -> dict[str, Any]:
        return {k: (iso(v) if isinstance(v, pd.Timestamp) else v) for k, v in self.__dict__.items() if v is not None}


def scoped(d: Data, f: Filters, with_dates: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Orders, returns and reviews inside the filters. Cluster/cause filters narrow returns only."""
    o, r, v = d.orders, d.returns, d.reviews
    if with_dates and f.date_from is not None:
        o, r = o[o["order_date"] >= f.date_from], r[r["cohort_date"] >= f.date_from]
        v = v[v["date"] >= f.date_from]
    if with_dates and f.date_to is not None:
        end = f.date_to + timedelta(days=1)
        o, r = o[o["order_date"] < end], r[r["cohort_date"] < end]
        v = v[v["date"] < end]
    for col, val in (("sku", f.sku), ("category", f.category), ("supplier_id", f.supplier), ("batch_id", f.batch)):
        if val:
            o, r = o[o[col] == val], r[r[col] == val]
            if col in v:
                v = v[v[col] == val]
    if f.cluster:
        r, v = r[r["cluster"] == f.cluster], v[v["cluster"] == f.cluster]
    if f.cause and "cause" in r:
        r = r[r["cause"] == f.cause]
        v = v[v["cluster"].map(lambda c: CATEGORIES.get(c, {}).get("cause")) == f.cause]
    return o, r, v


def _group_rates(o: pd.DataFrame, r: pd.DataFrame, col: str) -> pd.DataFrame:
    units = o.groupby(o[col].fillna("Unknown"))["qty"].sum().rename("units")
    orders = o.groupby(o[col].fillna("Unknown"))["order_id"].nunique().rename("orders")
    ret = r.groupby(r[col].fillna("Unknown"))["qty"].sum().rename("returned")
    refunds = r.groupby(r[col].fillna("Unknown"))["refund"].sum().rename("refunds") if "refund" in r else None
    cost = r.groupby(r[col].fillna("Unknown"))["cost_total"].sum().rename("cost") if "cost_total" in r else None
    parts = [units, orders, ret] + [p for p in (refunds, cost) if p is not None]
    g = pd.concat(parts, axis=1).fillna(0)
    g["rate"] = g["returned"] / g["units"].where(g["units"] > 0)
    return g


def baseline_windows(d: Data, f: Filters) -> dict[str, pd.Timestamp] | None:
    end = d.end
    if end is None:
        return None
    if f.date_from is not None and f.date_to is not None:
        cur_start, cur_end = f.date_from, f.date_to + timedelta(days=1)
        span = cur_end - cur_start
        base_end, base_start = cur_start, cur_start - span * 3
    else:
        cur_end = end - timedelta(days=MATURITY_DAYS) + timedelta(days=1)
        cur_start = cur_end - timedelta(days=CURRENT_DAYS)
        base_end, base_start = cur_start, cur_start - timedelta(days=BASELINE_DAYS)
    return {"current_start": cur_start, "current_end": cur_end, "baseline_start": base_start, "baseline_end": base_end}


def compare_baseline(d: Data, f: Filters, cols: tuple[str, ...] = ("sku", "supplier_id", "category", "carrier"),
                     labels: dict[str, dict[str, str]] | None = None) -> dict[str, Any]:
    """Current period vs historical baseline for each entity, flagging unusual increases."""
    w = baseline_windows(d, f)
    if not w:
        return {"windows": None, "rows": [], "spikes": []}
    no_dates = Filters(**{**f.__dict__, "date_from": None, "date_to": None})
    o, r, _ = scoped(d, no_dates, with_dates=False)
    in_w = lambda df, col, a, b: df[(df[col] >= a) & (df[col] < b)]  # noqa: E731
    oc, rc = in_w(o, "order_date", w["current_start"], w["current_end"]), in_w(r, "cohort_date", w["current_start"], w["current_end"])
    ob, rb = in_w(o, "order_date", w["baseline_start"], w["baseline_end"]), in_w(r, "cohort_date", w["baseline_start"], w["baseline_end"])
    overall_cur = rate(rc["qty"].sum(), oc["qty"].sum())
    overall_base = rate(rb["qty"].sum(), ob["qty"].sum())
    rows, spikes = [], []
    for col in cols:
        gc, gb = _group_rates(oc, rc, col), _group_rates(ob, rb, col)
        for key in gc.index:
            cu, ck = float(gc.at[key, "units"]), float(gc.at[key, "returned"])
            bu = float(gb.at[key, "units"]) if key in gb.index else 0.0
            bk = float(gb.at[key, "returned"]) if key in gb.index else 0.0
            if cu < 20:
                continue
            ref_k, ref_n, ref = (bk, bu, "baseline") if bu >= 50 else (rb["qty"].sum(), ob["qty"].sum(), "overall")
            cr, br = rate(ck, cu), rate(ref_k, ref_n)
            z, p = z_test(ck, cu, ref_k, ref_n)
            unusual = ck >= 5 and cr >= 1.5 * br and cr - br >= 0.02 and p < 0.05
            row = {"dimension": col.replace("_id", ""), "key": str(key),
                   "label": (labels or {}).get(col, {}).get(str(key), str(key)),
                   "current_units": int(cu), "current_returned": int(ck), "current_rate": round(cr, 4),
                   "baseline_units": int(ref_n), "baseline_returned": int(ref_k), "baseline_rate": round(br, 4),
                   "compared_to": ref, "change": round(cr - br, 4), "lift": finite(lift(ck, cu, ref_k, ref_n)),
                   "p_value": round(p, 4), "unusual": bool(unusual)}
            rows.append(row)
            if unusual:
                spikes.append(row)
    spikes.sort(key=lambda x: (x["p_value"], -x["change"]))
    return {"windows": {k: iso(v) for k, v in w.items()},
            "overall": {"current_rate": round(overall_cur, 4), "baseline_rate": round(overall_base, 4)},
            "rows": rows, "spikes": spikes}


def batch_outliers(d: Data, f: Filters, labels: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Batches whose return rate is well above the other batches of the same SKU."""
    o, r, _ = scoped(d, Filters(**{**f.__dict__, "batch": None}))
    o, r = o.dropna(subset=["batch_id"]), r.dropna(subset=["batch_id"])
    out = []
    for sku, og in o.groupby("sku"):
        rg = r[r["sku"] == sku]
        g = _group_rates(og, rg, "batch_id")
        if len(g) < 2:
            continue
        tot_u, tot_k = g["units"].sum(), g["returned"].sum()
        for bid, row in g.iterrows():
            u, k = float(row["units"]), float(row["returned"])
            ou, ok = tot_u - u, tot_k - k
            if u < 30 or ou < 30:
                continue
            z, p = z_test(k, u, ok, ou)
            unusual = k >= 5 and rate(k, u) >= 1.5 * rate(ok, ou) and rate(k, u) - rate(ok, ou) >= 0.02 and p < 0.05
            out.append({"batch": str(bid), "sku": sku, "label": (labels or {}).get(sku, sku), "units": int(u),
                        "returned": int(k), "rate": round(rate(k, u), 4), "other_batches_rate": round(rate(ok, ou), 4),
                        "lift": finite(lift(k, u, ok, ou)), "p_value": round(p, 4), "unusual": bool(unusual)})
    out.sort(key=lambda x: (not x["unusual"], x["p_value"]))
    return out


def trend(o: pd.DataFrame, r: pd.DataFrame, end: pd.Timestamp | None, freq: str = "W-MON") -> list[dict[str, Any]]:
    if o.empty:
        return []
    per = lambda s: s.dt.tz_convert(None).dt.to_period(freq).dt.start_time  # noqa: E731
    units = o.groupby(per(o["order_date"]))["qty"].sum()
    ret = r.groupby(per(r["cohort_date"]))["qty"].sum() if not r.empty else pd.Series(dtype=float)
    refunds = r.groupby(per(r["cohort_date"]))["refund"].sum() if not r.empty else pd.Series(dtype=float)
    cost = r.groupby(per(r["cohort_date"]))["cost_total"].sum() if not r.empty else pd.Series(dtype=float)
    mature_cut = (end - timedelta(days=MATURITY_DAYS)).tz_convert(None) if end is not None else None
    out = []
    for p, u in units.items():
        k = float(ret.get(p, 0))
        out.append({"period": p.date().isoformat(), "units": int(u), "returned": int(k), "rate": round(rate(k, u), 4),
                    "refunds": round(float(refunds.get(p, 0)), 2), "cost": round(float(cost.get(p, 0)), 2),
                    "maturing": bool(mature_cut is not None and p + pd.Timedelta(days=6) > mature_cut)})
    return out


def daily(o: pd.DataFrame, r: pd.DataFrame, end: pd.Timestamp | None, max_days: int = 371) -> list[dict[str, Any]]:
    """Return rate per order day (for the calendar heatmap). Capped to the latest ~53 weeks."""
    if o.empty:
        return []
    day = lambda s: s.dt.tz_convert(None).dt.normalize()  # noqa: E731
    units = o.groupby(day(o["order_date"]))["qty"].sum()
    ret = r.groupby(day(r["cohort_date"]))["qty"].sum() if not r.empty else pd.Series(dtype=float)
    mature_cut = (end - timedelta(days=MATURITY_DAYS)).tz_convert(None) if end is not None else None
    out = []
    for p, u in units.sort_index().items():
        k = float(ret.get(p, 0))
        out.append({"date": p.date().isoformat(), "units": int(u), "returned": int(k), "rate": round(rate(k, u), 4),
                    "maturing": bool(mature_cut is not None and p > mature_cut)})
    return out[-max_days:]


def flows(r: pd.DataFrame, top_groups: int = 5, top_causes: int = 5) -> list[dict[str, Any]]:
    """Returns counted from complaint group to the finding (root cause) they were traced to.
    Groups and findings beyond the top N are folded into 'other'; returns with no finding go to 'none'."""
    if r.empty:
        return []
    x = r[r["cluster"].map(lambda c: CATEGORIES.get(c, {}).get("cause", "none") != "none")].copy()
    if x.empty:
        return []
    fk = x["finding_key"] if "finding_key" in x else pd.Series([None] * len(x), index=x.index)
    x["target"] = fk.where(fk.notna(), "none").astype(str)
    keep_g = x.groupby("cluster")["qty"].sum().sort_values(ascending=False).head(top_groups).index
    keep_t = x[x["target"] != "none"].groupby("target")["qty"].sum().sort_values(ascending=False).head(top_causes).index
    x["source"] = x["cluster"].where(x["cluster"].isin(keep_g), "other")
    x["target"] = x["target"].where(x["target"].isin(keep_t) | (x["target"] == "none"), "other")
    g = x.groupby(["source", "target"])["qty"].sum().reset_index()
    return [{"source": s, "source_label": CATEGORIES.get(s, {}).get("label", "Other complaints"), "target": t,
             "returns": int(q)} for s, t, q in g.itertuples(index=False) if q > 0]


def breakdown(o: pd.DataFrame, r: pd.DataFrame, col: str, labels: dict[str, str] | None = None,
              top: int = 20) -> list[dict[str, Any]]:
    if col == "cluster":  # reasons: units are the same for every group (share of all ordered units)
        total_units = o["qty"].sum()
        g = r.groupby("cluster").agg(returned=("qty", "sum"), refunds=("refund", "sum"), cost=("cost_total", "sum"),
                                     orders=("order_id", "nunique")).sort_values("returned", ascending=False)
        return [{"key": k, "label": CATEGORIES.get(k, {}).get("label", k), "units": int(total_units),
                 "returned": int(v.returned), "orders": int(v.orders), "rate": round(rate(v.returned, total_units), 4),
                 "share": round(rate(v.returned, r["qty"].sum()), 4), "refunds": round(float(v.refunds), 2),
                 "cost": round(float(v.cost), 2)} for k, v in g.iterrows()]
    g = _group_rates(o, r, col).sort_values("returned", ascending=False).head(top)
    return [{"key": str(k), "label": (labels or {}).get(str(k), str(k)), "units": int(v.units),
             "orders": int(v.orders), "returned": int(v.returned), "rate": round(float(v.rate or 0), 4),
             "refunds": round(float(v.get("refunds", 0)), 2), "cost": round(float(v.get("cost", 0)), 2)}
            for k, v in g.iterrows()]


def labels_for(d: Data) -> dict[str, dict[str, str]]:
    p = d.products.drop_duplicates("sku")
    sup = {}
    for frame in (d.products, d.batches):
        for _, row in frame.dropna(subset=["supplier_id"]).iterrows():
            if row.get("supplier_name"):
                sup[str(row["supplier_id"])] = f"{row['supplier_name']} ({row['supplier_id']})"
    return {"sku": {str(s): f"{n} ({s})" for s, n in zip(p["sku"], p["name"]) if n},
            "supplier_id": sup, "category": {}, "carrier": {}, "batch_id": {}}


def overview(d: Data, f: Filters, assumptions: dict[str, Any]) -> dict[str, Any]:
    o, r, v = scoped(d, f)
    r = costmod.apply(r, assumptions)
    lab = labels_for(d)
    units, returned = int(o["qty"].sum()), int(r["qty"].sum())
    cmp = compare_baseline(d, f, labels=lab)
    risky_suppliers = [s for s in cmp["spikes"] if s["dimension"] == "supplier"]
    by_supplier = breakdown(o, r, "supplier_id", lab["supplier_id"])
    overall = rate(returned, units)
    for s in by_supplier:  # also "high risk" when far above the overall rate with real volume
        if s["returned"] >= 10 and s["rate"] >= 1.5 * overall and not any(x["key"] == s["key"] for x in risky_suppliers):
            risky_suppliers.append({"key": s["key"], "label": s["label"], "current_rate": s["rate"],
                                    "baseline_rate": round(overall, 4), "compared_to": "overall", "unusual": False})
    cost = costmod.summarize(r)
    return {
        "filters": f.as_dict(),
        "range": {"start": iso(d.start), "end": iso(d.end)},
        "kpis": {
            "orders": int(o["order_id"].nunique()), "units": units, "returns": int(len(r)), "returned_units": returned,
            "return_rate": round(overall, 4), "refunds": round(float(r["refund"].sum()), 2),
            "costs_total": cost["total"], "costs_actual": cost["actual"], "costs_estimated": cost["estimated"],
            "cost_lines": cost["lines"],
            "affected_products": int(r["sku"].nunique()), "high_risk_suppliers": len(risky_suppliers),
            "reviews": int(len(v)), "currency": assumptions["currency"],
        },
        "high_risk_suppliers": risky_suppliers[:8],
        "trend": trend(o, r, d.end),
        "daily": daily(o, r, d.end),
        "flows": flows(r),
        "by": {
            "sku": breakdown(o, r, "sku", lab["sku"]),
            "supplier": by_supplier,
            "category": breakdown(o, r, "category"),
            "batch": breakdown(o, r, "batch_id"),
            "reason": breakdown(o, r, "cluster"),
            "carrier": breakdown(o, r, "carrier"),
            "month": _months(o, r),
        },
        "baseline": cmp,
        "batch_outliers": batch_outliers(d, f, lab["sku"])[:12],
        "links": d.links,
    }


def _months(o: pd.DataFrame, r: pd.DataFrame) -> list[dict[str, Any]]:
    t = trend(o, r, None, freq="M")
    return [{"key": x["period"][:7], "label": pd.Timestamp(x["period"]).strftime("%b %Y"), "units": x["units"],
             "returned": x["returned"], "rate": x["rate"], "refunds": x["refunds"], "cost": x["cost"]} for x in t]


def facets(d: Data) -> dict[str, Any]:
    lab = labels_for(d)
    o = d.orders
    return {
        "skus": [{"value": s, "label": lab["sku"].get(s, s)} for s in sorted(o["sku"].dropna().unique())],
        "categories": sorted(o["category"].dropna().unique().tolist()),
        "suppliers": [{"value": s, "label": lab["supplier_id"].get(s, s)} for s in sorted(o["supplier_id"].dropna().unique())],
        "batches": sorted(o["batch_id"].dropna().unique().tolist()),
        "clusters": [{"value": k, "label": v["label"]} for k, v in CATEGORIES.items()],
        "causes": sorted({v["cause"] for v in CATEGORIES.values() if v["cause"] != "none"} | {"supplier_change"}),
        "range": {"start": iso(d.start), "end": iso(d.end)},
    }
