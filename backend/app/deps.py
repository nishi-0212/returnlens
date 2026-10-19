from __future__ import annotations

from typing import Any

from bson import ObjectId
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_db
from .security import decode_token
from .services.workspaces import scope_of

bearer = HTTPBearer(auto_error=False)


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any]:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")
    user_id = decode_token(creds.credentials)
    if not user_id or not ObjectId.is_valid(user_id):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.")
    user = await get_db().users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    user["id"] = str(user["_id"])
    return user


async def workspace(user: dict = Depends(current_user),
                    x_workspace_id: str | None = Header(default=None)) -> dict[str, Any]:
    """The signed-in user's current workspace. `id` is the data scope used by every query."""
    if not x_workspace_id or not ObjectId.is_valid(x_workspace_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select or create a workspace first")
    p = await get_db().workspaces.find_one({"_id": ObjectId(x_workspace_id), "user_id": user["id"]})
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return {**user, "id": scope_of(user["id"], x_workspace_id), "user_id": user["id"],
            "workspace_id": x_workspace_id, "workspace": p}


def db_dep() -> Any:
    return get_db()
