"""API integration tests: the main workflows through HTTP with an in-memory database."""
from tests.conftest import register


async def test_auth_required(client):
    assert (await client.get("/api/overview")).status_code == 401
    assert (await client.get("/api/workspaces")).status_code == 401


async def test_register_login_and_bad_password(client):
    await register(client, "a@x.com")
    ok = await client.post("/api/auth/login", json={"email": "a@x.com", "password": "correct-horse-1"})
    bad = await client.post("/api/auth/login", json={"email": "a@x.com", "password": "nope-nope-1"})
    assert ok.status_code == 200 and bad.status_code == 401
    assert (await client.post("/api/auth/register", json={"name": "A", "email": "a@x.com", "password": "correct-horse-1"})).status_code == 409


async def test_upload_validation_and_report(client, auth):
    csv = b"Order ID,SKU,Order Date,Quantity\nA1,X-1,2026-05-01,1\nA2,,2026-05-02,1\nA3,X-1,soon,1\n"
    r = await client.post("/api/uploads", headers=auth, files={"file": ("orders.csv", csv, "text/csv")})
    assert r.status_code == 201
    up = r.json()["upload"]
    assert up["status"] == "partial" and up["rows_imported"] == 1 and len(up["errors"]) == 2
    assert r.json()["job"] is None and "returns" in r.json()["waiting_for"]  # analysis waits for returns
    bad = await client.post("/api/uploads", headers=auth, files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 415


async def test_full_workflow_with_sample_data(client, auth):
    r = await client.post("/api/demo/sample", headers=auth)
    assert r.status_code == 200 and r.json()["job"]["status"] == "done"
    ov = (await client.get("/api/overview", headers=auth)).json()
    assert ov["has_data"] and ov["kpis"]["return_rate"] > 0 and ov["run"]["version"] == 1
    # filters
    f = (await client.get("/api/overview", headers=auth, params={"sku": "EB-200", "date_from": "2026-04-01"})).json()
    assert f["kpis"]["units"] < ov["kpis"]["units"]
    assert (await client.get("/api/overview", headers=auth, params={"date_from": "yesterday"})).status_code == 422
    # complaint groups
    groups = (await client.get("/api/complaints", headers=auth)).json()["groups"]
    sizing = next(g for g in groups if g["key"] == "sizing")
    assert sizing["orders_affected"] > 0 and sizing["examples"] and sizing["variants"]
    recs_page = (await client.get("/api/complaints/sizing/records", headers=auth, params={"limit": 5})).json()
    assert recs_page["total"] > 5 and len(recs_page["items"]) == 5
    # findings and the investigation page
    findings = (await client.get("/api/findings", headers=auth)).json()
    eb = next(x for x in findings if "B-EB-0712" in x["title"])
    assert eb["status"] == "confirmed" and eb["recommendation"]["status"] == "proposed"
    detail = (await client.get(f"/api/findings/{eb['id']}", headers=auth)).json()
    assert detail["finding"]["evidence"]["inspections"] and detail["complaint_group"]["key"] == "defective"
    ev = detail["finding"]["evidence"]["returns"][0]
    rec = (await client.get(f"/api/records/return/{ev['id']}", headers=auth)).json()
    assert rec["record"]["return_id"] == ev["id"] and rec["order"]
    # costs + assumptions
    costs = (await client.get("/api/costs", headers=auth)).json()
    assert costs["summary"]["actual"] > 0 and costs["by_cause"] and costs["assumptions_text"]
    put = await client.put("/api/costs/assumptions", headers=auth, json={"handling_per_return": 9})
    assert put.json()["values"]["handling_per_return"] == 9
    assert (await client.put("/api/costs/assumptions", headers=auth, json={"handling_per_return": -1})).status_code == 422
    # recommendations: approve, reject, complete with a date
    recs = (await client.get("/api/recommendations", headers=auth)).json()
    a, b = recs[0], recs[-1]
    assert (await client.patch(f"/api/recommendations/{a['id']}", headers=auth, json={"status": "approved"})).json()["status"] == "approved"
    assert (await client.patch(f"/api/recommendations/{b['id']}", headers=auth, json={"status": "rejected"})).json()["status"] == "rejected"
    assert (await client.patch(f"/api/recommendations/{a['id']}", headers=auth, json={"status": "done"})).status_code == 422
    done = (await client.patch(f"/api/recommendations/{a['id']}", headers=auth,
                               json={"status": "completed", "implemented_at": "2026-08-01"})).json()
    assert done["status"] == "completed" and done["implemented_at"].startswith("2026-08-01")
    future = await client.patch(f"/api/recommendations/{a['id']}", headers=auth, json={"status": "completed", "implemented_at": "2099-01-01"})
    assert future.status_code == 422
    v = (await client.get(f"/api/recommendations/{a['id']}/verification", headers=auth)).json()
    assert v["verdict"] in ("improved", "worsened", "inconclusive", "too_early")
    # re-running doesn't duplicate recommendations
    n = len(recs)
    await client.post("/api/analysis/run", headers=auth)
    assert len((await client.get("/api/recommendations", headers=auth)).json()) == n


async def test_new_data_changes_the_analysis(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    r = await client.post("/api/demo/update", headers=auth, json={"simulate_fixes": True})
    assert r.status_code == 200 and len(r.json()["marked_completed"]) == 3
    runs = (await client.get("/api/runs", headers=auth)).json()
    assert runs[0]["version"] == 2 and runs[0]["changes"]
    board = (await client.get("/api/verification", headers=auth)).json()
    verdicts = {i["recommendation"]["cause"]: i["verification"]["verdict"] for i in board["items"]}
    assert verdicts["packaging"] == "improved" and verdicts["manufacturing"] == "improved"
    assert any(a["kind"] == "reappeared" for a in board["alerts"])
    al = board["alerts"][0]
    assert (await client.patch(f"/api/alerts/{al['id']}", headers=auth, json={"dismissed": True})).json()["dismissed"]


async def test_workspaces_are_isolated(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    other = await register(client, "b@x.com", "B")
    assert (await client.get("/api/overview", headers=other)).json()["has_data"] is False
    assert (await client.get("/api/findings", headers=other)).json() == []
    # another user's workspace id is refused
    assert (await client.get("/api/overview", headers={**other, "X-Workspace-Id": auth["X-Workspace-Id"]})).status_code == 404
    mine = (await client.get("/api/findings", headers=auth)).json()
    assert (await client.get(f"/api/findings/{mine[0]['id']}", headers=other)).status_code == 404


async def test_empty_workspace_reused(client, auth):
    base = {"Authorization": auth["Authorization"]}
    a = (await client.post("/api/workspaces", headers=base, json={})).json()
    b = (await client.post("/api/workspaces", headers=base, json={})).json()
    assert a["id"] == b["id"] == auth["X-Workspace-Id"]
