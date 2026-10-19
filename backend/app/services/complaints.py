"""Complaint groups for the Complaints page (computed live so every filter applies)."""
from __future__ import annotations

from typing import Any

import pandas as pd

from .analytics import Filters, labels_for, scoped
from .clustering import ACTIONABLE, CATEGORIES, representatives, themes, variants
from .costs import apply
from .dataset import Data, iso
from .stats import rate


def _text(row: pd.Series, kind: str) -> str:
    if kind == "review":
        return str(row.get("text") or "")
    c, rs = row.get("comment"), row.get("reason")
    return str(c if isinstance(c, str) and c.strip() else (rs or ""))


def groups(d: Data, f: Filters, assumptions: dict[str, Any]) -> dict[str, Any]:
    o, r, v = scoped(d, f)
    r = apply(r, assumptions)
    lab = labels_for(d)
    units = float(o["qty"].sum())
    total_returns = float(r["qty"].sum())
    out = []
    per = lambda s: s.dt.tz_convert(None).dt.to_period("W-MON").dt.start_time  # noqa: E731
    weeks = sorted(per(o["order_date"]).unique()) if not o.empty else []
    for key, meta in CATEGORIES.items():
        rg = r[r["cluster"] == key]
        vg = v[v["cluster"] == key]
        if rg.empty and vg.empty:
            continue
        items = [(x, "return") for _, x in rg.iterrows()] + [(x, "review") for _, x in vg.iterrows()]
        texts = [_text(x, k) for x, k in items]
        with_words = [i for i, t in enumerate(texts) if len(t.split()) >= 3]
        t_texts = [texts[i] for i in with_words]
        idx, names = themes(t_texts) if t_texts else ([], [])
        theme_counts = pd.Series([names[i] if i < len(names) else "other wording" for i in idx]).value_counts() if idx else pd.Series(dtype=int)
        reps = [with_words[i] for i in representatives(t_texts, 3)] if t_texts else list(range(min(3, len(items))))
        examples = []
        for i in reps:
            x, k = items[i]
            examples.append({"type": k, "id": x["return_id"] if k == "return" else x["review_id"],
                             "date": iso(x["return_date"] if k == "return" else x["date"]), "sku": x.get("sku"),
                             "product": lab["sku"].get(str(x.get("sku")), x.get("sku")), "text": texts[i],
                             "batch": x.get("batch_id"), "carrier": x.get("carrier")})
        orders_aff = set(rg["order_id"].dropna()) | set(vg["order_id"].dropna())
        trend = rg.groupby(per(rg["cohort_date"]))["qty"].sum() if not rg.empty else pd.Series(dtype=float)
        top = lambda df, col, labels=None: [  # noqa: E731
            {"key": str(k), "label": (labels or {}).get(str(k), str(k)), "count": int(n), "share": round(n / max(1, len(df)), 3)}
            for k, n in df[col].fillna("Unknown").value_counts().head(5).items()] if not df.empty else []
        out.append({
            "key": key, "label": meta["label"], "about": meta["about"], "actionable": key in ACTIONABLE,
            "default_cause": meta["cause"], "returns": int(len(rg)), "returned_units": int(rg["qty"].sum()),
            "reviews": int(len(vg)), "orders_affected": len(orders_aff),
            "share_of_returns": round(rate(rg["qty"].sum(), total_returns), 4),
            "rate": round(rate(rg["qty"].sum(), units), 4),
            "refunds": round(float(rg["refund"].sum()), 2), "cost": round(float(rg["cost_total"].sum()), 2),
            "trend": [int(trend.get(w, 0)) for w in weeks],
            "top_products": top(rg, "sku", lab["sku"]), "top_suppliers": top(rg, "supplier_id", lab["supplier_id"]),
            "top_batches": top(rg, "batch_id"), "top_carriers": top(rg, "carrier"),
            "themes": [{"label": k, "count": int(n)} for k, n in theme_counts.items()],
            "variants": variants(texts), "examples": examples,
            "confidence": round(float(pd.to_numeric(rg.get("cluster_conf"), errors="coerce").mean()), 2)
            if "cluster_conf" in rg and rg["cluster_conf"].notna().any() else None,
        })
    out.sort(key=lambda g: (not g["actionable"], -g["returns"] - g["reviews"]))
    return {"filters": f.as_dict(), "weeks": [pd.Timestamp(w).date().isoformat() for w in weeks],
            "total_returns": int(len(r)), "groups": out}
