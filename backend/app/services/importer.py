"""Save parsed records: validate, normalize, upsert by natural key, and report what happened."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from . import ingest
from .ingest import ParseResult, UploadError
from .utils import now_utc

log = logging.getLogger("returnlens.importer")

COLLECTION = {k: k for k in ingest.KINDS}
DATE_FIELDS = {"orders": ["order_date"], "returns": ["return_date"], "reviews": ["date"],
               "shipments": ["ship_date", "delivery_date"], "batches": ["produced_date", "received_date"],
               "inspections": ["date"], "changes": ["date"], "products": []}
CHUNK = 1000


def _shift(records: list[dict[str, Any]], kind: str, days: int) -> None:
    if not days:
        return
    for r in records:
        for f in DATE_FIELDS.get(kind, []):
            if r.get(f):
                r[f] = r[f] + timedelta(days=days)
        if kind == "changes":  # keep the change ID stable but date-aware
            r["change_id"] = r["key"]


async def _known(db: Any, scope: str, coll: str, field: str) -> set[str]:
    return {v for v in await db[coll].distinct(field, {"user_id": scope}) if v}


async def _save(db: Any, scope: str, kind: str, records: list[dict[str, Any]], upload_id: str) -> dict[str, int]:
    """Upsert by natural key. Products merge field by field so a partial file never wipes known values."""
    coll = db[COLLECTION[kind]]
    now = now_utc()
    created = updated = 0
    if kind == "products":
        for r in records:
            r = {k: v for k, v in r.items() if v is not None and k != "_partial"}
            res = await coll.update_one({"user_id": scope, "key": r["key"]},
                                        {"$set": {**r, "user_id": scope, "updated_at": now, "upload_id": upload_id}},
                                        upsert=True)
            created += 1 if getattr(res, "upserted_id", None) else 0
            updated += 0 if getattr(res, "upserted_id", None) else 1
        return {"created": created, "updated": updated}
    for i in range(0, len(records), CHUNK):
        chunk = records[i:i + CHUNK]
        keys = [r["key"] for r in chunk]
        existing = await coll.count_documents({"user_id": scope, "key": {"$in": keys}})
        if existing:
            await coll.delete_many({"user_id": scope, "key": {"$in": keys}})
        docs = [{**r, "user_id": scope, "upload_id": upload_id, "created_at": now} for r in chunk]
        await coll.insert_many(docs, ordered=False)
        updated += existing
        created += len(chunk) - existing
    return {"created": created, "updated": updated}


async def import_file(db: Any, scope: str, filename: str, content: bytes, kind_hint: str | None = None,
                      shift_days: int = 0) -> tuple[dict[str, Any], bool]:
    """Returns (upload record, whether any data changed)."""
    ext = ingest.extension(filename)
    if ext not in ingest.ALLOWED_EXT:
        raise UploadError(f"{ext or 'Files without an extension'} can't be uploaded. Use CSV, XLSX, TXT, MD, DOCX or PDF.")
    upload: dict[str, Any] = {"user_id": scope, "filename": filename, "size": len(content), "status": "processing",
                              "created_at": now_utc(), "sheets": [], "errors": [], "warnings": []}
    res = await db.uploads.insert_one(upload)
    upload["_id"] = res.inserted_id
    upload_id = str(res.inserted_id)

    results: list[ParseResult] = []
    try:
        if ext in ingest.TABLE_EXT:
            for sheet, df in ingest.read_tables(content, filename):
                kind = kind_hint if kind_hint in ingest.KINDS else ingest.detect_kind(list(df.columns), sheet)
                if not kind:
                    r = ParseResult(kind="unknown", rows_total=len(df), sheet=sheet)
                    where = filename if sheet == "csv" else f"sheet '{sheet}'"
                    r.errors.append({"row": None, "field": None, "level": "error", "sheet": sheet,
                                     "message": f"Couldn't tell what {where} holds. Columns found: "
                                                f"{', '.join(map(str, list(df.columns)[:10]))}. Pick the type "
                                                f"from the 'File holds' menu or rename the columns."})
                    results.append(r)
                    continue
                results.append(ingest.parse_rows(df, kind, sheet))
        else:
            skus = await _known(db, scope, "products", "sku") | await _known(db, scope, "orders", "sku")
            batches = await _known(db, scope, "batches", "batch_id") | await _known(db, scope, "orders", "batch_id")
            results.append(ingest.parse_document(content, filename, skus, batches))
    except UploadError as exc:
        await db.uploads.update_one({"_id": upload["_id"]}, {"$set": {"status": "failed", "errors": [
            {"row": None, "field": None, "message": str(exc), "level": "error"}]}})
        raise

    changed = False
    for r in results:
        _shift(r.records, r.kind, shift_days)
        saved = {"created": 0, "updated": 0}
        if r.kind in ingest.KINDS and r.records:
            saved = await _save(db, scope, r.kind, r.records, upload_id)
            changed = True
        errs = [e for e in r.errors if e.get("level") != "warning"]
        warns = [e for e in r.errors if e.get("level") == "warning"]
        upload["sheets"].append({"sheet": r.sheet, "kind": r.kind, "rows": r.rows_total, "imported": len(r.records),
                                 "skipped": len({e.get('row') for e in errs if e.get('row')}), **saved})
        upload["errors"].extend(errs)
        upload["warnings"].extend(warns)
    imported = sum(s["imported"] for s in upload["sheets"])
    upload["errors"], upload["warnings"] = upload["errors"][:200], upload["warnings"][:50]
    upload["status"] = "failed" if imported == 0 else ("partial" if upload["errors"] else "done")
    upload["kinds"] = sorted({s["kind"] for s in upload["sheets"] if s["kind"] in ingest.KINDS})
    upload["rows_imported"] = imported
    await db.uploads.update_one({"_id": upload["_id"]}, {"$set": {k: upload[k] for k in (
        "sheets", "errors", "warnings", "status", "kinds", "rows_imported")}})
    if changed:
        from .workspaces import bump_version
        await bump_version(db, scope)
    log.info("Imported %s: %d rows (%s)", filename, imported, upload["status"])
    return upload, changed
