"""Financial impact of returns, keeping recorded costs apart from estimated ones.

Each return gets five cost lines. A line is *actual* when the uploaded data has the amount
(e.g. a refund amount or a return-label cost); otherwise it is *estimated* from the workspace's
assumptions, which are listed in the UI and can be edited.

* refund          actual refund amount; if missing and the return was refunded, price x qty
* reverse_ship    return label cost; if missing, a flat cost per returned unit
* replacement     replacement cost; if missing and the item was replaced, unit cost + outbound shipping
* handling        handling/processing cost; if missing, a flat cost per return
* write_off       value lost because the item can't be resold, by its condition (estimate only)
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

DEFAULTS: dict[str, Any] = {
    "currency": "USD",
    "reverse_shipping_per_unit": 8.0,
    "handling_per_return": 4.5,
    "replacement_shipping_per_unit": 6.0,
    "cost_share_of_price_if_unknown": 0.4,
    "write_off_share": {"damaged": 1.0, "defective": 1.0, "incomplete": 0.5, "opened": 0.15, "unopened": 0.0,
                        "unknown": 0.25},
}
LINES = ["refund", "reverse_ship", "replacement", "handling", "write_off"]


def assumptions_text(a: dict[str, Any]) -> list[dict[str, str]]:
    cur = a.get("currency", "USD")
    w = a["write_off_share"]
    return [
        {"key": "reverse_shipping_per_unit", "label": "Return shipping",
         "text": f"{cur} {a['reverse_shipping_per_unit']:.2f} per returned unit when no return-label cost is recorded."},
        {"key": "handling_per_return", "label": "Handling",
         "text": f"{cur} {a['handling_per_return']:.2f} per return (inspection, restocking, support time) when not recorded."},
        {"key": "replacement_shipping_per_unit", "label": "Replacements",
         "text": f"Replaced items cost the product's unit cost plus {cur} {a['replacement_shipping_per_unit']:.2f} "
                 f"outbound shipping per unit when no replacement cost is recorded."},
        {"key": "cost_share_of_price_if_unknown", "label": "Unknown unit cost",
         "text": f"If a product has no unit cost, it is taken as {a['cost_share_of_price_if_unknown']:.0%} of its price."},
        {"key": "write_off_share", "label": "Write-offs",
         "text": "Share of unit cost lost because the item can't be resold: "
                 + ", ".join(f"{k} {v:.0%}" for k, v in w.items()) + "."},
        {"key": "refund", "label": "Refunds",
         "text": "Recorded refund amounts are used as-is. If a refunded return has no amount, price x quantity is used "
                 "and counted as an estimate."},
    ]


def merge(saved: dict[str, Any] | None) -> dict[str, Any]:
    a = {**DEFAULTS, **{k: v for k, v in (saved or {}).items() if k in DEFAULTS}}
    a["write_off_share"] = {**DEFAULTS["write_off_share"], **((saved or {}).get("write_off_share") or {})}
    return a


def _condition(c: Any) -> str:
    s = str(c or "").lower()
    for k in ("damaged", "defective", "incomplete", "unopened", "opened"):
        if k in s:
            return k
    if "broken" in s:
        return "damaged"
    if "new" in s or "sealed" in s:
        return "unopened"
    return "unknown"


def apply(returns: pd.DataFrame, a: dict[str, Any]) -> pd.DataFrame:
    """Add cost columns (<line>, <line>_actual) and totals to a returns frame."""
    r = returns.copy()
    if r.empty:
        for line in LINES:
            r[line], r[f"{line}_actual"] = [], []
        r["cost_total"], r["cost_actual"], r["cost_estimated"] = [], [], []
        return r
    qty = r["qty"].astype(float)
    price = pd.to_numeric(r["unit_price"], errors="coerce")
    unit_cost = pd.to_numeric(r["unit_cost"], errors="coerce").fillna(price * a["cost_share_of_price_if_unknown"]).fillna(0)
    res = r["resolution"].fillna("refund").astype(str)

    refund_rec = r["refund_amount"].notna()
    r["refund"] = np.where(refund_rec, r["refund_amount"].fillna(0),
                           np.where(res.isin(["refund", "store_credit"]), (price.fillna(0) * qty), 0.0))
    r["refund_actual"] = refund_rec

    ship_rec = r["return_shipping_cost"].notna()
    r["reverse_ship"] = np.where(ship_rec, r["return_shipping_cost"].fillna(0), qty * a["reverse_shipping_per_unit"])
    r["reverse_ship_actual"] = ship_rec

    repl_rec = r["replacement_cost"].notna()
    r["replacement"] = np.where(repl_rec, r["replacement_cost"].fillna(0),
                                np.where(res == "replacement", qty * (unit_cost + a["replacement_shipping_per_unit"]), 0.0))
    r["replacement_actual"] = repl_rec

    hand_rec = r["handling_cost"].notna()
    r["handling"] = np.where(hand_rec, r["handling_cost"].fillna(0), a["handling_per_return"])
    r["handling_actual"] = hand_rec

    share = r["condition"].map(_condition).map(a["write_off_share"]).fillna(a["write_off_share"]["unknown"])
    r["write_off"] = qty * unit_cost * share
    r["write_off_actual"] = False

    actual = sum(np.where(r[f"{line}_actual"], r[line], 0.0) for line in LINES)
    total = sum(r[line] for line in LINES)
    r["cost_total"], r["cost_actual"] = total, actual
    r["cost_estimated"] = total - actual
    return r


def summarize(r: pd.DataFrame) -> dict[str, Any]:
    """Totals per cost line, split into actual and estimated."""
    out = {"lines": [], "total": 0.0, "actual": 0.0, "estimated": 0.0, "returns": int(len(r))}
    for line in LINES:
        if r.empty:
            act = est = 0.0
        else:
            act = float(r.loc[r[f"{line}_actual"], line].sum())
            est = float(r.loc[~r[f"{line}_actual"], line].sum())
        out["lines"].append({"line": line, "actual": round(act, 2), "estimated": round(est, 2),
                             "total": round(act + est, 2)})
    out["actual"] = round(sum(x["actual"] for x in out["lines"]), 2)
    out["estimated"] = round(sum(x["estimated"] for x in out["lines"]), 2)
    out["total"] = round(out["actual"] + out["estimated"], 2)
    return out


def by(r: pd.DataFrame, col: str, label: dict[str, str] | None = None, top: int = 15) -> list[dict[str, Any]]:
    if r.empty or col not in r:
        return []
    g = r.groupby(r[col].fillna("Unknown")).agg(
        returns=("return_id", "count"), units=("qty", "sum"), total=("cost_total", "sum"), actual=("cost_actual", "sum"),
        estimated=("cost_estimated", "sum"), refunds=("refund", "sum"))
    g = g.sort_values("total", ascending=False).head(top)
    return [{"key": str(k), "label": (label or {}).get(str(k), str(k)), "returns": int(v.returns), "units": int(v.units),
             "total": round(float(v.total), 2), "actual": round(float(v.actual), 2),
             "estimated": round(float(v.estimated), 2), "refunds": round(float(v.refunds), 2)} for k, v in g.iterrows()]
