"""Workspaces: separate data sets listed under Recents (create, rename, delete, clear all)."""
from __future__ import annotations

import asyncio

from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..deps import current_user
from ..serialize import clean
from ..services.jobs import runner
from ..services.workspaces import DEFAULT_NAME, create_workspace, delete_scope_data, is_empty, scope_of, stats
from ..services.utils import now_utc

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class WorkspaceIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)


async def _out(p: dict[str, Any]) -> dict[str, Any]:
    out = clean(p)
    out["stats"] = await stats(get_db(), scope_of(str(p["user_id"]), str(p["_id"])))
    return out


async def _get(user: dict, workspace_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(workspace_id):
        raise HTTPException(404, "Workspace not found")
    p = await get_db().workspaces.find_one({"_id": ObjectId(workspace_id), "user_id": user["id"]})
    if not p:
        raise HTTPException(404, "Workspace not found")
    return p


@router.get("")
async def list_workspaces(user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    db = get_db()
    items = await db.workspaces.find({"user_id": user["id"]}).sort("updated_at", -1).to_list(length=None)
    if not items:
        items = [await create_workspace(db, user["id"])]  # first visit
    return list(await asyncio.gather(*(_out(p) for p in items)))


@router.post("", status_code=201)
async def new_workspace(body: WorkspaceIn, user: dict = Depends(current_user)) -> dict[str, Any]:
    """Start a new workspace. An existing empty one is reused, so clicking "New workspace" twice never leaves
    blank workspaces behind; it only shows up in Recents once data is added."""
    db = get_db()
    items = await db.workspaces.find({"user_id": user["id"]}).sort("updated_at", -1).to_list(length=None)
    flags = await asyncio.gather(*(is_empty(db, scope_of(user["id"], str(p["_id"]))) for p in items))
    empty = [p for p, e in zip(items, flags) if e]
    if not empty:
        return await _out(await create_workspace(db, user["id"], body.name))
    keep, extra = empty[0], empty[1:]
    for p in extra:
        await _delete(user, p)
    await db.workspaces.update_one({"_id": keep["_id"]}, {"$set": {
        "updated_at": now_utc(), "name": (body.name or "").strip()[:80] or DEFAULT_NAME}})
    return await _out(await _get(user, str(keep["_id"])))


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    return await _out(await _get(user, workspace_id))


@router.patch("/{workspace_id}")
async def rename_workspace(workspace_id: str, body: WorkspaceIn, user: dict = Depends(current_user)) -> dict[str, Any]:
    p = await _get(user, workspace_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, "Name can't be empty")
    await get_db().workspaces.update_one({"_id": p["_id"]}, {"$set": {"name": name[:80]}})
    return await _out(await _get(user, workspace_id))


async def _delete(user: dict, p: dict[str, Any]) -> None:
    scope = scope_of(user["id"], str(p["_id"]))
    await runner.cancel_scope(scope)
    await delete_scope_data(get_db(), scope)
    await get_db().workspaces.delete_one({"_id": p["_id"]})


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(workspace_id: str, user: dict = Depends(current_user)) -> None:
    """Delete a workspace and everything in it. Stops its analysis first if one is running."""
    await _delete(user, await _get(user, workspace_id))


@router.delete("", status_code=204)
async def clear_all(user: dict = Depends(current_user)) -> None:
    """Delete every workspace (Recents → Clear all)."""
    for p in await get_db().workspaces.find({"user_id": user["id"]}).to_list(length=None):
        await _delete(user, p)
