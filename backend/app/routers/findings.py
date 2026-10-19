"""Root-cause findings, the investigation page, recommendations (approve/reject/complete) and alerts."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..deps import workspace
from ..schemas import AlertUpdate, RecommendationUpdate
from ..serialize import clean
from ..services import analytics, casefile, complaints, dataset, verify
from ..services.analysis import get_assumptions, record_event, refresh_checks
from ..services.jobs import runner
from ..services.utils import now_utc

router = APIRouter(prefix="/api", tags=["findings & actions"])
LIST_PROJ = {"evidence": 0, "tests": 0, "series": 0, "return_ids": 0}
STATUS_ORDER = {"confirmed": 0, "likely": 1, "possible": 2}


def _oid(x: str, what: str) -> ObjectId:
    if not ObjectId.is_valid(x):
        raise HTTPException(404, f"{what} not found")
    return ObjectId(x)


@router.post("/analysis/run", status_code=202)
async def run_analysis(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Re-run the full analysis now (it also runs after every upload)."""
    db = get_db()
    if not await db.orders.find_one({"user_id": user["id"]}) or not await db.returns.find_one({"user_id": user["id"]}):
        raise HTTPException(409, "Upload orders and returns first")
    return {"job": clean(await runner.enqueue(user["id"], trigger="manual", label="Re-analysis"))}


@router.get("/findings")
async def list_findings(user: dict = Depends(workspace), include_resolved: bool = False,
                        status: str | None = Query(default=None, pattern="^(confirmed|likely|possible)$"),
                        cause: str | None = Query(default=None, max_length=40), sku: str | None = Query(default=None, max_length=64)
                        ) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"user_id": user["id"]}
    if not include_resolved:
        q["active"] = True
    if status:
        q["status"] = status
    if cause:
        q["cause"] = cause
    if sku:
        q["skus"] = sku
    db = get_db()
    docs = await db.findings.find(q, LIST_PROJ).to_list(length=None)
    recs = {r["finding_key"]: r for r in await db.recommendations.find({"user_id": user["id"]}).to_list(length=None)}
    for f in docs:
        r = recs.get(f["key"])
        f["recommendation"] = {k: r.get(k) for k in ("_id", "status", "title", "priority", "owner", "due_date",
                                                      "verification")} if r else None
    docs.sort(key=lambda f: (not f.get("active", True), STATUS_ORDER.get(f["status"], 3), -(f.get("cost") or {}).get("total", 0)))
    return clean(docs)


@router.get("/findings/{finding_id}")
async def finding_detail(finding_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Investigation page: the finding, its evidence, comparisons, cost, complaint group and corrective action."""
    db = get_db()
    f = await db.findings.find_one({"_id": _oid(finding_id, "Finding"), "user_id": user["id"]})
    if not f:
        raise HTTPException(404, "Finding not found")
    rec = await db.recommendations.find_one({"user_id": user["id"], "finding_key": f["key"]})
    d = await dataset.cached(db, user["id"])
    group = None
    if not d.empty:
        one = f["skus"][0] if len(f.get("skus") or []) == 1 else None
        g = dataset.plain(complaints.groups(d, analytics.Filters(cluster=f["cluster"], sku=one), await get_assumptions(db, user["id"])))
        group = next((x for x in g["groups"] if x["key"] == f["cluster"]), None)
        if group:
            group["for_products"] = [p for p in group["top_products"] if p["key"] in f.get("skus", [])]
    verification = None
    if rec and rec.get("status") == "completed" and not d.empty:
        verification = dataset.plain(verify.verify({**rec, "id": str(rec["_id"])}, d))
    peer_view = dataset.plain(casefile.peers(d, f)) if not d.empty else None
    events = dataset.plain(casefile.timeline(d, f, rec)) if not d.empty else []
    f.pop("return_ids", None)
    return {"finding": clean(f), "recommendation": clean(rec), "complaint_group": group, "verification": verification,
            "peers": peer_view, "timeline": events}


# ---------------------------------------------------------------- recommendations

@router.get("/recommendations")
async def list_recommendations(user: dict = Depends(workspace),
                               status: str | None = Query(default=None, pattern="^(proposed|approved|rejected|completed)$")
                               ) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"user_id": user["id"]}
    if status:
        q["status"] = status
    db = get_db()
    recs = await db.recommendations.find(q).to_list(length=None)
    findings = {f["key"]: f for f in await db.findings.find({"user_id": user["id"]}, LIST_PROJ).to_list(length=None)}
    for r in recs:
        f = findings.get(r["finding_key"])
        r["finding"] = {k: f.get(k) for k in ("_id", "title", "status", "cause_label", "cluster_label", "products", "active",
                                              "confidence")} if f else None
    recs.sort(key=lambda r: (["proposed", "approved", "completed", "rejected"].index(r["status"]), r["priority"],
                             -(r.get("monthly_cost") or 0)))
    return clean(recs)


@router.patch("/recommendations/{rec_id}")
async def update_recommendation(rec_id: str, body: RecommendationUpdate, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Approve, reject or mark completed (with the date it was implemented); edit owner or deadline."""
    db = get_db()
    rec = await db.recommendations.find_one({"_id": _oid(rec_id, "Recommendation"), "user_id": user["id"]})
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    now = now_utc()
    changes: dict[str, Any] = {"updated_at": now}
    if body.owner is not None:
        changes["owner"] = body.owner.strip() or rec["owner"]
    if body.due_date is not None:
        changes["due_date"] = body.due_date
    entry = None
    when = None
    if body.implemented_at:
        when = datetime.fromisoformat(body.implemented_at).replace(tzinfo=timezone.utc)
        if when > now:
            raise HTTPException(422, "The implementation date can't be in the future")
    if body.status and body.status != rec["status"]:
        if body.status == "completed":
            changes["implemented_at"] = when or datetime.fromisoformat(now.date().isoformat()).replace(tzinfo=timezone.utc)
        if rec["status"] == "completed" and body.status != "completed":
            changes["implemented_at"] = None
            changes["verification"] = None
        changes["status"] = body.status
        entry = {"at": now, "status": body.status, "note": body.note}
    elif when and rec["status"] == "completed":
        changes["implemented_at"] = when
    upd: dict[str, Any] = {"$set": changes}
    if entry:
        upd["$push"] = {"history": entry}
    await db.recommendations.update_one({"_id": rec["_id"]}, upd)
    if entry:
        await record_event(db, user["id"], "action", f"“{rec['title']}” → {body.status}")
    if changes.get("status") == "completed" or "implemented_at" in changes:
        await refresh_checks(db, user["id"], await dataset.cached(db, user["id"]))
    return clean(await db.recommendations.find_one({"_id": rec["_id"]}))


@router.get("/recommendations/{rec_id}/verification")
async def recommendation_verification(rec_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Before/after comparison for a completed recommendation (computed on the latest data)."""
    db = get_db()
    rec = await db.recommendations.find_one({"_id": _oid(rec_id, "Recommendation"), "user_id": user["id"]})
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    d = await dataset.cached(db, user["id"])
    return dataset.plain(verify.verify({**rec, "id": str(rec["_id"])}, d))


@router.get("/verification")
async def verification_board(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Every completed action with its before/after result, plus active alerts."""
    db = get_db()
    d = await dataset.cached(db, user["id"])
    recs = await db.recommendations.find({"user_id": user["id"], "status": "completed"}).to_list(length=None)
    items = []
    for r in recs:
        v = dataset.plain(verify.verify({**r, "id": str(r["_id"])}, d)) if not d.empty else None
        items.append({"recommendation": clean(r), "verification": v})
    items.sort(key=lambda x: (x["recommendation"].get("implemented_at") or ""), reverse=True)
    alerts = await db.alerts.find({"user_id": user["id"], "active": True, "dismissed": False}).sort("created_at", -1).to_list(length=None)
    return {"items": items, "alerts": clean(alerts)}


# ---------------------------------------------------------------- alerts

@router.get("/alerts")
async def list_alerts(user: dict = Depends(workspace), include_dismissed: bool = False) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"user_id": user["id"], "active": True}
    if not include_dismissed:
        q["dismissed"] = False
    return clean(await get_db().alerts.find(q).sort("created_at", -1).to_list(length=None))


@router.patch("/alerts/{alert_id}")
async def update_alert(alert_id: str, body: AlertUpdate, user: dict = Depends(workspace)) -> dict[str, Any]:
    db = get_db()
    al = await db.alerts.find_one({"_id": _oid(alert_id, "Alert"), "user_id": user["id"]})
    if not al:
        raise HTTPException(404, "Alert not found")
    await db.alerts.update_one({"_id": al["_id"]}, {"$set": {k: v for k, v in body.model_dump(exclude_none=True).items()}})
    return clean(await db.alerts.find_one({"_id": al["_id"]}))
