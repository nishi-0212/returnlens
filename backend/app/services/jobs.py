"""Background analysis queue.

A lightweight in-process asyncio worker (no Redis/Celery needed, so it runs on one Render instance).
One analysis per workspace at a time; if new data arrives while it runs, it runs once more after.
Each job stores live stage progress in MongoDB so the UI can draw it, and a running job can be stopped.
A daily check re-verifies completed fixes and refreshes alerts without re-running the full analysis.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from bson import ObjectId

from ..config import get_settings
from ..db import get_db
from .analysis import STAGES, record_event, refresh_checks, run_analysis
from .workspaces import touch
from .utils import now_utc

log = logging.getLogger("returnlens.jobs")
FINISHED = ("done", "failed", "cancelled")


class JobRunner:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] | None = None
        self.worker: asyncio.Task | None = None
        self.running: dict[str, asyncio.Task] = {}
        self.monitor: asyncio.Task | None = None

    async def start(self) -> None:
        self.queue = asyncio.Queue()
        self.worker = asyncio.create_task(self._loop(), name="analysis-worker")
        db = get_db()
        stale = await db.jobs.find({"status": {"$in": ["queued", "running"]}}).to_list(length=None)
        for j in stale:
            await db.jobs.update_one({"_id": j["_id"]}, {"$set": {"status": "queued"}})
            await self.queue.put(str(j["_id"]))
        log.info("Analysis worker started (%d job(s) resumed)", len(stale))
        if get_settings().monitor_enabled:
            self.monitor = asyncio.create_task(self._watch(), name="daily-check")

    async def stop(self) -> None:
        if self.monitor:
            self.monitor.cancel()
            self.monitor = None
        for t in list(self.running.values()):
            t.cancel()
        if self.worker:
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass
        self.worker = None

    async def _watch(self) -> None:
        """Scheduled re-check: verify completed fixes and refresh alerts in every workspace, once a day."""
        while True:
            try:
                await self.daily_check()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Daily check failed")
            await asyncio.sleep(max(5, get_settings().monitor_interval_minutes) * 60)

    async def daily_check(self) -> int:
        db = get_db()
        today = now_utc().date().isoformat()
        made = 0
        for ws in await db.workspaces.find({}).to_list(length=None):
            if ws.get("checked_on") == today:
                continue
            scope = f"{ws['user_id']}:{ws['_id']}"
            if await db.runs.count_documents({"user_id": scope}):
                n = await refresh_checks(db, scope)
                made += n
                if n:
                    await record_event(db, scope, "alert", f"Daily check: {n} new alert(s)")
            await db.workspaces.update_one({"_id": ws["_id"]}, {"$set": {"checked_on": today}})
        return made

    async def enqueue(self, scope: str, trigger: str, label: str | None = None) -> dict[str, Any]:
        db = get_db()
        active = await db.jobs.find_one({"user_id": scope, "status": {"$in": ["queued", "running"]}})
        if active:  # new data during a run: run once more afterwards
            await db.jobs.update_one({"_id": active["_id"]}, {"$set": {"rerun": True}})
            return active
        job = {"user_id": scope, "type": "analyze", "status": "queued", "trigger": trigger, "label": label or "Analysis",
               "stages": [{"key": k, "label": lbl, "status": "pending", "detail": None} for k, lbl in STAGES],
               "error": None, "run_version": None, "rerun": False, "created_at": now_utc(), "started_at": None,
               "finished_at": None}
        res = await db.jobs.insert_one(job)
        job["_id"] = res.inserted_id
        job_id = str(res.inserted_id)
        if get_settings().analysis_inline or self.queue is None:
            await self.run(job_id)
            job = await db.jobs.find_one({"_id": res.inserted_id}) or job
        else:
            await self.queue.put(job_id)
        return job

    async def cancel(self, job_id: str) -> bool:
        db = get_db()
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
        if not job or job["status"] in FINISHED:
            return False
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "cancelled", "finished_at": now_utc(),
                                                                "rerun": False}})
        task = self.running.get(job_id)
        if task:
            task.cancel()
        await self._mark_stopped(job["_id"])
        await record_event(db, job["user_id"], "job", "Analysis stopped")
        return True

    async def _mark_stopped(self, oid: Any) -> None:
        job = await get_db().jobs.find_one({"_id": oid})
        if not job:
            return
        upd = {f"stages.{i}.status": "stopped" for i, s in enumerate(job.get("stages") or [])
               if s.get("status") in ("pending", "running")}
        if upd:
            await get_db().jobs.update_one({"_id": oid}, {"$set": upd})

    async def cancel_scope(self, scope: str) -> None:
        db = get_db()
        for j in await db.jobs.find({"user_id": scope, "status": {"$in": ["queued", "running"]}}).to_list(length=None):
            await self.cancel(str(j["_id"]))

    async def _loop(self) -> None:
        assert self.queue is not None
        while True:
            job_id = await self.queue.get()
            try:
                await self.run(job_id)
            except Exception:
                log.exception("Job %s crashed", job_id)
            finally:
                self.queue.task_done()

    async def run(self, job_id: str) -> None:
        db = get_db()
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
        if not job or job["status"] in FINISHED:
            return
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "running", "started_at": now_utc()}})
        index = {s["key"]: i for i, s in enumerate(job["stages"])}
        current: dict[str, str | None] = {"key": None}

        async def on_stage(key: str, detail: str | None) -> None:
            i = index[key]
            upd: dict[str, Any] = {f"stages.{i}.status": "done" if detail else "running"}
            if detail:
                upd[f"stages.{i}.detail"] = detail
            current["key"] = key
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": upd})

        task = asyncio.ensure_future(run_analysis(db, job["user_id"], trigger=job["trigger"], on_stage=on_stage))
        self.running[job_id] = task
        try:
            run = await task
        except asyncio.CancelledError:
            await db.jobs.update_one({"_id": job["_id"], "status": {"$ne": "cancelled"}},
                                     {"$set": {"status": "cancelled", "finished_at": now_utc()}})
            await self._mark_stopped(job["_id"])
            return
        except Exception as exc:
            log.exception("Analysis failed for %s", job["user_id"])
            upd = {"status": "failed", "error": str(exc)[:300], "finished_at": now_utc()}
            if current["key"]:
                upd[f"stages.{index[current['key']]}.status"] = "failed"
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": upd})
            return
        finally:
            self.running.pop(job_id, None)
        fresh = await db.jobs.find_one({"_id": job["_id"]})
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "done", "finished_at": now_utc(),
                                                                "run_version": run["version"], "summary": run["summary"]}})
        await touch(db, job["user_id"])
        if fresh and fresh.get("rerun"):
            await self.enqueue(job["user_id"], "upload", "Analysis (new data)")


runner = JobRunner()
