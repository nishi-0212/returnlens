"""Extra views for the investigation page: how the finding's group compares with its peers, and a dated
timeline of the records behind it. Everything is computed from the workspace's own records."""
from __future__ import annotations

from typing import Any

import pandas as pd

from .dataset import Data, iso, to_py
from .stats import rate

DIM_COL = {"batch": "batch_id", "supplier": "supplier_id", "carrier": "carrier", "warehouse": "warehouse"}


def _text(row: Any) -> str:
    for k in ("comment", "reason"):
        v = row.get(k)
        if isinstance(v, str) and v.strip() and v.strip().lower() != "nan":
            return v.strip()
    return "No comment"


def peers(d: Data, f: dict[str, Any], min_units: int = 20, limit: int = 30) -> dict[str, Any] | None:
    """Complaint rate of every batch / supplier / carrier / warehouse for the finding's products and complaint group."""
    col = DIM_COL.get(f.get("dimension") or "")
    if not col or d.empty:
        return None
    skus, cluster = f.get("skus") or [], f.get("cluster")
    o = d.orders[d.orders["sku"].isin(skus)]
    r = d.returns[d.returns["sku"].isin(skus) & (d.returns["cluster"] == cluster)]
    if o.empty or col not in o:
        return None
    units = o.groupby(o[col].fillna("Unknown"))["qty"].sum()
    k = r.groupby(r[col].fillna("Unknown"))["qty"].sum() if not r.empty else pd.Series(dtype=float)
    rows = [{"value": str(v), "units": int(u), "complaints": int(k.get(v, 0)), "rate": round(rate(float(k.get(v, 0)), float(u)), 4),
             "highlight": str(v) == str(f.get("value"))}
            for v, u in units.items() if u >= min_units or str(v) == str(f.get("value"))]
    if len(rows) < 2:
        return None
    rows.sort(key=lambda x: -x["units"])
    rows = rows[:limit]
    others = [x for x in rows if not x["highlight"]]
    lo = min((x["rate"] for x in others), default=0)
    hi = max((x["rate"] for x in others), default=0)
    return {"dimension": f["dimension"], "rows": rows, "usual": {"low": lo, "high": hi}}


def timeline(d: Data, f: dict[str, Any], rec: dict[str, Any] | None) -> list[dict[str, Any]]:
    ev: list[dict[str, Any]] = []
    dim, val = f.get("dimension") or "", f.get("value")
    if dim == "batch" and not d.batches.empty:
        b = d.batches[d.batches["batch_id"] == val]
        if not b.empty:
            row = b.iloc[0]
            when = row["received_date"] if pd.notna(row["received_date"]) else row["produced_date"]
            if pd.notna(when):
                sup = row.get("supplier_name") or row.get("supplier_id")
                units = row.get("units")
                body = str(val) + (f" from {sup}" if sup else "") + (f", {int(units):,} units" if pd.notna(units) else "") + "."
                ev.append({"date": iso(when), "kind": "batch", "title": "Batch received", "body": body,
                           "ref": {"kind": "batch", "id": str(val)}})
    for c in (f.get("evidence") or {}).get("changes", []):
        if not c.get("context") and c.get("date"):
            ev.append({"date": iso(c["date"]), "kind": "change", "title": (c.get("change_type") or "change").replace("_", " ").capitalize(),
                       "body": c.get("description") or "", "ref": {"kind": "change", "id": c.get("id")}})
    for x in (f.get("evidence") or {}).get("inspections", []):
        if x.get("date"):
            ev.append({"date": iso(x["date"]), "kind": "inspection", "title": f"Inspection {x.get('result') or ''}".strip(),
                       "body": (x.get("text") or "")[:140], "ref": {"kind": "inspection", "id": x.get("id")},
                       "bad": str(x.get("result", "")).lower() in ("fail", "failed", "deviation")})
    ids = set(f.get("return_ids") or [])
    if ids:
        r = d.returns[d.returns["return_id"].isin(ids)].sort_values("return_date")
        if not r.empty:
            first, last = r.iloc[0], r.iloc[-1]
            ev.append({"date": iso(first["return_date"]), "kind": "first", "title": "First matching return",
                       "body": f"“{_text(first)[:90]}”",
                       "ref": {"kind": "return", "id": str(first["return_id"])}})
            if last["return_id"] != first["return_id"]:
                ev.append({"date": iso(last["return_date"]), "kind": "latest", "title": "Latest matching return",
                           "body": f"{len(r):,} matching returns in total.", "ref": {"kind": "return", "id": str(last["return_id"])}})
    series = [p for p in (f.get("series") or []) if p.get("units")]
    if len(series) >= 3:
        peak = max(series, key=lambda p: p.get("rate") or 0)
        ev.append({"date": iso(peak["period"]), "kind": "peak", "title": "Worst week",
                   "body": f"{to_py(peak.get('complaints'))} complaints from {to_py(peak.get('units'))} units ordered that week.", "ref": None})
    if rec and rec.get("implemented_at"):
        ev.append({"date": iso(rec["implemented_at"]), "kind": "fix", "title": "Fix went live", "body": rec.get("title") or "", "ref": None})
    ev = [e for e in ev if e.get("date")]
    ev.sort(key=lambda e: e["date"])
    return ev
