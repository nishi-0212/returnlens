"""The analysis run for a workspace: cluster complaints, investigate root causes, cost them,
recommend fixes, check completed fixes and raise alerts. Results are saved as a numbered run so
the app can show what changed when new data arrives.
"""
from __future__ import annotations

import asyncio

import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

import pandas as pd

from ..config import get_settings
from . import ai, analytics, clustering, costs, dataset, investigate, recommend, verify
from .utils import now_utc

log = logging.getLogger("returnlens.analysis")
StageFn = Callable[[str, str | None], Awaitable[None]]
STAGES = [("reading", "Reading data"), ("clustering", "Grouping complaints"), ("analyzing", "Return analytics"),
          ("investigating", "Investigating causes"), ("costing", "Financial impact"),
          ("recommending", "Recommending fixes"), ("checking", "Checking fixes & alerts")]


async def _noop(_: str, __: str | None = None) -> None:
    return None


async def record_event(db: Any, scope: str, kind: str, text: str) -> None:
    await db.events.insert_one({"user_id": scope, "kind": kind, "text": text, "at": now_utc()})


async def get_assumptions(db: Any, scope: str) -> dict[str, Any]:
    doc = await db.settings.find_one({"user_id": scope, "kind": "cost_assumptions"})
    return costs.merge((doc or {}).get("values"))


async def gather_limited(coros: list[Any], limit: int = 16) -> list[Any]:
    """Run DB/AI calls side by side (a remote database answers each call in ~100-300 ms, so doing
    them one after another is what makes an analysis slow), but never more than `limit` at once."""
    sem = asyncio.Semaphore(limit)

    async def one(c: Any) -> Any:
        async with sem:
            return await c
    return await asyncio.gather(*(one(c) for c in coros))


# ---------------------------------------------------------------- step 1: complaint groups

async def assign_clusters(db: Any, scope: str, d: dataset.Data) -> dict[str, Any]:
    """Classify every return and review; let the LLM place what the rules couldn't; save the labels."""
    r, v = d.returns, d.reviews
    rmatch = [clustering.classify(a, b) for a, b in zip(r["reason"], r["comment"])]
    r_cluster = [m.category for m in rmatch]
    r_conf = [m.confidence for m in rmatch]
    r_method = [m.method for m in rmatch]
    v_cluster, v_conf, v_method = [], [], []
    for rating, text in zip(v["rating"], v["text"]):
        if not clustering.is_complaint_review(rating, text):
            v_cluster.append("positive"), v_conf.append(1.0), v_method.append("rating")
            continue
        m = clustering.classify(None, text)
        v_cluster.append(m.category), v_conf.append(m.confidence), v_method.append(m.method)

    llm_used = 0
    if get_settings().llm_enabled:
        pending = [{"id": f"r:{rid}", "text": clustering.normalize(f"{reason or ''}. {comment or ''}")[:300]}
                   for rid, reason, comment, c in zip(r["return_id"], r["reason"], r["comment"], r_cluster)
                   if c == "other" and len(clustering.normalize(comment).split()) >= 3]
        pending += [{"id": f"v:{vid}", "text": clustering.normalize(t)[:300]}
                    for vid, t, c in zip(v["review_id"], v["text"], v_cluster) if c == "other"]
        if pending:
            placed = await ai.classify_unmatched(pending[:120])
            llm_used = len(placed)
            for i, rid in enumerate(r["return_id"]):
                g = placed.get(f"r:{rid}")
                if g:
                    r_cluster[i], r_conf[i], r_method[i] = g, 0.7, "llm"
            for i, vid in enumerate(v["review_id"]):
                g = placed.get(f"v:{vid}")
                if g:
                    v_cluster[i], v_conf[i], v_method[i] = g, 0.7, "llm"

    r = r.assign(cluster=r_cluster, cluster_conf=r_conf, cluster_method=r_method)
    v = v.assign(cluster=v_cluster, cluster_conf=v_conf, cluster_method=v_method)
    d.returns, d.reviews = r, v
    writes = []
    for coll, frame, idcol in (("returns", r, "return_id"), ("reviews", v, "review_id")):
        if frame.empty:
            continue
        for (c, conf, meth), g in frame.groupby(["cluster", "cluster_conf", "cluster_method"]):
            writes.append(db[coll].update_many({"user_id": scope, "key": {"$in": g[idcol].tolist()}},
                                               {"$set": {"cluster": c, "cluster_conf": float(conf), "cluster_method": meth}}))
    await gather_limited(writes)
    counts = pd.Series(r_cluster).value_counts().to_dict() if r_cluster else {}
    return {"counts": {k: int(n) for k, n in counts.items()}, "llm_classified": llm_used,
            "unclassified": int(counts.get("other", 0))}


# ---------------------------------------------------------------- the run

async def run_analysis(db: Any, scope: str, trigger: str = "manual", on_stage: StageFn | None = None) -> dict[str, Any]:
    stage = on_stage or _noop
    settings = get_settings()
    await stage("reading", None)
    d = await dataset.load(db, scope)
    if d.empty:
        raise ValueError("No orders or returns yet. Upload data first.")
    a = await get_assumptions(db, scope)
    await stage("reading", f"{d.links['orders']:,} order lines · {d.links['returns']:,} returns · {d.links['reviews']:,} reviews")

    await stage("clustering", None)
    cl = await assign_clusters(db, scope, d)
    groups = sum(1 for k, n in cl["counts"].items() if n and k != "other")
    await stage("clustering", f"{groups} complaint groups" + (f" · AI placed {cl['llm_classified']}" if cl["llm_classified"] else ""))

    await stage("analyzing", None)
    labels = analytics.labels_for(d)
    f0 = analytics.Filters()
    ov = analytics.overview(d, f0, a)
    spikes = ov["baseline"]["spikes"]
    await stage("analyzing", f"Return rate {ov['kpis']['return_rate']:.1%} · {len(spikes)} unusual increase(s)")

    await stage("investigating", None)
    r_cost = costs.apply(d.returns, a)
    findings = dataset.plain(investigate.investigate(d, r_cost, labels))
    source = "rules"
    if settings.llm_enabled:
        texts = await gather_limited([ai.narrate_finding(f) for f in findings[:6]], limit=3)
        for f, text in zip(findings[:6], texts):
            if text:
                f["summary_rules"] = f["summary"]
                f["summary"] = text.summary
                f["alternatives"] = (f["alternatives"] + [x for x in text.alternative_explanations
                                                          if x not in f["alternatives"]])[:5]
                f["source"] = "ai"
                source = "ai"
    n_conf = sum(1 for f in findings if f["status"] == "confirmed")
    await stage("investigating", f"{len(findings)} finding(s) · {n_conf} confirmed")

    await stage("costing", None)
    by_id = r_cost.set_index("return_id")
    max_monthly = 0.0
    for f in findings:
        rows = by_id.loc[by_id.index.intersection(f["return_ids"])]
        span = (rows["cohort_date"].max() - rows["cohort_date"].min()).days if len(rows) > 1 else 30
        months = max(1.0, span / 30)
        f["cost"] = {"total": round(float(rows["cost_total"].sum()), 2), "actual": round(float(rows["cost_actual"].sum()), 2),
                     "estimated": round(float(rows["cost_estimated"].sum()), 2),
                     "refunds": round(float(rows["refund"].sum()), 2), "units": int(rows["qty"].sum()),
                     "returns": int(len(rows)), "monthly": round(float(rows["cost_total"].sum()) / months, 2),
                     "lines": costs.summarize(rows)["lines"]}
        f["orders_affected"] = int(rows["order_id"].nunique())
        max_monthly = max(max_monthly, f["cost"]["monthly"])
    # tag each return with its root cause (finding) for filters and cost-by-cause
    await gather_limited([db.returns.update_many({"user_id": scope, "cluster": cluster_key},
                                                 {"$set": {"cause": meta["cause"], "finding_key": None}})
                          for cluster_key, meta in clustering.CATEGORIES.items()])
    await gather_limited([db.returns.update_many({"user_id": scope, "key": {"$in": f["return_ids"]}},
                                                 {"$set": {"cause": f["cause"], "finding_key": f["key"]}})
                          for f in findings if f["return_ids"]])
    total_cost = sum(f["cost"]["total"] for f in findings)
    await stage("costing", f"{a['currency']} {total_cost:,.0f} traced to findings")

    await stage("recommending", None)
    prev = await db.runs.find_one({"user_id": scope}, sort=[("version", -1)])
    version = (prev["version"] + 1) if prev else 1
    now = now_utc()
    seen = {f["key"] for f in findings}

    async def save(f: dict[str, Any]) -> bool:
        old, existing = await asyncio.gather(db.findings.find_one({"user_id": scope, "key": f["key"]}),
                                             db.recommendations.find_one({"user_id": scope, "finding_key": f["key"]}))
        doc = {k: v for k, v in f.items() if k != "return_ids"}
        doc.update({"user_id": scope, "active": True, "last_run": version, "updated_at": now,
                    "return_count": len(f["return_ids"]), "return_ids": f["return_ids"][:500]})
        if old:
            hist = old.get("history", [])
            if old.get("status") != f["status"] or not old.get("active", True):
                hist = hist + [{"run": version, "at": now, "status": f["status"],
                                "note": "Detected again" if not old.get("active", True) else f"Status {old.get('status')} → {f['status']}"}]
            doc["history"] = hist[-20:]
            doc["first_run"] = old.get("first_run", version)
            write = db.findings.update_one({"_id": old["_id"]}, {"$set": doc})
        else:
            doc.update({"first_run": version, "created_at": now,
                        "history": [{"run": version, "at": now, "status": f["status"], "note": "First detected"}]})
            write = db.findings.insert_one(doc)
        rec = dataset.plain(recommend.build(f, f["cost"]["monthly"], f["cost"]["total"], max_monthly, a["currency"], labels))
        if existing:  # keep the user's decisions; refresh what the data says
            rec_write = db.recommendations.update_one({"_id": existing["_id"]}, {"$set": {
                "finding_status": rec["finding_status"], "monthly_cost": rec["monthly_cost"], "total_cost": rec["total_cost"],
                "expected_monthly_savings": rec["expected_monthly_savings"], "expected_impact": rec["expected_impact"],
                "finding_active": True, "updated_at": now}})
        else:
            rec_write = db.recommendations.insert_one({**rec, "user_id": scope, "status": "proposed", "finding_active": True,
                                                       "implemented_at": None, "created_at": now, "updated_at": now,
                                                       "created_in_run": version, "history": [
                                                           {"at": now, "status": "proposed", "note": "Recommended by analysis"}]})
        await asyncio.gather(write, rec_write)
        return not existing

    new_recs = sum(await gather_limited([save(f) for f in findings], limit=8))
    gone = await db.findings.find({"user_id": scope, "active": True, "key": {"$nin": list(seen)}}).to_list(length=None)
    await gather_limited([x for g in gone for x in (
        db.findings.update_one({"_id": g["_id"]}, {"$set": {"active": False, "updated_at": now}, "$push": {
            "history": {"run": version, "at": now, "status": "resolved", "note": "No longer detected in the latest data"}}}),
        db.recommendations.update_many({"user_id": scope, "finding_key": g["key"]}, {"$set": {"finding_active": False}}))])
    await stage("recommending", f"{new_recs} new recommendation(s)")

    await stage("checking", None)
    alerts_made = await refresh_checks(db, scope, d, spikes)
    await stage("checking", f"{alerts_made} new alert(s)")

    # what changed since the last run
    prev_keys = {x["key"]: x for x in (prev or {}).get("findings", [])}
    changes = []
    for f in findings:
        p = prev_keys.get(f["key"])
        if not p and prev:
            changes.append({"kind": "new_finding", "text": f"New: {f['title']} ({f['status']})"})
        elif p and p["status"] != f["status"]:
            changes.append({"kind": "status", "text": f"{f['title']}: {p['status']} → {f['status']}"})
    for g in gone:
        changes.append({"kind": "resolved", "text": f"No longer detected: {g['title']}"})
    if prev:
        pr, nr = prev["kpis"]["return_rate"], ov["kpis"]["return_rate"]
        if abs(nr - pr) >= 0.002:
            changes.insert(0, {"kind": "rate", "text": f"Return rate {pr:.1%} → {nr:.1%}"})
    run = {"user_id": scope, "version": version, "trigger": trigger, "source": source, "created_at": now,
           "kpis": ov["kpis"], "links": d.links, "clusters": cl, "spikes": spikes[:10],
           "findings": [{"key": f["key"], "title": f["title"], "status": f["status"], "cause": f["cause"],
                         "cost": f["cost"]["total"]} for f in findings],
           "changes": changes[:20], "summary": _summary(findings, ov, changes, prev is None),
           "data_range": ov["range"]}
    run = dataset.plain(run)
    await db.runs.insert_one(run)
    from .workspaces import bump_version
    await bump_version(db, scope)
    await record_event(db, scope, "analysis", f"Analysis #{version}: {run['summary']}")
    return run


def _summary(findings: list[dict[str, Any]], ov: dict[str, Any], changes: list[dict[str, Any]], first: bool) -> str:
    k = ov["kpis"]
    head = (f"{k['return_rate']:.1%} return rate, {len(findings)} root-cause finding(s) "
            f"({sum(1 for f in findings if f['status'] == 'confirmed')} confirmed)")
    if not first and changes:
        head += f"; {len(changes)} change(s) since the last run"
    return head


async def refresh_checks(db: Any, scope: str, d: dataset.Data | None = None,
                         spikes: list[dict[str, Any]] | None = None) -> int:
    """Re-verify completed actions and update alerts. Cheap: no clustering or AI. Returns new alerts."""
    if d is None:
        d = await dataset.load(db, scope)
    if d.empty:
        return 0
    if spikes is None:
        spikes = analytics.compare_baseline(d, analytics.Filters(), labels=analytics.labels_for(d))["spikes"]
    recs = await db.recommendations.find({"user_id": scope, "status": "completed"}).to_list(length=None)
    for x in recs:
        x["id"] = str(x["_id"])
    ver = {x["id"]: dataset.plain(verify.verify(x, d)) for x in recs}
    now = now_utc()
    await gather_limited([db.recommendations.update_one({"_id": x["_id"]}, {"$set": {
        "verification": {k: ver[x["id"]].get(k) for k in ("verdict", "headline", "detail", "before", "after", "relative_change",
                                                          "p_value", "after_days")},
        "verified_at": now}}) for x in recs])
    current = dataset.plain(verify.alerts(d, recs, ver, spikes))

    async def upsert(al: dict[str, Any]) -> bool:
        old = await db.alerts.find_one({"user_id": scope, "key": al["key"]})
        if old:
            await db.alerts.update_one({"_id": old["_id"]}, {"$set": {**al, "updated_at": now, "active": True}})
            return False
        await db.alerts.insert_one({**al, "user_id": scope, "created_at": now, "updated_at": now, "read": False,
                                    "dismissed": False, "active": True})
        return True
    made = sum(await gather_limited([upsert(al) for al in current]))
    active_keys = {al["key"] for al in current}
    await db.alerts.update_many({"user_id": scope, "key": {"$nin": list(active_keys)}}, {"$set": {"active": False}})
    return made


__all__ = ["STAGES", "run_analysis", "refresh_checks", "get_assumptions", "record_event", "timedelta"]
