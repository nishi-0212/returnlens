"""Turn uploaded files into validated records in one standard schema.

Pure functions only (no database), so they are easy to test.

Record types (the "kind" of a table) and their standard fields:

* orders       order_id, sku, order_date, qty, unit_price, customer_id, batch_id, shipment_id, region, supplier_id
* returns      return_id, order_id, sku, return_date, qty, reason, comment, refund_amount, return_shipping_cost,
               replacement_cost, handling_cost, resolution, condition
* products     sku, name, category, supplier_id, supplier_name, unit_cost, price, description
* reviews      review_id, sku, order_id, date, rating, text
* shipments    shipment_id, order_id, carrier, warehouse, ship_date, delivery_date, damaged
* batches      batch_id, sku, supplier_id, supplier_name, produced_date, received_date, units
* inspections  inspection_id, batch_id, sku, supplier_id, date, result, defect_rate, findings
* changes      date, sku, supplier_id, change_type, description   (listing updates, supplier/packaging changes …)

Column names are matched through synonyms, so "RMA #", "Order Number" or "Item SKU" all work.
A workbook may hold several kinds, one per sheet. Documents (TXT/MD/DOCX/PDF) are read as
quality inspection reports when they mention a batch ID, otherwise as product notes.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .utils import clean_str, fingerprint, is_blank, norm_header, parse_date, parse_money

TABLE_EXT = {".csv", ".xlsx", ".xls"}
DOC_EXT = {".txt", ".md", ".docx", ".pdf"}
ALLOWED_EXT = TABLE_EXT | DOC_EXT
KINDS = ("orders", "returns", "products", "reviews", "shipments", "batches", "inspections", "changes")

COLUMNS: dict[str, dict[str, list[str]]] = {
    "orders": {
        "order_id": ["order_id", "order", "order_number", "order_no", "order_ref", "id"],
        "sku": ["sku", "item_sku", "product_sku", "product_id", "item_id", "product_code", "asin"],
        "order_date": ["order_date", "date", "ordered_at", "created_at", "purchase_date", "order_created"],
        "qty": ["quantity", "qty", "units", "quantity_ordered", "qty_ordered", "items"],
        "unit_price": ["unit_price", "price", "item_price", "selling_price", "sale_price"],
        "customer_id": ["customer_id", "customer", "buyer_id", "client_id"],
        "batch_id": ["batch", "batch_id", "lot", "lot_number", "lot_id", "batch_number"],
        "shipment_id": ["shipment_id", "tracking_id", "tracking_number", "awb", "shipment"],
        "region": ["region", "city", "state", "ship_to", "zone"],
        "supplier_id": ["supplier_id", "supplier", "vendor_id", "vendor"],
    },
    "returns": {
        "return_id": ["rma", "return_id", "rma_number", "rma_id", "return_number", "return_no", "id"],
        "order_id": ["order_id", "order_number", "order", "order_no", "order_ref"],
        "sku": ["sku", "item_sku", "product_sku", "product_id", "item_id", "product_code"],
        "return_date": ["return_date", "returned_on", "date", "return_created", "created_at", "returned_at"],
        "qty": ["qty_returned", "quantity", "qty", "units_returned", "return_qty", "units"],
        "reason": ["return_reason", "reason", "reason_code", "return_reason_code"],
        "comment": ["customer_comment", "comment", "comments", "return_comment", "notes", "customer_notes", "feedback"],
        "refund_amount": ["refund_amount", "refund", "refunded", "refund_value", "amount_refunded"],
        "return_shipping_cost": ["return_label_cost", "return_shipping_cost", "reverse_shipping", "return_shipping",
                                 "reverse_logistics_cost", "label_cost"],
        "replacement_cost": ["replacement_cost", "replacement_value"],
        "handling_cost": ["handling_cost", "processing_cost", "restocking_cost"],
        "resolution": ["resolution", "return_type", "outcome", "refund_or_replace"],
        "condition": ["item_condition", "condition", "return_condition"],
    },
    "products": {
        "sku": ["sku", "product_sku", "product_id", "item_sku", "product_code"],
        "name": ["product_name", "name", "title", "product", "item_name"],
        "category": ["category", "product_category", "department", "type"],
        "supplier_id": ["supplier_id", "supplier", "vendor_id", "vendor"],
        "supplier_name": ["supplier_name", "vendor_name"],
        "unit_cost": ["unit_cost", "cost", "cogs", "landed_cost"],
        "price": ["price", "list_price", "retail_price", "mrp", "selling_price"],
        "description": ["description", "product_description", "listing_description", "details"],
    },
    "reviews": {
        "review_id": ["review_id", "id"],
        "sku": ["sku", "product_sku", "product_id", "item_sku"],
        "order_id": ["order_id", "order_number", "order"],
        "date": ["review_date", "date", "created_at", "posted_on"],
        "rating": ["rating", "stars", "score", "star_rating"],
        "text": ["review", "review_text", "text", "comment", "body", "content"],
    },
    "shipments": {
        "shipment_id": ["tracking_id", "shipment_id", "tracking_number", "awb", "shipment"],
        "order_id": ["order_id", "order_number", "order"],
        "carrier": ["carrier", "courier", "shipping_partner", "logistics_partner"],
        "warehouse": ["warehouse", "fulfillment_center", "fc", "origin", "dispatch_center"],
        "ship_date": ["shipped_on", "ship_date", "shipped_at", "dispatch_date"],
        "delivery_date": ["delivered_on", "delivery_date", "delivered_at"],
        "damaged": ["damage_reported", "damaged", "carrier_damage", "damage_flag", "exception"],
    },
    "batches": {
        "batch_id": ["batch_id", "batch", "lot", "lot_number", "batch_number"],
        "sku": ["sku", "product_sku", "product_id"],
        "supplier_id": ["supplier_id", "supplier", "vendor_id", "vendor"],
        "supplier_name": ["supplier_name", "vendor_name"],
        "produced_date": ["production_date", "produced_on", "manufactured_on", "mfg_date"],
        "received_date": ["received_date", "received_on", "inbound_date", "arrival_date"],
        "units": ["units", "quantity", "qty", "batch_size"],
    },
    "inspections": {
        "inspection_id": ["inspection_id", "report_id", "qc_id", "id"],
        "batch_id": ["batch_id", "batch", "lot", "lot_number"],
        "sku": ["sku", "product_sku", "product_id"],
        "supplier_id": ["supplier_id", "supplier", "vendor"],
        "date": ["inspection_date", "date", "inspected_on"],
        "result": ["result", "status", "outcome", "verdict"],
        "defect_rate": ["defect_rate", "defect_pct", "defects_pct", "aql_defect_rate"],
        "findings": ["findings", "notes", "comments", "defects", "observations"],
    },
    "changes": {
        "date": ["date", "change_date", "effective_date", "changed_on"],
        "sku": ["sku", "product_sku", "product_id"],
        "supplier_id": ["supplier_id", "supplier", "new_supplier"],
        "change_type": ["change_type", "type", "event", "event_type", "change"],
        "description": ["description", "details", "notes", "summary"],
    },
}

# Columns that only one kind has: they decide what a table is.
SIGNATURE = {
    "orders": ({"order_id", "sku", "order_date"}, {"qty", "unit_price", "customer_id", "batch_id", "shipment_id"}),
    "returns": ({"reason"}, {"return_id", "refund_amount", "return_date", "comment", "return_shipping_cost", "condition"}),
    "products": ({"sku", "name"}, {"category", "unit_cost", "price", "description", "supplier_id"}),
    "reviews": ({"rating", "text"}, {"sku", "review_id", "date"}),
    "shipments": ({"carrier"}, {"shipment_id", "ship_date", "delivery_date", "damaged", "warehouse"}),
    "batches": ({"batch_id", "sku"}, {"received_date", "produced_date", "units"}),
    "inspections": ({"result"}, {"inspection_id", "defect_rate", "findings", "batch_id"}),
    "changes": ({"change_type", "date"}, {"description", "sku"}),
}

CHANGE_TYPES = {
    "listing_update": ["listing", "description", "photo", "image", "content", "title", "copy"],
    "supplier_change": ["supplier", "vendor", "factory", "manufacturer", "production"],
    "packaging_change": ["packaging", "package", "box", "packing"],
    "size_chart_update": ["size chart", "sizing", "size guide", "fit guide"],
    "carrier_change": ["carrier", "courier", "shipping partner", "logistics"],
    "price_change": ["price", "pricing", "discount"],
}

BATCH_RE = re.compile(r"\b(?:B|LOT|BATCH)[-_ ]?[A-Z0-9]{1,6}[-_][A-Z0-9]{2,8}\b", re.I)


@dataclass
class ParseResult:
    kind: str
    records: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    rows_total: int = 0
    sheet: str = ""


class UploadError(ValueError):
    """Raised for files that can't be read at all."""


def extension(filename: str) -> str:
    m = re.search(r"(\.[A-Za-z0-9]+)$", filename or "")
    return m.group(1).lower() if m else ""


def read_tables(content: bytes, filename: str) -> list[tuple[str, pd.DataFrame]]:
    ext = extension(filename)
    if ext == ".csv":
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, encoding=enc)
                return [("csv", df)]
            except UnicodeDecodeError:
                continue
            except pd.errors.EmptyDataError as exc:
                raise UploadError("The file is empty") from exc
            except pd.errors.ParserError as exc:
                raise UploadError(f"Could not read the CSV: {exc}") from exc
        raise UploadError("Could not decode the CSV file. Save it as UTF-8 and try again.")
    if ext in {".xlsx", ".xls"}:
        try:
            sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str, keep_default_na=False)
        except Exception as exc:  # openpyxl raises many types
            raise UploadError(f"Could not read the Excel file: {exc}") from exc
        out = [(name, df) for name, df in sheets.items() if not df.empty]
        if not out:
            raise UploadError("The workbook has no data")
        return out
    raise UploadError(f"{ext or 'This file type'} is not a table")


def map_columns(columns: list[Any], synonyms: dict[str, list[str]]) -> dict[str, str]:
    """canonical field -> original column name. Each column is used once, most specific names first."""
    normalized = {norm_header(c): c for c in columns}
    mapping: dict[str, str] = {}
    used: set[str] = set()
    # fields with longer synonym lists are less specific; resolve specific ones (e.g. return_id via "rma") first
    for canonical, names in synonyms.items():
        for n in names:
            if n in normalized and normalized[n] not in used and n != "id":
                mapping[canonical] = normalized[n]
                used.add(normalized[n])
                break
    for canonical, names in synonyms.items():  # a bare "id" column fills the primary key last
        if canonical not in mapping and "id" in names and "id" in normalized and normalized["id"] not in used:
            mapping[canonical] = normalized["id"]
            used.add(normalized["id"])
    return mapping


def detect_kind(columns: list[Any], sheet_name: str = "") -> str | None:
    """Score every kind by required + optional columns; the sheet name breaks ties."""
    best, best_score = None, 0.0
    hint = norm_header(sheet_name)
    for kind, (required, optional) in SIGNATURE.items():
        m = map_columns(columns, COLUMNS[kind])
        if not required <= set(m):
            continue
        score = len(required) * 2 + sum(1 for o in optional if o in m)
        if kind in hint or kind.rstrip("s") in hint:
            score += 3
        if score > best_score:
            best, best_score = kind, score
    return best


# ---------------------------------------------------------------- value parsers

def parse_int(v: Any) -> int | None:
    if is_blank(v):
        return None
    try:
        return int(round(float(str(v).replace(",", "").strip())))
    except ValueError:
        return None


def parse_rate(v: Any) -> float | None:
    """'7.8%', '0.078', '7.8' -> 0.078."""
    if is_blank(v):
        return None
    s = str(v).strip().replace("%", "")
    try:
        f = float(s)
    except ValueError:
        return None
    pct = "%" in str(v) or f > 1
    f = f / 100 if pct else f
    return f if 0 <= f <= 1 else None


def parse_bool(v: Any) -> bool | None:
    if is_blank(v):
        return None
    s = str(v).strip().lower()
    if s in {"yes", "y", "true", "1", "damaged", "reported", "x"}:
        return True
    if s in {"no", "n", "false", "0", "none", "ok"}:
        return False
    return None


def norm_sku(v: Any) -> str | None:
    s = clean_str(v, 64)
    return s.upper().replace(" ", "") if s else None


def norm_id(v: Any) -> str | None:
    s = clean_str(v, 64)
    if s and re.fullmatch(r"\d+\.0", s):  # Excel turns 1001 into "1001.0"
        s = s[:-2]
    return s


def change_type(raw: str | None, description: str | None = None) -> str:
    text = f"{raw or ''} {description or ''}".lower()
    for key, words in CHANGE_TYPES.items():
        if raw and any(w in (raw or "").lower() for w in words):
            return key
    for key, words in CHANGE_TYPES.items():
        if any(w in text for w in words):
            return key
    return "other"


def resolution(v: Any) -> str | None:
    s = (clean_str(v, 40) or "").lower()
    if not s:
        return None
    if "replac" in s or "exchange" in s:
        return "replacement"
    if "credit" in s or "store" in s:
        return "store_credit"
    if "refund" in s or "money" in s:
        return "refund"
    return s[:30]


def inspection_result(v: Any, defect_rate: float | None) -> str | None:
    s = (clean_str(v, 40) or "").lower()
    if any(w in s for w in ("fail", "reject", "not ok", "nok")):
        return "fail"
    if "condition" in s or "deviation" in s or "hold" in s:
        return "conditional"
    if "pass" in s or "accept" in s or s == "ok":
        return "pass"
    if defect_rate is not None:
        return "fail" if defect_rate >= 0.04 else "pass"
    return s or None


# ---------------------------------------------------------------- row parsing

def _err(errors: list, row: int | None, field_: str | None, message: str, level: str = "error", sheet: str = ""):
    errors.append({"row": row, "field": field_, "message": message, "level": level, "sheet": sheet or None})


def parse_rows(df: pd.DataFrame, kind: str, sheet: str = "") -> ParseResult:
    """Validate and normalize one table. Bad rows are skipped and reported; good rows continue."""
    res = ParseResult(kind=kind, rows_total=len(df), sheet=sheet)
    m = map_columns(list(df.columns), COLUMNS[kind])
    required, _ = SIGNATURE[kind]
    missing = [f for f in required if f not in m]
    if missing:
        _err(res.errors, None, ",".join(missing), f"Missing column(s) for {kind}: {', '.join(missing)}", sheet=sheet)
        return res
    unmapped = [c for c in df.columns if c not in m.values() and not str(c).startswith("Unnamed")]
    if unmapped:
        _err(res.errors, None, None, f"Ignored column(s): {', '.join(map(str, unmapped[:8]))}", "warning", sheet)

    def get(row: pd.Series, f: str) -> Any:
        return row[m[f]] if f in m else None

    seen: set[str] = set()
    for i, row in df.iterrows():
        n = int(i) + 2  # header is row 1
        if all(is_blank(v) for v in row.values):
            continue
        rec, problem = _parse_one(kind, lambda f: get(row, f), n)
        if problem:
            _err(res.errors, n, problem[0], problem[1], sheet=sheet)
            continue
        key = rec["key"]
        if key in seen:
            _err(res.errors, n, None, "Duplicate row in this file, kept the first one", "warning", sheet)
            continue
        seen.add(key)
        res.records.append(rec)
    return res


def _parse_one(kind: str, g, n: int) -> tuple[dict[str, Any], tuple[str, str] | None]:
    if kind == "orders":
        oid, sku, d = norm_id(g("order_id")), norm_sku(g("sku")), parse_date(g("order_date"))
        if not oid:
            return {}, ("order_id", "Order ID is empty")
        if not sku:
            return {}, ("sku", "SKU is empty")
        if not d:
            return {}, ("order_date", f"Can't read the order date '{g('order_date')}'")
        qty = parse_int(g("qty"))
        if qty is not None and qty <= 0:
            return {}, ("qty", "Quantity must be at least 1")
        price = parse_money(g("unit_price"))
        if price is not None and price < 0:
            return {}, ("unit_price", "Price can't be negative")
        return {"key": f"{oid}|{sku}", "order_id": oid, "sku": sku, "order_date": d, "qty": qty or 1,
                "unit_price": price, "customer_id": clean_str(g("customer_id"), 64),
                "batch_id": norm_id(g("batch_id")), "shipment_id": norm_id(g("shipment_id")),
                "region": clean_str(g("region"), 64), "supplier_id": norm_id(g("supplier_id"))}, None
    if kind == "returns":
        oid, sku = norm_id(g("order_id")), norm_sku(g("sku"))
        reason, comment = clean_str(g("reason"), 200), clean_str(g("comment"), 2000)
        if not oid and not sku:
            return {}, ("order_id", "A return needs an order ID or a SKU")
        if not reason and not comment:
            return {}, ("reason", "No return reason or comment")
        d = parse_date(g("return_date"))
        if g("return_date") is not None and not is_blank(g("return_date")) and not d:
            return {}, ("return_date", f"Can't read the return date '{g('return_date')}'")
        qty = parse_int(g("qty"))
        if qty is not None and qty <= 0:
            return {}, ("qty", "Returned quantity must be at least 1")
        refund = parse_money(g("refund_amount"))
        if refund is not None and refund < 0:
            return {}, ("refund_amount", "Refund can't be negative")
        rid = norm_id(g("return_id")) or "R-" + fingerprint(oid, sku, d, reason, comment)[:10].upper()
        return {"key": rid, "return_id": rid, "order_id": oid, "sku": sku, "return_date": d, "qty": qty or 1,
                "reason": reason, "comment": comment, "refund_amount": refund,
                "return_shipping_cost": parse_money(g("return_shipping_cost")),
                "replacement_cost": parse_money(g("replacement_cost")), "handling_cost": parse_money(g("handling_cost")),
                "resolution": resolution(g("resolution")), "condition": (clean_str(g("condition"), 40) or "").lower() or None}, None
    if kind == "products":
        sku = norm_sku(g("sku"))
        if not sku:
            return {}, ("sku", "SKU is empty")
        cost, price = parse_money(g("unit_cost")), parse_money(g("price"))
        if (cost is not None and cost < 0) or (price is not None and price < 0):
            return {}, ("unit_cost", "Cost and price can't be negative")
        return {"key": sku, "sku": sku, "name": clean_str(g("name"), 200) or sku, "category": clean_str(g("category"), 80),
                "supplier_id": norm_id(g("supplier_id")), "supplier_name": clean_str(g("supplier_name"), 120),
                "unit_cost": cost, "price": price, "description": clean_str(g("description"), 4000)}, None
    if kind == "reviews":
        text = clean_str(g("text"), 2000)
        rating = parse_money(g("rating"))
        if not text:
            return {}, ("text", "Review text is empty")
        if rating is not None and not 0 <= rating <= 5:
            return {}, ("rating", "Rating must be between 0 and 5")
        sku, oid, d = norm_sku(g("sku")), norm_id(g("order_id")), parse_date(g("date"))
        if not sku and not oid:
            return {}, ("sku", "A review needs a SKU or an order ID")
        rid = norm_id(g("review_id")) or "V-" + fingerprint(sku, oid, d, text)[:10].upper()
        return {"key": rid, "review_id": rid, "sku": sku, "order_id": oid, "date": d, "rating": rating, "text": text}, None
    if kind == "shipments":
        sid, oid = norm_id(g("shipment_id")), norm_id(g("order_id"))
        carrier = clean_str(g("carrier"), 80)
        if not sid and not oid:
            return {}, ("shipment_id", "A shipment needs a tracking ID or an order ID")
        if not carrier:
            return {}, ("carrier", "Carrier is empty")
        ship, deliv = parse_date(g("ship_date")), parse_date(g("delivery_date"))
        if ship and deliv and deliv < ship:
            return {}, ("delivery_date", "Delivered before it was shipped")
        sid = sid or f"SHP-{oid}"
        return {"key": sid, "shipment_id": sid, "order_id": oid, "carrier": carrier, "warehouse": clean_str(g("warehouse"), 60),
                "ship_date": ship, "delivery_date": deliv, "damaged": parse_bool(g("damaged"))}, None
    if kind == "batches":
        bid, sku = norm_id(g("batch_id")), norm_sku(g("sku"))
        if not bid:
            return {}, ("batch_id", "Batch ID is empty")
        if not sku:
            return {}, ("sku", "SKU is empty")
        return {"key": bid, "batch_id": bid, "sku": sku, "supplier_id": norm_id(g("supplier_id")),
                "supplier_name": clean_str(g("supplier_name"), 120), "produced_date": parse_date(g("produced_date")),
                "received_date": parse_date(g("received_date")), "units": parse_int(g("units"))}, None
    if kind == "inspections":
        rate = parse_rate(g("defect_rate"))
        res_ = inspection_result(g("result"), rate)
        bid, sku = norm_id(g("batch_id")), norm_sku(g("sku"))
        if not bid and not sku:
            return {}, ("batch_id", "An inspection needs a batch ID or a SKU")
        if not res_:
            return {}, ("result", "Result is empty")
        d = parse_date(g("date"))
        iid = norm_id(g("inspection_id")) or "INSP-" + fingerprint(bid, sku, d)[:8].upper()
        return {"key": iid, "inspection_id": iid, "batch_id": bid, "sku": sku, "supplier_id": norm_id(g("supplier_id")),
                "date": d, "result": res_, "defect_rate": rate, "findings": clean_str(g("findings"), 4000),
                "source": "table"}, None
    if kind == "changes":
        d = parse_date(g("date"))
        if not d:
            return {}, ("date", f"Can't read the date '{g('date')}'")
        desc = clean_str(g("description"), 1000)
        ctype = change_type(clean_str(g("change_type"), 80), desc)
        sku = norm_sku(g("sku"))
        cid = "CHG-" + fingerprint(d, sku, ctype, desc)[:8].upper()
        return {"key": cid, "change_id": cid, "date": d, "sku": sku, "supplier_id": norm_id(g("supplier_id")),
                "change_type": ctype, "label": clean_str(g("change_type"), 80), "description": desc}, None
    raise ValueError(kind)


# ---------------------------------------------------------------- documents

def extract_text(content: bytes, filename: str) -> str:
    ext = extension(filename)
    if ext in {".txt", ".md"}:
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                return content.decode(enc)
            except UnicodeDecodeError:
                continue
        raise UploadError("Could not decode the text file")
    if ext == ".docx":
        from docx import Document
        try:
            doc = Document(io.BytesIO(content))
        except Exception as exc:
            raise UploadError(f"Could not read the Word file: {exc}") from exc
        parts = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            for r in t.rows:
                parts.append(" | ".join(c.text for c in r.cells))
        return "\n".join(parts)
    if ext == ".pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(content))
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as exc:
            raise UploadError(f"Could not read the PDF: {exc}") from exc
        if not text.strip():
            raise UploadError("This PDF has no selectable text (it may be a scan)")
        return text
    raise UploadError(f"{ext or 'This file type'} is not supported")


def _field(text: str, *names: str) -> str | None:
    for n in names:
        m = re.search(rf"^\s*{n}\s*[:\-]\s*(.+)$", text, re.I | re.M)
        if m:
            return m.group(1).strip()
    return None


def parse_document(content: bytes, filename: str, known_skus: set[str], known_batches: set[str]) -> ParseResult:
    """A quality inspection report (mentions a batch) or a product note/description (mentions a SKU)."""
    text = extract_text(content, filename).strip()
    res = ParseResult(kind="inspections", rows_total=1, sheet=filename)
    if not text:
        _err(res.errors, None, None, "The document is empty")
        return res
    batches = [b.upper() for b in BATCH_RE.findall(text)]
    batch = next((b for b in batches if b in known_batches), batches[0] if batches else None)
    batch = batch or (_field(text, "batch", "batch id", "lot") or None)
    skus = [s for s in known_skus if re.search(rf"\b{re.escape(s)}\b", text, re.I)]
    sku = _field(text, "sku", "product") or (skus[0] if skus else None)
    sku = norm_sku(sku) if sku and norm_sku(sku) in known_skus else (skus[0] if skus else norm_sku(sku))
    looks_like_inspection = bool(re.search(r"inspection|quality|QA|QC|defect|AQL", text, re.I))
    if batch and looks_like_inspection:
        rate = parse_rate(_field(text, "defect rate", "defects"))
        res_ = inspection_result(_field(text, "result", "verdict", "status"), rate) or "conditional"
        findings = _field(text, "findings", "observations", "summary") or ""
        body = re.sub(r"\s+", " ", text)[:3000]
        iid = _field(text, "report id", "inspection id", "report no") or "INSP-" + fingerprint(filename, batch)[:8].upper()
        res.records.append({"key": iid, "inspection_id": iid, "batch_id": batch, "sku": sku,
                            "supplier_id": norm_id(_field(text, "supplier", "supplier id", "vendor")),
                            "date": parse_date(_field(text, "date", "inspection date", "inspected on")),
                            "result": res_, "defect_rate": rate, "findings": (findings + " " + body).strip()[:4000],
                            "source": filename})
        return res
    if sku:
        res.kind = "products"
        res.records.append({"key": sku, "sku": sku, "description": re.sub(r"\s+", " ", text)[:4000], "_partial": True})
        return res
    _err(res.errors, None, None, "Couldn't tell what this document is. Inspection reports need a batch ID "
                                  "(e.g. 'Batch: B-EB-0712'); product notes need a SKU that exists in your data.")
    return res
