"""Load the sample store into pandas without a database (for engine tests)."""
from __future__ import annotations

from pathlib import Path

from app.services import clustering, dataset, ingest

SAMPLE = Path(__file__).resolve().parent.parent / "app" / "sample_data"
BASE = ["products.csv", "batches.csv", "orders.csv", "shipments.csv", "returns.csv", "reviews.csv", "inspections.csv",
        "change_log.csv"]
UPDATE = ["update/orders_sep_oct.csv", "update/shipments_sep_oct.csv", "update/returns_sep_oct.csv",
          "update/reviews_sep_oct.csv", "update/change_log_sep_oct.csv"]
COLS = {
    "orders": (["order_id", "sku", "order_date", "qty", "unit_price", "customer_id", "batch_id", "shipment_id", "region",
                "supplier_id"], ["order_date"]),
    "returns": (["return_id", "order_id", "sku", "return_date", "qty", "reason", "comment", "refund_amount",
                 "return_shipping_cost", "replacement_cost", "handling_cost", "resolution", "condition", "cluster", "theme",
                 "cluster_conf"], ["return_date"]),
    "reviews": (["review_id", "sku", "order_id", "date", "rating", "text", "cluster", "theme", "cluster_conf"], ["date"]),
    "products": (["sku", "name", "category", "supplier_id", "supplier_name", "unit_cost", "price", "description"], []),
    "batches": (["batch_id", "sku", "supplier_id", "supplier_name", "produced_date", "received_date", "units"],
                ["produced_date", "received_date"]),
    "inspections": (["inspection_id", "batch_id", "sku", "supplier_id", "date", "result", "defect_rate", "findings",
                     "source"], ["date"]),
    "changes": (["change_id", "date", "sku", "supplier_id", "change_type", "label", "description"], ["date"]),
    "shipments": (["shipment_id", "order_id", "carrier", "warehouse", "ship_date", "delivery_date", "damaged"],
                  ["ship_date", "delivery_date"]),
}


def records(files: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {k: [] for k in ingest.KINDS}
    for f in files:
        for sheet, df in ingest.read_tables((SAMPLE / f).read_bytes(), f):
            kind = ingest.detect_kind(list(df.columns), sheet)
            out[kind] += ingest.parse_rows(df, kind, sheet).records
    doc = ingest.parse_document((SAMPLE / "QA_report_B-SN-0601.docx").read_bytes(), "QA_report_B-SN-0601.docx",
                                {r["sku"] for r in out["products"]}, {r["batch_id"] for r in out["batches"]})
    out["inspections"] += doc.records
    return out


def load(include_update: bool = False) -> dataset.Data:
    recs = records(BASE + (UPDATE if include_update else []))
    frames = {k: dataset._frame(recs[k], *COLS[k]) for k in COLS}
    d = dataset.Data(frames["orders"], frames["returns"], frames["reviews"], frames["products"], frames["batches"],
                     frames["inspections"], frames["changes"], frames["shipments"])
    d.returns["cluster"] = [clustering.classify(a, b).category for a, b in zip(d.returns["reason"], d.returns["comment"])]
    d.reviews["cluster"] = [clustering.classify(None, t).category if clustering.is_complaint_review(r, t) else "positive"
                            for r, t in zip(d.reviews["rating"], d.reviews["text"])]
    return dataset.link(d)
