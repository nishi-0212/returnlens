"""Corrective actions for findings.

Each finding gets one recommendation whose wording comes from the detected cause and the actual
scope (batch, carrier, supplier, change). Priority follows money and certainty; the expected impact
is the finding's monthly cost times a conservative reduction for that kind of fix.

Recommendations are keyed by the finding key, so re-running the analysis never duplicates them.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from .utils import now_utc

# owner, days to deadline, expected reduction of the problem's returns, action type
PLAYBOOK = {
    "manufacturing": ("Quality lead", 7, 0.7, "batch_inspection"),
    "supplier_change": ("Sourcing manager", 10, 0.6, "supplier_review"),
    "packaging": ("Packaging & operations", 14, 0.6, "packaging_test"),
    "shipping": ("Logistics manager", 10, 0.5, "carrier_review"),
    "product_description": ("Merchandising / content", 5, 0.5, "listing_revision"),
    "sizing": ("Merchandising / content", 5, 0.4, "size_guidance"),
    "fulfillment": ("Warehouse lead", 7, 0.6, "fulfillment_audit"),
}


def _title_and_steps(f: dict[str, Any], sup: dict[str, str]) -> tuple[str, list[str]]:
    cause, dim, val = f["cause"], f["dimension"], f["value"]
    prods = ", ".join(f["products"])
    cl = f["cluster_label"].lower()
    if cause == "manufacturing" and dim == "batch":
        return (f"Inspect batch {val} and open a supplier quality review",
                [f"Quarantine unsold stock from batch {val} and test a sample for the {cl} fault.",
                 "Share the failure details and return evidence with the supplier and request a corrective action plan (8D).",
                 f"Check later batches of {prods} before release."])
    if cause == "manufacturing":
        return (f"Run a quality review of {prods} with the supplier",
                [f"Test returned units to find what exactly fails ({cl}).", "Ask the supplier for QC records and process changes.",
                 "Tighten incoming inspection until the rate drops."])
    if cause == "supplier_change":
        when = f" since {f.get('change_date')}" if f.get("change_date") else ""
        return (f"Compare the new supplier's {prods} against the original spec",
                [f"Measure units made{when} against the spec and the previous supplier's samples.",
                 "Share the findings with the supplier and agree a fix before the next reorder.",
                 "Until fixed, add a fit note to the listing so customers order the right size." if f["cluster"] == "sizing"
                 else "Until fixed, inspect incoming stock from this supplier."])
    if cause == "packaging":
        return (f"Test improved packaging for {prods}",
                ["Run drop tests on the current box vs a double-wall box with dividers or corner protection.",
                 "Ship a trial batch in the better packaging and compare damage returns.",
                 "Roll out if damage falls; compare the cost of packaging against the returns it prevents."])
    if cause == "shipping" and f["cluster"] == "late_delivery":
        carrier = val if dim == "carrier" else "the affected carrier"
        return (f"Review delivery times with {carrier}",
                [f"Compare promised vs actual delivery days for {carrier} on the affected orders.",
                 "Agree service levels or move time-sensitive orders to a faster carrier.",
                 "Show realistic delivery dates at checkout for slower routes."])
    if cause == "shipping":
        carrier = val if dim == "carrier" else "the affected carrier"
        return (f"Review damage handling with {carrier}",
                [f"Share damage rates and examples with {carrier} and file claims for documented damage.",
                 f"Check which hubs and routes the damaged {prods} orders went through.",
                 f"Route fragile items to a carrier with lower damage, or add 'fragile' handling, until it improves."])
    if cause == "product_description":
        return (f"Revise the {prods} listing: photos, description and specs",
                ["Compare the current photos and text with the actual product (colour, material, measurements).",
                 "Re-shoot or colour-correct photos and fix any wrong claims in the description.",
                 "Add the exact material composition and a true-to-life colour note."])
    if cause == "sizing":
        return (f"Improve the size chart and fit guidance for {prods}",
                ["Measure finished products and update the size chart with real measurements.",
                 "Add fit guidance on the listing (e.g. 'runs small, order one size up').",
                 "Ask customers their usual size at checkout or in a fit quiz."])
    if cause == "fulfillment":
        return (f"Audit picking and labelling for {prods}",
                ["Check pick/pack logs for the affected orders.", "Separate look-alike items and verify labels.",
                 "Add a scan check at packing for this SKU."])
    return (f"Investigate {cl} on {prods}", ["Review the evidence and decide on an owner."])


def build(f: dict[str, Any], monthly_cost: float, total_cost: float, max_monthly: float, currency: str,
          labels: dict[str, dict[str, str]]) -> dict[str, Any]:
    owner, days, reduction, action_type = PLAYBOOK.get(f["cause"], ("Operations", 14, 0.4, "investigation"))
    title, steps = _title_and_steps(f, labels.get("supplier_id", {}))
    share = monthly_cost / max_monthly if max_monthly else 0
    if f["status"] == "confirmed" or (f["status"] == "likely" and share >= 0.4):
        priority = "P1"
    elif f["status"] == "likely" or share >= 0.25:
        priority = "P2"
    else:
        priority = "P3"
    if f["status"] == "possible":
        days += 7
    savings = round(monthly_cost * reduction, 2)
    impact = (f"About {int(reduction * 100)}% fewer {f['cluster_label'].lower()} returns on {', '.join(f['products'])}, "
              f"worth roughly {currency} {savings:,.0f} a month.")
    if f["status"] != "confirmed":
        steps = ["First verify the cause: " + (f["missing_data"][0] if f.get("missing_data") else "collect more evidence.")] + steps
    return {
        "finding_key": f["key"], "title": title, "steps": steps, "action_type": action_type, "cause": f["cause"],
        "owner": owner, "priority": priority, "expected_impact": impact, "expected_monthly_savings": savings,
        "expected_reduction": reduction, "due_date": (now_utc() + timedelta(days=days)).date().isoformat(),
        "scope": {"skus": f["skus"], "cluster": f["cluster"], "dimension": f["dimension"], "value": f["value"],
                  "change_date": f.get("change_date")},
        "finding_status": f["status"], "monthly_cost": round(monthly_cost, 2), "total_cost": round(total_cost, 2),
    }
