"""Sample store data so every workflow can be tried without any integration.

The files describe a store whose data ends on 2026-10-15. Dates are shifted on load so the story
always ends "today": the base files run until about six weeks ago, and the update adds the most
recent six weeks.
"""
from __future__ import annotations

import asyncio

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..db import get_db
from ..deps import workspace
from ..serialize import clean
from ..services.analysis import record_event
from ..services.importer import import_file
from ..services.ingest import UploadError
from ..services.jobs import runner
from ..services.utils import now_utc
from ..services.workspaces import delete_scope_data, touch

router = APIRouter(prefix="/api/demo", tags=["sample data"])

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"
SAMPLE_ANCHOR = date(2026, 10, 17)       # "today" in the sample files
FIX_DATE = date(2026, 9, 1)             # when the simulated fixes go live
BASE_FILES = {
    "products.csv": "Product catalogue with categories, suppliers, costs and descriptions",
    "batches.csv": "Manufacturing batches per SKU and supplier",
    "orders.csv": "Order lines with batch and shipment IDs (5½ months)",
    "shipments.csv": "Carrier, warehouse, dates and damage scans",
    "returns.csv": "Returns with reasons, comments, refunds and label costs",
    "reviews.csv": "Customer reviews and ratings",
    "inspections.csv": "Quality inspection results per batch",
    "change_log.csv": "Listing, packaging and supplier changes",
    "QA_report_B-SN-0601.docx": "A supplier QA report (Word document)",
}
UPDATE_FILES = {
    "update/orders_sep_oct.csv": "The next six weeks of orders",
    "update/shipments_sep_oct.csv": "Shipments for those orders",
    "update/returns_sep_oct.csv": "Returns logged in that month",
    "update/reviews_sep_oct.csv": "Reviews from that month",
    "update/change_log_sep_oct.csv": "The fixes: packaging, listing, sneaker last, blender batch",
}
# the fixes the simulation marks as implemented (matched on the finding they belong to)
SIMULATED_FIXES = [("packaging", "MUG-4"), ("manufacturing", "EB-200"), ("product_description", "SH-LIN"),
                   ("supplier_change", "SNK-TR"), ("manufacturing", "BLN-1"), ("shipping", "VASE-1")]


def shift_days() -> int:
    return (now_utc().date() - SAMPLE_ANCHOR).days


async def _load(user: dict[str, Any], files: list[str], label: str) -> dict[str, Any]:
    db = get_db()
    offset = shift_days()

    async def one(rel: str) -> dict[str, Any]:
        path = SAMPLE_DIR / rel
        try:
            up, _ = await import_file(db, user["id"], path.name, path.read_bytes(), shift_days=offset)
        except UploadError as exc:
            raise HTTPException(422, f"{rel}: {exc}") from exc
        return up
    # tables go in side by side; documents after, because they're matched against the SKUs and batches just loaded
    tables = [f for f in files if not f.endswith((".docx", ".pdf", ".txt", ".md"))]
    docs = [f for f in files if f not in tables]
    uploads = list(await asyncio.gather(*(one(f) for f in tables)))
    for f in docs:
        uploads.append(await one(f))
    await touch(db, user["id"], name_if_untitled="Sample store")
    job = await runner.enqueue(user["id"], trigger="upload", label=label)
    await record_event(db, user["id"], "upload", f"{label}: {len(files)} file(s) imported")
    return {"uploads": clean(uploads), "job": clean(job)}


@router.post("/sample")
async def load_sample(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Load six months of store data with several planted problems, then run the analysis."""
    return await _load(user, list(BASE_FILES), "Sample store")


class UpdateIn(BaseModel):
    simulate_fixes: bool = True


@router.post("/update")
async def load_update(body: UpdateIn, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Add the next six weeks of data. With simulate_fixes, first mark six recommended fixes as implemented
    on the day the update starts: five that really worked in the data and one (ParcelPro) whose problem comes back."""
    db = get_db()
    if not await db.orders.find_one({"user_id": user["id"]}):
        raise HTTPException(409, "Load the sample store first")
    marked = []
    if body.simulate_fixes:
        if not await db.runs.find_one({"user_id": user["id"]}):
            raise HTTPException(409, "Wait for the first analysis to finish, then try again")
        when = datetime.combine(FIX_DATE + timedelta(days=shift_days()), datetime.min.time(), tzinfo=timezone.utc)
        recs = await db.recommendations.find({"user_id": user["id"]}).to_list(length=None)
        for cause, sku in SIMULATED_FIXES:
            rec = next((r for r in recs if r.get("cause") == cause and sku in (r.get("scope") or {}).get("skus", [])
                        and r.get("status") != "rejected"), None)
            if not rec or rec.get("status") == "completed":
                continue
            await db.recommendations.update_one({"_id": rec["_id"]}, {
                "$set": {"status": "completed", "implemented_at": when, "updated_at": now_utc()},
                "$push": {"history": {"at": now_utc(), "status": "completed",
                                      "note": f"Marked implemented on {when.date()} by the sample-data simulation"}}})
            marked.append(rec["title"])
    out = await _load(user, list(UPDATE_FILES), "Next month of data")
    out["marked_completed"] = marked
    return out


@router.get("/files")
async def sample_files() -> list[dict[str, Any]]:
    return [{"name": f, "about": about, "size": (SAMPLE_DIR / f).stat().st_size,
             "batch": "base" if f in BASE_FILES else "update"} for f, about in {**BASE_FILES, **UPDATE_FILES}.items()]


@router.get("/files/{name:path}")
async def download_sample(name: str) -> FileResponse:
    """Download a sample file (useful as a template for your own data)."""
    if name not in BASE_FILES and name not in UPDATE_FILES:
        raise HTTPException(404, "No such sample file")
    return FileResponse(SAMPLE_DIR / name, filename=Path(name).name)


@router.delete("/data")
async def reset_workspace(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Delete all data, findings, recommendations and alerts in the current workspace."""
    await runner.cancel_scope(user["id"])
    from ..services.dataset import forget
    forget(user["id"])
    return {"removed": await delete_scope_data(get_db(), user["id"])}
