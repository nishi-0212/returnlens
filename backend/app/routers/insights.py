"""Read-only analytics: overview dashboard, filters, complaint groups, costs, run history and source records."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..deps import workspace
from ..schemas import AssumptionsIn
from ..serialize import clean
from ..services import analytics, complaints, costs, dataset
from ..services.analysis import get_assumptions
from ..services.clustering import CATEGORIES
from ..services.investigate import CAUSES
from ..services.utils import now_utc

router = APIRouter(prefix="/api", tags=["analytics"])
DATE = r"^\d{4}-\d{2}-\d{2}$"


def filters(date_from: str | None = Query(default=None, pattern=DATE), date_to: str | None = Query(default=None, pattern=DATE),
            sku: str | None = Query(default=None, max_length=64), category: str | None = Query(default=None, max_length=80),
            supplier: str | None = Query(default=None, max_length=64), batch: str | None = Query(default=None, max_length=64),
            cluster: str | None = Query(default=None, max_length=40),
            cause: str | None = Query(default=None, max_length=40)) -> analytics.Filters:
    if cluster and cluster not in CATEGORIES:
        raise HTTPException(422, "Unknown complaint group")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "The start date is after the end date")
    return analytics.Filters.parse(date_from=date_from, date_to=date_to, sku=sku, category=category, supplier=supplier,
                                   batch=batch, cluster=cluster, cause=cause)


async def _data(user: dict) -> dataset.Data:
    return await dataset.cached(get_db(), user["id"])


@router.get("/overview")
async def overview(user: dict = Depends(workspace), f: analytics.Filters = Depends(filters)) -> dict[str, Any]:
    """KPIs, trends, breakdowns, baseline comparison and unusual increases (all filters apply)."""
    d = await _data(user)
    db = get_db()
    run = await db.runs.find_one({"user_id": user["id"]}, sort=[("version", -1)])
    if d.empty:
        return {"has_data": False, "run": clean(run)}
    out = dataset.plain(analytics.overview(d, f, await get_assumptions(db, user["id"])))
    out["has_data"] = True
    out["run"] = clean({k: run.get(k) for k in ("version", "created_at", "summary", "changes", "source", "trigger")}) if run else None
    active = clean(await db.findings.find({"user_id": user["id"], "active": True}, {
        "evidence": 0, "tests": 0, "series": 0, "return_ids": 0}).sort("cost.total", -1).to_list(length=None))
    out["top_findings"] = active[:5]
    out["all_findings"] = [{k: f.get(k) for k in ("id", "key", "title", "status", "cause_label", "cluster_label", "products",
                                                  "lift", "cost", "orders_affected")} for f in active]
    by_key = {f["key"]: f for f in active}
    for fl in out.get("flows", []):
        f = by_key.get(fl["target"])
        fl["target_label"] = (_short_target(f) if f else
                              "No single cause" if fl["target"] == "none" else "Other causes")
        fl["target_status"] = f.get("status") if f else None
        fl["finding_id"] = f.get("id") if f else None
    return out


def _short_target(f: dict[str, Any]) -> str:
    """A short name for a finding in the complaint → cause flow (e.g. 'Batch B-EB-0412', 'Carrier ParcelPro')."""
    dim, val = f.get("dimension") or "", f.get("value") or ""
    if dim.startswith("change:"):
        return f"{dim.split(':', 1)[1].replace('_', ' ').capitalize()} · {', '.join(f.get('products') or [])[:28]}"
    names = {"batch": "Batch", "supplier": "Supplier", "carrier": "Carrier", "warehouse": "Warehouse"}
    if dim in names:
        return f"{names[dim]} {val}"
    return f"{f.get('cause_label', 'Cause')} · {', '.join(f.get('products') or [])[:28]}"


@router.get("/facets")
async def facets(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Values for the filter menus."""
    d = await _data(user)
    out = dataset.plain(analytics.facets(d)) if not d.empty else {"skus": [], "categories": [], "suppliers": [], "batches": [],
                                                   "clusters": [], "causes": [], "range": {}}
    out["cause_labels"] = CAUSES
    return out


@router.get("/complaints")
async def complaint_groups(user: dict = Depends(workspace), f: analytics.Filters = Depends(filters)) -> dict[str, Any]:
    """Complaint groups with counts, affected orders, themes, wording variants and representative complaints."""
    d = await _data(user)
    if d.empty:
        return {"groups": [], "weeks": [], "total_returns": 0}
    return dataset.plain(complaints.groups(d, f, await get_assumptions(get_db(), user["id"])))


@router.get("/complaints/{group}/records")
async def complaint_records(group: str, user: dict = Depends(workspace), f: analytics.Filters = Depends(filters),
                            limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)) -> dict[str, Any]:
    """Every return and review in one complaint group (paged)."""
    if group not in CATEGORIES:
        raise HTTPException(404, "Unknown complaint group")
    d = await _data(user)
    o, r, v = analytics.scoped(d, analytics.Filters(**{**f.__dict__, "cluster": group}))
    rows = [{"type": "return", "id": x["return_id"], "date": dataset.iso(x["return_date"]), "order_id": x.get("order_id"),
             "sku": x.get("sku"), "batch": x.get("batch_id"), "supplier": x.get("supplier_id"), "carrier": x.get("carrier"),
             "reason": x.get("reason"), "text": x.get("comment") or x.get("reason"), "refund": dataset.to_py(x.get("refund_amount")),
             "confidence": dataset.to_py(x.get("cluster_conf")), "method": x.get("cluster_method")}
            for _, x in r.sort_values("return_date", ascending=False).iterrows()]
    rows += [{"type": "review", "id": x["review_id"], "date": dataset.iso(x["date"]), "order_id": x.get("order_id"),
              "sku": x.get("sku"), "rating": dataset.to_py(x.get("rating")), "text": x.get("text"),
              "confidence": dataset.to_py(x.get("cluster_conf")), "method": x.get("cluster_method")}
             for _, x in v.sort_values("date", ascending=False).iterrows()]
    return dataset.plain({"total": len(rows), "items": rows[offset:offset + limit]})


@router.get("/costs")
async def cost_report(user: dict = Depends(workspace), f: analytics.Filters = Depends(filters)) -> dict[str, Any]:
    """Financial impact: actual vs estimated, by product, supplier, batch, complaint group and root cause."""
    d = await _data(user)
    db = get_db()
    a = await get_assumptions(db, user["id"])
    if d.empty:
        return {"has_data": False, "assumptions": a, "assumptions_text": costs.assumptions_text(a)}
    _, r, _ = analytics.scoped(d, f)
    r = costs.apply(r, a)
    lab = analytics.labels_for(d)
    if "cause" not in r:
        r["cause"] = r["cluster"].map(lambda c: CATEGORIES.get(c, {}).get("cause"))
    cause_labels = {**CAUSES, "none": "Not a product problem"}
    findings = await db.findings.find({"user_id": user["id"], "active": True}, {
        "evidence": 0, "tests": 0, "series": 0, "return_ids": 0}).sort("cost.monthly", -1).to_list(length=None)
    return dataset.plain({
        "has_data": True, "filters": f.as_dict(), "summary": costs.summarize(r), "currency": a["currency"],
        "by_product": costs.by(r, "sku", lab["sku"]), "by_supplier": costs.by(r, "supplier_id", lab["supplier_id"]),
        "by_batch": costs.by(r, "batch_id"),
        "by_cluster": costs.by(r, "cluster", {k: v["label"] for k, v in CATEGORIES.items()}),
        "by_cause": costs.by(r, "cause", cause_labels),
        "top_problems": clean(findings[:10]),
        "assumptions": a, "assumptions_text": costs.assumptions_text(a),
    })


@router.get("/costs/assumptions")
async def get_cost_assumptions(user: dict = Depends(workspace)) -> dict[str, Any]:
    a = await get_assumptions(get_db(), user["id"])
    return {"values": a, "text": costs.assumptions_text(a), "defaults": costs.DEFAULTS}


@router.put("/costs/assumptions")
async def set_cost_assumptions(body: AssumptionsIn, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Change the estimates used where costs aren't recorded. Applies immediately to every cost view."""
    db = get_db()
    current = await get_assumptions(db, user["id"])
    new = {**current, **{k: v for k, v in body.model_dump(exclude_none=True).items() if k != "write_off_share"}}
    if body.write_off_share:
        new["write_off_share"] = {**current["write_off_share"], **body.write_off_share.model_dump(exclude_none=True)}
    await db.settings.update_one({"user_id": user["id"], "kind": "cost_assumptions"},
                                 {"$set": {"values": new, "updated_at": now_utc()}}, upsert=True)
    a = costs.merge(new)
    return {"values": a, "text": costs.assumptions_text(a), "defaults": costs.DEFAULTS}


@router.get("/runs")
async def runs(user: dict = Depends(workspace)) -> list[dict[str, Any]]:
    """Analysis history: what each run found and what changed since the one before."""
    docs = await get_db().runs.find({"user_id": user["id"]}, {"spikes": 0}).sort("version", -1).limit(20).to_list(length=None)
    return clean(docs)


@router.get("/events")
async def events(user: dict = Depends(workspace)) -> list[dict[str, Any]]:
    return clean(await get_db().events.find({"user_id": user["id"]}).sort("at", -1).limit(30).to_list(length=None))


RECORD_TYPES = {"return": ("returns", "return_id"), "review": ("reviews", "review_id"), "order": ("orders", "order_id"),
                "inspection": ("inspections", "inspection_id"), "shipment": ("shipments", "shipment_id"),
                "change": ("changes", "change_id"), "product": ("products", "sku"), "batch": ("batches", "batch_id")}


@router.get("/records/{kind}/{record_id}")
async def record(kind: str, record_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    """The original record behind a piece of evidence (with its linked order and shipment for returns)."""
    if kind not in RECORD_TYPES:
        raise HTTPException(404, "Unknown record type")
    coll, field = RECORD_TYPES[kind]
    db = get_db()
    doc = await db[coll].find_one({"user_id": user["id"], field: record_id[:80]})
    if not doc:
        raise HTTPException(404, "Record not found")
    out = {"kind": kind, "record": clean(doc)}
    if kind in ("return", "review") and doc.get("order_id"):
        order = await db.orders.find_one({"user_id": user["id"], "order_id": doc["order_id"], **(
            {"sku": doc["sku"]} if doc.get("sku") else {})})
        out["order"] = clean(order)
        if order:
            ship = await db.shipments.find_one({"user_id": user["id"], "$or": [
                {"shipment_id": order.get("shipment_id")}, {"order_id": order["order_id"]}]})
            out["shipment"] = clean(ship)
    return out
