"""The analysis engines on the sample store: planted problems must be found with the right certainty."""
from datetime import timedelta

import pytest

from app.services import analytics, costs, investigate, recommend, stats, verify
from tests.helpers import load


@pytest.fixture(scope="module")
def base():
    return load()


@pytest.fixture(scope="module")
def findings(base):
    r = costs.apply(base.returns, costs.DEFAULTS)
    return investigate.investigate(base, r, analytics.labels_for(base))


def _find(findings, cause, sku):
    return next((f for f in findings if f["cause"] == cause and sku in f["skus"]), None)


def test_links_every_return_to_its_order(base):
    assert base.links["returns_unmatched"] == 0
    assert base.links["batches_inferred"] > 0  # some orders had no batch and got one from the batch table


def test_confirmed_batch_defect_needs_the_inspection_record(findings):
    f = _find(findings, "manufacturing", "EB-200")
    assert f and f["status"] == "confirmed" and f["value"] == "B-EB-0712"
    assert f["evidence"]["inspections"][0]["id"] == "INSP-0419"


def test_carrier_damage_confirmed_by_damage_scans(findings):
    f = _find(findings, "shipping", "VASE-1")
    assert f and f["value"] == "ParcelPro" and f["status"] == "confirmed" and f["evidence"]["shipments"]


def test_change_points_found(findings):
    pack = _find(findings, "packaging", "MUG-4")
    listing = _find(findings, "product_description", "SH-LIN")
    sizing = _find(findings, "supplier_change", "SNK-TR")
    assert pack and pack["status"] == "likely" and pack["change_date"] == "2026-06-15"
    assert listing and listing["status"] == "likely" and listing["change_date"] == "2026-07-20"
    assert sizing and sizing["status"] == "confirmed"  # the QA document documents the short last


def test_correlation_alone_is_never_confirmed(findings):
    blender = _find(findings, "manufacturing", "BLN-1")
    assert blender and blender["status"] == "likely"  # no inspection report for that batch
    assert any("inspection report" in m for m in blender["missing_data"])
    for f in findings:
        if f["status"] == "confirmed":
            assert f["corroborated"]


def test_every_finding_has_evidence_alternatives_and_missing_data(findings):
    for f in findings:
        assert f["evidence"]["returns"] and f["alternatives"] and f["missing_data"] and 0 < f["confidence"] <= 1
        assert f["tests"]


def test_costs_split_actual_and_estimated(base):
    r = costs.apply(base.returns, costs.DEFAULTS)
    s = costs.summarize(r)
    assert s["actual"] > 0 and s["estimated"] > 0 and abs(s["actual"] + s["estimated"] - s["total"]) < 0.05
    ship = next(x for x in s["lines"] if x["line"] == "reverse_ship")
    assert ship["actual"] > 0 and ship["estimated"] > 0  # some labels recorded, some estimated
    wo = next(x for x in s["lines"] if x["line"] == "write_off")
    assert wo["actual"] == 0  # write-offs are always estimates


def test_assumptions_change_estimates_only(base):
    a = costs.merge({"handling_per_return": 20})
    r1, r2 = costs.apply(base.returns, costs.DEFAULTS), costs.apply(base.returns, a)
    assert costs.summarize(r2)["estimated"] > costs.summarize(r1)["estimated"]
    assert costs.summarize(r2)["actual"] == costs.summarize(r1)["actual"]


def test_overview_and_baselines(base):
    ov = analytics.overview(base, analytics.Filters(), costs.DEFAULTS)
    k = ov["kpis"]
    assert 0.05 < k["return_rate"] < 0.12 and k["affected_products"] == 12
    assert any(s["key"] == "EB-200" for s in ov["baseline"]["spikes"])
    assert any(b["batch"] == "B-EB-0712" and b["unusual"] for b in ov["batch_outliers"])
    assert ov["trend"] and {"sku", "supplier", "category", "batch", "reason", "month"} <= set(ov["by"])


def test_filters(base):
    f = analytics.Filters.parse(sku="EB-200")
    o, r, _ = analytics.scoped(base, f)
    assert set(o["sku"]) == {"EB-200"} and set(r["sku"]) == {"EB-200"}
    f = analytics.Filters.parse(date_from="2026-06-01", date_to="2026-06-30")
    o, _, _ = analytics.scoped(base, f)
    assert o["order_date"].min().month == 6 and o["order_date"].max().month == 6


def test_recommendation_matches_cause(findings):
    f = _find(findings, "packaging", "MUG-4")
    rec = recommend.build(f, 1000, 3000, 1000, "USD", {})
    assert "packaging" in rec["title"].lower() and rec["priority"] in ("P1", "P2") and rec["owner"]
    assert rec["steps"][0].startswith("First verify")  # likely, not confirmed


def test_verification_improved_inconclusive_and_too_early():
    d = load(include_update=True)
    impl = "2026-09-01"
    packaging = {"id": "x", "implemented_at": impl, "scope": {"skus": ["MUG-4"], "cluster": "packaging_damage"}}
    v = verify.verify(packaging, d)
    assert v["verdict"] == "improved" and v["after"]["rate"] < v["before"]["rate"]
    assert v["before"]["end"] < v["after"]["start"]
    jeans = {"id": "y", "implemented_at": impl, "scope": {"skus": ["DNM-SL"], "cluster": "sizing"}}
    assert verify.verify(jeans, d)["verdict"] == "inconclusive"  # nothing changed for jeans
    late = {"id": "z", "implemented_at": (d.end - timedelta(days=5)).date().isoformat(),
            "scope": {"skus": ["MUG-4"], "cluster": "packaging_damage"}}
    assert verify.verify(late, d)["verdict"] == "too_early"


def test_stats():
    z, p = stats.z_test(30, 100, 10, 100)
    assert z > 0 and p < 0.01
    assert stats.z_test(10, 100, 10, 100)[1] == pytest.approx(0.5)
    lo, hi = stats.wilson(5, 100)
    assert lo < 0.05 < hi


def test_finding_carries_headline_rate_and_lift(findings):
    f = _find(findings, "manufacturing", "EB-200")
    assert f["lift"] > 2 and f["rate"] > f["rate_elsewhere"]


def test_daily_rates_mark_recent_orders_as_settling(base):
    days = analytics.daily(base.orders, base.returns, base.end)
    assert days and all(0 <= d["rate"] <= 1 for d in days)
    assert days[-1]["maturing"] and not days[0]["maturing"]


def test_casefile_peers_and_timeline(base, findings):
    from app.services import casefile
    f = _find(findings, "manufacturing", "EB-200")
    p = casefile.peers(base, f)
    hit = next(r for r in p["rows"] if r["highlight"])
    assert hit["value"] == "B-EB-0712" and hit["rate"] > p["usual"]["high"]
    kinds = [e["kind"] for e in casefile.timeline(base, f, None)]
    assert "inspection" in kinds and "first" in kinds and kinds == [e["kind"] for e in sorted(casefile.timeline(base, f, None), key=lambda e: e["date"])]
