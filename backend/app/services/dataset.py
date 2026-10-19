"""Load a workspace's records into pandas and link them together.

Every return is joined to its order line (date, quantity, price, batch), its product (category,
supplier, cost), its batch (supplier) and its shipment (carrier, warehouse, damage scan).
When an order line has no batch ID, the batch is inferred from the latest batch of that SKU
received before the order date, and marked as inferred.
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd


PROJ = {"_id": 0, "user_id": 0, "upload_id": 0, "created_at": 0, "updated_at": 0}


@dataclass
class Data:
    orders: pd.DataFrame
    returns: pd.DataFrame
    reviews: pd.DataFrame
    products: pd.DataFrame
    batches: pd.DataFrame
    inspections: pd.DataFrame
    changes: pd.DataFrame
    shipments: pd.DataFrame
    links: dict[str, Any] = field(default_factory=dict)

    @property
    def empty(self) -> bool:
        return self.orders.empty and self.returns.empty

    @property
    def start(self) -> pd.Timestamp | None:
        return self.orders["order_date"].min() if not self.orders.empty else None

    @property
    def end(self) -> pd.Timestamp | None:
        if not self.orders.empty:
            return self.orders["order_date"].max()
        return self.returns["return_date"].max() if not self.returns.empty else None


def _frame(docs: list[dict[str, Any]], cols: list[str], dates: list[str] = ()) -> pd.DataFrame:
    df = pd.DataFrame(docs) if docs else pd.DataFrame(columns=cols)
    for c in cols:
        if c not in df.columns:
            df[c] = None
    for c in dates:
        df[c] = pd.to_datetime(df[c], utc=True, errors="coerce")
    return df


async def load(db: Any, scope: str) -> Data:
    names = ("orders", "returns", "reviews", "products", "batches", "inspections", "changes", "shipments")
    fetched = dict(zip(names, await asyncio.gather(*(db[c].find({"user_id": scope}, PROJ).to_list(length=None) for c in names))))

    async def get(coll: str) -> list[dict[str, Any]]:
        return fetched[coll]

    orders = _frame(await get("orders"), ["order_id", "sku", "order_date", "qty", "unit_price", "customer_id", "batch_id",
                                          "shipment_id", "region", "supplier_id"], ["order_date"])
    returns = _frame(await get("returns"), ["return_id", "order_id", "sku", "return_date", "qty", "reason", "comment",
                                            "refund_amount", "return_shipping_cost", "replacement_cost", "handling_cost",
                                            "resolution", "condition", "cluster", "theme", "cluster_conf"],
                     ["return_date"])
    reviews = _frame(await get("reviews"), ["review_id", "sku", "order_id", "date", "rating", "text", "cluster", "theme",
                                            "cluster_conf"], ["date"])
    products = _frame(await get("products"), ["sku", "name", "category", "supplier_id", "supplier_name", "unit_cost",
                                              "price", "description"])
    batches = _frame(await get("batches"), ["batch_id", "sku", "supplier_id", "supplier_name", "produced_date",
                                            "received_date", "units"], ["produced_date", "received_date"])
    inspections = _frame(await get("inspections"), ["inspection_id", "batch_id", "sku", "supplier_id", "date", "result",
                                                    "defect_rate", "findings", "source"], ["date"])
    changes = _frame(await get("changes"), ["change_id", "date", "sku", "supplier_id", "change_type", "label",
                                            "description"], ["date"])
    shipments = _frame(await get("shipments"), ["shipment_id", "order_id", "carrier", "warehouse", "ship_date",
                                                "delivery_date", "damaged"], ["ship_date", "delivery_date"])
    return link(Data(orders, returns, reviews, products, batches, inspections, changes, shipments))


def link(d: Data) -> Data:
    """Attach product, batch, supplier and shipment details to orders, returns and reviews."""
    o = d.orders.copy()
    o["qty"] = pd.to_numeric(o["qty"], errors="coerce").fillna(1).astype(int)
    o["unit_price"] = pd.to_numeric(o["unit_price"], errors="coerce")
    prod = d.products.drop_duplicates("sku").set_index("sku")
    for col, src in (("category", "category"), ("product_name", "name"), ("unit_cost", "unit_cost"),
                     ("list_price", "price"), ("product_supplier", "supplier_id")):
        o[col] = o["sku"].map(prod[src]) if not prod.empty else None
    o["unit_price"] = o["unit_price"].fillna(pd.to_numeric(o["list_price"], errors="coerce"))
    o["category"] = o["category"].fillna("Uncategorized")
    o["product_name"] = o["product_name"].fillna(o["sku"])

    # batch inference from the batch table
    o["batch_inferred"] = False
    b = d.batches.dropna(subset=["sku"]).copy()
    if not b.empty:
        b["start"] = b["received_date"].fillna(b["produced_date"])
        missing = o["batch_id"].isna() | (o["batch_id"] == "")
        if missing.any():
            b_sorted = b.dropna(subset=["start"]).sort_values("start")
            guesses = []
            for idx, row in o[missing].iterrows():
                cand = b_sorted[(b_sorted["sku"] == row["sku"]) & (b_sorted["start"] <= row["order_date"])]
                guesses.append((idx, cand.iloc[-1]["batch_id"] if not cand.empty else None))
            for idx, bid in guesses:
                if bid:
                    o.at[idx, "batch_id"] = bid
                    o.at[idx, "batch_inferred"] = True
        bsup = b.drop_duplicates("batch_id").set_index("batch_id")["supplier_id"]
        o["batch_supplier"] = o["batch_id"].map(bsup)
    else:
        o["batch_supplier"] = None
    o["supplier_id"] = o["batch_supplier"].fillna(o["supplier_id"]).fillna(o["product_supplier"]).fillna("Unknown")
    o["batch_id"] = o["batch_id"].replace("", None)

    # shipment details
    s = d.shipments
    o["carrier"] = None
    o["warehouse"] = None
    o["damaged"] = None
    o["delivery_date"] = pd.NaT
    if not s.empty:
        by_id = s.drop_duplicates("shipment_id").set_index("shipment_id")
        by_order = s.dropna(subset=["order_id"]).drop_duplicates("order_id").set_index("order_id")
        for col in ("carrier", "warehouse", "damaged", "delivery_date"):
            v = o["shipment_id"].map(by_id[col]) if "shipment_id" in o else None
            v2 = o["order_id"].map(by_order[col]) if not by_order.empty else None
            o[col] = v.where(v.notna(), v2) if v is not None else v2
    o["carrier"] = o["carrier"].fillna("Unknown")
    o["revenue"] = o["qty"] * o["unit_price"].fillna(0)
    d.orders = o

    # returns -> order line
    r = d.returns.copy()
    r["qty"] = pd.to_numeric(r["qty"], errors="coerce").fillna(1).astype(int)
    for c in ("refund_amount", "return_shipping_cost", "replacement_cost", "handling_cost"):
        r[c] = pd.to_numeric(r[c], errors="coerce")
    single = o.groupby("order_id")["sku"].agg(lambda x: x.iloc[0] if len(x) == 1 else None)
    r["sku"] = r["sku"].fillna(r["order_id"].map(single))
    line = o.drop_duplicates(["order_id", "sku"]).set_index(["order_id", "sku"])
    keys = list(zip(r["order_id"], r["sku"]))
    matched = [k in line.index for k in keys]
    r["matched"] = matched
    for col in ("order_date", "batch_id", "batch_inferred", "supplier_id", "carrier", "warehouse", "damaged",
                "unit_price", "category", "product_name", "unit_cost", "region", "delivery_date"):
        vals = [line.at[k, col] if ok else None for k, ok in zip(keys, matched)]
        r[col] = vals
    r["order_date"] = pd.to_datetime(r["order_date"], utc=True, errors="coerce")
    # returns without a matching order still get product details
    for col, src in (("category", "category"), ("product_name", "name"), ("unit_cost", "unit_cost"),
                     ("supplier_id", "supplier_id")):
        if not prod.empty:
            r[col] = r[col].where(r[col].notna(), r["sku"].map(prod[src]))
    r["category"] = r["category"].fillna("Uncategorized")
    r["supplier_id"] = r["supplier_id"].fillna("Unknown")
    r["carrier"] = r["carrier"].fillna("Unknown")
    r["product_name"] = r["product_name"].fillna(r["sku"])
    r["cohort_date"] = r["order_date"].fillna(r["return_date"])
    r["unit_price"] = pd.to_numeric(r["unit_price"], errors="coerce")
    if not prod.empty:
        r["unit_price"] = r["unit_price"].fillna(pd.to_numeric(r["sku"].map(prod["price"]), errors="coerce"))
    r["unit_cost"] = pd.to_numeric(r["unit_cost"], errors="coerce")
    r["cluster"] = r["cluster"].fillna("unclassified")
    d.returns = r

    v = d.reviews.copy()
    v["rating"] = pd.to_numeric(v["rating"], errors="coerce")
    if not o.empty:
        first = o.drop_duplicates("order_id").set_index("order_id")
        v["sku"] = v["sku"].fillna(v["order_id"].map(first["sku"]))
        for col in ("batch_id", "supplier_id", "carrier"):
            v[col] = v["order_id"].map(first[col])
    else:
        for col in ("batch_id", "supplier_id", "carrier"):
            v[col] = None
    v["cluster"] = v["cluster"].fillna("unclassified")
    d.reviews = v

    total = len(r)
    d.links = {
        "orders": len(o), "returns": total, "reviews": len(v),
        "returns_matched": int(sum(matched)), "returns_unmatched": total - int(sum(matched)),
        "orders_with_batch": int(o["batch_id"].notna().sum()), "batches_inferred": int(o["batch_inferred"].sum()),
        "orders_with_carrier": int((o["carrier"] != "Unknown").sum()),
        "products": len(d.products), "batches": len(d.batches), "inspections": len(d.inspections),
        "changes": len(d.changes), "shipments": len(d.shipments),
    }
    return d


def ts(v: Any) -> pd.Timestamp | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    t = pd.Timestamp(v)
    if pd.isna(t):
        return None
    return t.tz_localize("UTC") if t.tzinfo is None else t


def iso(v: Any) -> str | None:
    t = ts(v)
    return t.date().isoformat() if t is not None else None


def to_py(v: Any) -> Any:
    """numpy/pandas scalars -> plain Python (for JSON and Mongo)."""
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        t = ts(v)
        return t.to_pydatetime() if t is not None else None
    if hasattr(v, "item"):
        try:
            v = v.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


# ---------------------------------------------------------------- small per-process cache
_CACHE: dict[str, tuple[int, Data]] = {}
_MAX = 6


async def cached(db: Any, scope: str) -> Data:
    """Load once per data version; uploads and analysis runs bump the version."""
    from .workspaces import data_version
    v = await data_version(db, scope)
    hit = _CACHE.get(scope)
    if hit and hit[0] == v:
        return hit[1]
    d = await load(db, scope)
    if len(_CACHE) >= _MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[scope] = (v, d)
    return d


def forget(scope: str) -> None:
    _CACHE.pop(scope, None)


def plain(v: Any) -> Any:
    """Recursively turn numpy/pandas values into plain Python (Mongo and JSON can't take numpy ints,
    bools or NaN)."""
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [plain(x) for x in v]
    if isinstance(v, (str, bool)) or v is None:
        return v
    return to_py(v)
