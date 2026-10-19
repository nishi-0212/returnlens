"""Before/after checks for completed corrective actions, and alerts.

For an action implemented on day T, compare orders placed in [T - L, T) with orders placed in
[T, T + L), where L is the same length on both sides (up to 60 days) and the "after" window
stops 14 days before the last order so its returns have had time to arrive.

* The rate compared is the complaint group's return rate for the action's products
  (complaint units / ordered units), so changes in order volume don't distort it.
* Product mix is held fixed by re-weighting each product's "after" rate by its "before" share.
* A control group (the same complaint on all *other* products) shows whether the whole store moved.

Verdicts: improved / worsened only with a significant difference (p < 0.05) of at least 20%,
enough data, and no matching move in the control group; otherwise inconclusive, with the reason.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import pandas as pd

from .clustering import CATEGORIES
from .dataset import Data, iso, ts
from .stats import rate, two_sided_p, z_test

MATURITY_DAYS = 14
MAX_WINDOW = 60
MIN_DAYS = 14
MIN_UNITS = 100


def _window(o: pd.DataFrame, r: pd.DataFrame, a: pd.Timestamp, b: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    return o[(o["order_date"] >= a) & (o["order_date"] < b)], r[(r["cohort_date"] >= a) & (r["cohort_date"] < b)]


def verify(rec: dict[str, Any], d: Data) -> dict[str, Any]:
    impl = ts(rec.get("implemented_at"))
    scope = rec.get("scope") or {}
    skus, cluster = scope.get("skus") or [], scope.get("cluster")
    label = CATEGORIES.get(cluster, {}).get("label", cluster or "complaints").lower()
    base = {"recommendation_id": rec.get("id"), "implemented_at": iso(impl), "cluster": cluster, "skus": skus}
    if impl is None:
        return {**base, "verdict": "not_started", "headline": "Not implemented yet."}
    if d.end is None:
        return {**base, "verdict": "inconclusive", "headline": "No order data yet."}
    mature_end = d.end - timedelta(days=MATURITY_DAYS) + timedelta(days=1)
    after_end = min(impl + timedelta(days=MAX_WINDOW), mature_end)
    days = (after_end - impl).days
    o = d.orders[d.orders["sku"].isin(skus)]
    r = d.returns[(d.returns["sku"].isin(skus)) & (d.returns["cluster"] == cluster)]
    if days < MIN_DAYS:
        recent = r[r["return_date"] >= impl]
        return {**base, "verdict": "too_early", "after_days": max(days, 0),
                "headline": f"Too early to tell: {max(days, 0)} days of settled orders since the fix, need {MIN_DAYS}.",
                "detail": f"Orders need about {MATURITY_DAYS} days for their returns to come in. "
                          f"{len(recent)} {label} return(s) logged since the fix so far.",
                "series": _series(o, r, impl - timedelta(days=MAX_WINDOW), d.end, impl)}
    before_start = impl - timedelta(days=days)
    ob, rb = _window(o, r, before_start, impl)
    oa, ra = _window(o, r, impl, after_end)
    nb, kb, na, ka = float(ob["qty"].sum()), float(rb["qty"].sum()), float(oa["qty"].sum()), float(ra["qty"].sum())
    rb_, ra_ = rate(kb, nb), rate(ka, na)

    # product mix held at the "before" mix
    adj = None
    if nb and na:
        wb = ob.groupby("sku")["qty"].sum() / nb
        per_after = {s: rate(float(ra[ra["sku"] == s]["qty"].sum()), float(g["qty"].sum()))
                     for s, g in oa.groupby("sku") if g["qty"].sum() >= 10}
        if per_after:
            w = {s: wb.get(s, 0) for s in per_after}
            tot = sum(w.values())
            adj = sum(w[s] * per_after[s] for s in per_after) / tot if tot else None

    # control: the same complaint on every other product
    oc = d.orders[~d.orders["sku"].isin(skus)]
    rc = d.returns[(~d.returns["sku"].isin(skus)) & (d.returns["cluster"] == cluster)]
    ocb, rcb = _window(oc, rc, before_start, impl)
    oca, rca = _window(oc, rc, impl, after_end)
    cb, ca = rate(rcb["qty"].sum(), ocb["qty"].sum()), rate(rca["qty"].sum(), oca["qty"].sum())
    control_change = (ca - cb) / cb if cb else 0.0

    p = two_sided_p(ka, na, kb, nb)
    rel = (ra_ - rb_) / rb_ if rb_ else (1.0 if ra_ > 0 else 0.0)
    rel_adj = ((adj - rb_) / rb_) if (adj is not None and rb_) else rel
    caveats = [f"Compared {days} days before and after {iso(impl)}, using orders whose returns have had {MATURITY_DAYS}+ days to arrive.",
               "This is a before/after comparison, not a controlled experiment: seasonality and other changes can also move return rates."]
    others = d.changes[(d.changes["sku"].isin(skus)) & (d.changes["date"] >= before_start) & (d.changes["date"] < after_end)]
    others = others[(others["date"] - impl).abs() > timedelta(days=3)]
    if not others.empty:
        caveats.append("Other changes to these products in the same period: " + "; ".join(
            f"{iso(c['date'])} {c['change_type'].replace('_', ' ')}" for _, c in others.iterrows()) + ".")

    if na < MIN_UNITS or kb + ka < 6:
        verdict, why = "inconclusive", f"Not enough data yet ({int(na)} units ordered since the fix, {int(kb + ka)} {label} returns in total)."
    elif ra_ < rb_ and z_test(kb, nb, ka, na)[1] < 0.05 and rel <= -0.2 and rel_adj <= -0.2:
        if control_change <= rel * 0.6 and cb > 0:
            verdict, why = "inconclusive", (f"{label.capitalize()} returns also fell {abs(control_change):.0%} on other products, "
                                            f"so the drop can't be credited to this action alone.")
        else:
            verdict, why = "improved", (f"The drop is statistically significant (p = {p:.3f}), holds after adjusting for product mix, "
                                        f"and other products didn't fall the same way ({control_change:+.0%}).")
    elif ra_ > rb_ and z_test(ka, na, kb, nb)[1] < 0.05 and rel >= 0.2:
        verdict, why = "worsened", f"The rise is statistically significant (p = {p:.3f})."
    else:
        verdict, why = "inconclusive", (f"The change ({rel:+.0%}) is within normal variation (p = {p:.2f}); keep watching.")

    headline = {
        "improved": f"Improved: {label} returns fell from {rb_:.1%} to {ra_:.1%}.",
        "worsened": f"Worsened: {label} returns rose from {rb_:.1%} to {ra_:.1%}.",
        "inconclusive": f"Inconclusive: {label} returns went from {rb_:.1%} to {ra_:.1%}.",
    }[verdict]
    recent_start = d.end - timedelta(days=30)
    recent = r[r["return_date"] >= max(recent_start, impl)]
    return {
        **base, "verdict": verdict, "headline": headline, "detail": why, "caveats": caveats, "after_days": days,
        "before": {"start": iso(before_start), "end": iso(impl - timedelta(days=1)), "units": int(nb), "complaints": int(kb),
                   "rate": round(rb_, 4)},
        "after": {"start": iso(impl), "end": iso(after_end - timedelta(days=1)), "units": int(na), "complaints": int(ka),
                  "rate": round(ra_, 4), "mix_adjusted_rate": round(adj, 4) if adj is not None else None},
        "control": {"before_rate": round(cb, 4), "after_rate": round(ca, 4), "change": round(control_change, 3)},
        "relative_change": round(rel, 3), "p_value": round(p, 4),
        "recent_complaints": int(len(recent)), "recent_examples": [
            {"id": x["return_id"], "date": iso(x["return_date"]), "sku": x["sku"], "text": x.get("comment") or x.get("reason")}
            for _, x in recent.sort_values("return_date", ascending=False).head(5).iterrows()],
        "series": _series(o, r, before_start, after_end, impl),
    }


def _series(o: pd.DataFrame, r: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, impl: pd.Timestamp) -> list[dict[str, Any]]:
    o, r = _window(o, r, start, end)
    if o.empty:
        return []
    per = lambda s: s.dt.tz_convert(None).dt.to_period("W-MON").dt.start_time  # noqa: E731
    u = o.groupby(per(o["order_date"]))["qty"].sum()
    k = r.groupby(per(r["cohort_date"]))["qty"].sum() if not r.empty else pd.Series(dtype=float)
    cut = impl.tz_convert(None)
    return [{"period": p.date().isoformat(), "units": int(n), "complaints": int(k.get(p, 0)),
             "rate": round(rate(float(k.get(p, 0)), float(n)), 4), "after": bool(p >= cut - pd.Timedelta(days=3))}
            for p, n in u.items()]


def alerts(d: Data, completed: list[dict[str, Any]], verifications: dict[str, dict[str, Any]],
           spikes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Alerts: a fixed problem coming back, results getting worse, or return rates rising."""
    out: list[dict[str, Any]] = []
    if d.end is None:
        return out
    month = d.end - timedelta(days=30)
    for rec in completed:
        v = verifications.get(rec["id"]) or {}
        scope = rec.get("scope") or {}
        cl = scope.get("cluster")
        label = CATEGORIES.get(cl, {}).get("label", cl)
        impl = ts(rec.get("implemented_at"))
        if impl is None:
            continue
        r = d.returns[(d.returns["sku"].isin(scope.get("skus") or [])) & (d.returns["cluster"] == cl)]
        since = r[(r["return_date"] >= max(impl, month)) & (r["cohort_date"] >= impl)]
        before_rate = (v.get("before") or {}).get("rate") or 0
        after_rate = (v.get("after") or {}).get("rate") or 0
        if v.get("verdict") == "worsened":
            out.append({"key": f"worse:{rec['id']}", "kind": "worsened", "severity": "high", "recommendation_id": rec["id"],
                        "title": f"{label} got worse after “{rec['title']}”",
                        "text": v.get("headline", ""), "skus": scope.get("skus")})
        elif len(since) >= 3 and (v.get("verdict") != "improved" or after_rate >= 0.5 * before_rate):
            out.append({"key": f"back:{rec['id']}", "kind": "reappeared", "severity": "high", "recommendation_id": rec["id"],
                        "title": f"{label} is back on {', '.join(scope.get('skus') or [])}",
                        "text": f"{len(since)} {label.lower()} returns on orders placed after the fix "
                                f"({iso(impl)}). Latest: “{(since.iloc[-1].get('comment') or since.iloc[-1].get('reason'))}”.",
                        "skus": scope.get("skus"), "evidence": since["return_id"].tolist()[-8:]})
    for s in spikes[:6]:
        if s["dimension"] in ("sku", "supplier"):
            out.append({"key": f"rise:{s['dimension']}:{s['key']}", "kind": "rising", "severity": "medium",
                        "title": f"Return rate rising: {s['label']}",
                        "text": f"{s['current_rate']:.1%} in the last 30 settled days vs {s['baseline_rate']:.1%} "
                                f"{'before' if s['compared_to'] == 'baseline' else 'across the store'} "
                                f"({s['current_returned']} returns).", "skus": [s["key"]] if s["dimension"] == "sku" else []})
    return out
