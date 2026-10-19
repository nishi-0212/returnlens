import io

import pandas as pd
import pytest

from app.services import ingest
from tests.helpers import SAMPLE


@pytest.mark.parametrize("name,kind", [("orders.csv", "orders"), ("returns.csv", "returns"), ("products.csv", "products"),
                                       ("reviews.csv", "reviews"), ("shipments.csv", "shipments"), ("batches.csv", "batches"),
                                       ("inspections.csv", "inspections"), ("change_log.csv", "changes")])
def test_detects_every_sample_file(name, kind):
    (_, df), = ingest.read_tables((SAMPLE / name).read_bytes(), name)
    assert ingest.detect_kind(list(df.columns)) == kind
    res = ingest.parse_rows(df, kind)
    assert res.records and not [e for e in res.errors if e["level"] == "error"]


def test_maps_different_column_names():
    df = pd.DataFrame({"RMA Number": ["R1"], "Order No": ["O1"], "Product SKU": ["ab-1"], "Returned On": ["03/04/2026"],
                       "Reason Code": ["Too small"], "Comments": ["runs small"], "Refunded": ["$1,250.00"]})
    assert ingest.detect_kind(list(df.columns)) == "returns"
    rec = ingest.parse_rows(df, "returns").records[0]
    assert rec["return_id"] == "R1" and rec["order_id"] == "O1" and rec["sku"] == "AB-1"
    assert rec["refund_amount"] == 1250.0 and rec["return_date"].year == 2026


def test_bad_rows_are_reported_and_skipped():
    df = pd.DataFrame({"Order ID": ["A", "B", "C", ""], "SKU": ["X", "X", "", "X"],
                       "Order Date": ["2026-01-01", "not a date", "2026-01-02", "2026-01-02"], "Quantity": ["1", "1", "1", "1"]})
    res = ingest.parse_rows(df, "orders")
    assert len(res.records) == 1
    fields = {e["field"] for e in res.errors if e["level"] == "error"}
    assert {"order_date", "sku", "order_id"} <= fields
    assert all(e["row"] for e in res.errors if e["level"] == "error")


def test_negative_values_rejected():
    df = pd.DataFrame({"Order ID": ["A"], "SKU": ["X"], "Order Date": ["2026-01-01"], "Quantity": ["-2"]})
    assert not ingest.parse_rows(df, "orders").records


def test_missing_required_column():
    df = pd.DataFrame({"Order ID": ["A"], "Order Date": ["2026-01-01"]})
    res = ingest.parse_rows(df, "orders")
    assert not res.records and "Missing column" in res.errors[0]["message"]


def test_excel_with_several_sheets():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf) as xw:
        pd.DataFrame({"Order ID": ["A"], "SKU": ["X"], "Order Date": ["2026-01-01"]}).to_excel(xw, sheet_name="Orders", index=False)
        pd.DataFrame({"SKU": ["X"], "Product Name": ["Thing"], "Category": ["Home"]}).to_excel(xw, sheet_name="Catalog", index=False)
    sheets = ingest.read_tables(buf.getvalue(), "data.xlsx")
    kinds = {name: ingest.detect_kind(list(df.columns), name) for name, df in sheets}
    assert kinds == {"Orders": "orders", "Catalog": "products"}


def test_inspection_report_document():
    res = ingest.parse_document((SAMPLE / "QA_report_B-SN-0601.docx").read_bytes(), "QA_report_B-SN-0601.docx",
                                {"SNK-TR"}, {"B-SN-0601"})
    rec = res.records[0]
    assert res.kind == "inspections" and rec["batch_id"] == "B-SN-0601" and rec["result"] == "conditional"
    assert "shorter" in rec["findings"]


def test_text_document_without_ids_is_rejected_clearly():
    res = ingest.parse_document(b"hello there", "note.txt", {"SNK-TR"}, set())
    assert not res.records and "batch ID" in res.errors[0]["message"]


def test_unknown_extension():
    with pytest.raises(ingest.UploadError):
        ingest.read_tables(b"x", "file.exe")


@pytest.mark.parametrize("raw,expected", [("7.8%", 0.078), ("0.078", 0.078), ("12", 0.12), ("abc", None)])
def test_parse_rate(raw, expected):
    assert ingest.parse_rate(raw) == expected
