"""Workspaces are separate data sets (like chats): each has its own orders, returns, findings and actions.

All workspace data is stored with `user_id` = "<user id>:<workspace id>" (the *scope*), so every
query is automatically limited to the signed-in user's current workspace (authorization by design).
"""
from __future__ import annotations

import asyncio

from typing import Any

from bson import ObjectId

from .utils import now_utc

DEFAULT_NAME = "Untitled workspace"
DATA_COLLECTIONS = ["orders", "returns", "products", "reviews", "shipments", "batches", "inspections", "changes"]
SCOPED_COLLECTIONS = DATA_COLLECTIONS + ["uploads", "jobs", "events", "runs", "findings", "recommendations", "alerts",
                                         "settings"]


def scope_of(user_id: str, workspace_id: str) -> str:
    return f"{user_id}:{workspace_id}"


def split_scope(scope: str) -> tuple[str, str | None]:
    uid, _, pid = scope.partition(":")
    return uid, (pid or None)


async def create_workspace(db: Any, user_id: str, name: str | None = None) -> dict[str, Any]:
    now = now_utc()
    doc = {"user_id": user_id, "name": (name or DEFAULT_NAME).strip()[:80] or DEFAULT_NAME,
           "created_at": now, "updated_at": now}
    res = await db.workspaces.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


async def is_empty(db: Any, scope: str) -> bool:
    """No data yet. Empty workspaces are hidden from Recents and reused by "New workspace"."""
    found = await asyncio.gather(*(db[c].find_one({"user_id": scope}, {"_id": 1}) for c in DATA_COLLECTIONS))
    if any(found):
        return False
    return await db.jobs.count_documents({"user_id": scope, "status": {"$in": ["queued", "running"]}}) == 0


async def touch(db: Any, scope: str, name_if_untitled: str | None = None) -> None:
    """Mark a workspace as recently used; give it a real name the first time data arrives."""
    _, pid = split_scope(scope)
    if not pid or not ObjectId.is_valid(pid):
        return
    p = await db.workspaces.find_one({"_id": ObjectId(pid)})
    if not p:
        return
    changes: dict[str, Any] = {"updated_at": now_utc()}
    if name_if_untitled and p.get("name") == DEFAULT_NAME:
        changes["name"] = name_if_untitled[:80]
    await db.workspaces.update_one({"_id": p["_id"]}, {"$set": changes})


async def delete_scope_data(db: Any, scope: str) -> dict[str, int]:
    removed = {}
    for c in SCOPED_COLLECTIONS:
        res = await db[c].delete_many({"user_id": scope})
        removed[c] = res.deleted_count
    return removed


async def stats(db: Any, scope: str) -> dict[str, Any]:
    """Counts for the step track and Recents. All queries go out together (one round trip of waiting, not 15)."""
    q = lambda c, extra=None: db[c].count_documents({"user_id": scope, **(extra or {})})  # noqa: E731
    keys = ["orders", "returns", "reviews", "products", "uploads", "findings", "confirmed", "verified", "improved", "alerts", "running"]
    calls = [q("orders"), q("returns"), q("reviews"), q("products"), q("uploads"),
             q("findings", {"active": True}), q("findings", {"active": True, "status": "confirmed"}),
             q("recommendations", {"status": "completed", "verification.verdict": {"$in": ["improved", "worsened", "inconclusive"]}}),
             q("recommendations", {"status": "completed", "verification.verdict": "improved"}),
             q("alerts", {"active": True, "dismissed": False, "read": False}),
             q("jobs", {"status": {"$in": ["queued", "running"]}})]
    run, recs, *counts = await asyncio.gather(
        db.runs.find_one({"user_id": scope}, {"version": 1, "kpis": 1, "clusters.counts": 1}, sort=[("version", -1)]),
        db.recommendations.find({"user_id": scope}, {"status": 1}).to_list(length=None), *calls)
    n = dict(zip(keys, counts))
    kpis = (run or {}).get("kpis", {})
    by = lambda s: sum(1 for r in recs if r.get("status") == s)  # noqa: E731
    return {
        "orders": n["orders"], "returns": n["returns"], "reviews": n["reviews"], "products": n["products"], "uploads": n["uploads"],
        "analyzed": bool(run), "run_version": (run or {}).get("version"),
        "return_rate": kpis.get("return_rate"), "refunds": kpis.get("refunds"), "currency": kpis.get("currency", "USD"),
        "findings": n["findings"], "confirmed": n["confirmed"],
        "clusters": sum(1 for k, c in ((run or {}).get("clusters") or {}).get("counts", {}).items() if c and k != "other"),
        "recs_total": len(recs), "recs_proposed": by("proposed"), "recs_approved": by("approved"),
        "recs_rejected": by("rejected"), "recs_completed": by("completed"),
        "verified": n["verified"], "improved": n["improved"], "alerts": n["alerts"], "running": n["running"] > 0,
    }


async def bump_version(db: Any, scope: str) -> None:
    """Data changed (upload or analysis): invalidates the in-memory data cache."""
    _, pid = split_scope(scope)
    if pid and ObjectId.is_valid(pid):
        await db.workspaces.update_one({"_id": ObjectId(pid)}, {"$inc": {"data_version": 1}})


async def data_version(db: Any, scope: str) -> int:
    _, pid = split_scope(scope)
    if not pid or not ObjectId.is_valid(pid):
        return 0
    w = await db.workspaces.find_one({"_id": ObjectId(pid)})
    return int((w or {}).get("data_version", 0))
