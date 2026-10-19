"""LLM assistance, always validated and grounded.

* classify_unmatched: puts complaints the rules couldn't place into one of the fixed groups.
  Output must be valid JSON matching the schema, use only known IDs and known group keys.
* narrate_finding: rewrites a finding's summary and adds alternative explanations. Rejected
  (rules text kept) if it states a number that isn't in the facts it was given, or claims a
  stronger status than the evidence supports.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from .clustering import CATEGORIES, llm_messages
from .llm import LLMError, complete_json

log = logging.getLogger("returnlens.ai")

GroupKey = Literal[tuple(CATEGORIES.keys())]  # type: ignore[valid-type]


class ClassifiedItem(BaseModel):
    id: str = Field(max_length=64)
    group: GroupKey


class ClassifyOut(BaseModel):
    items: list[ClassifiedItem] = Field(default_factory=list, max_length=100)


class FindingText(BaseModel):
    summary: str = Field(min_length=20, max_length=700)
    alternative_explanations: list[str] = Field(default_factory=list, max_length=3)


async def classify_unmatched(items: list[dict[str, str]]) -> dict[str, str]:
    """{id: group} for items the model could place; others are left out."""
    out: dict[str, str] = {}
    ids = {i["id"] for i in items}
    for start in range(0, len(items), 40):
        batch = items[start:start + 40]
        try:
            res = await complete_json(llm_messages(batch), ClassifyOut, max_tokens=1500)
        except LLMError as exc:
            log.info("LLM classification skipped: %s", exc)
            break
        for it in res.items:
            if it.id in ids and it.group != "other":
                out[it.id] = it.group
    return out


NARRATE_SYSTEM = (
    "You are a returns analyst. Rewrite the finding summary in 2-3 plain sentences for an operations manager, "
    "using ONLY the facts given (copy numbers exactly; do not add new numbers). Match the certainty to the status: "
    "'confirmed' may say the cause is documented; 'likely' must say it is a strong pattern still to be verified; "
    "'possible' must say it is a weak signal. Then give up to 3 short alternative explanations a careful analyst "
    "would rule out, specific to these facts. Respond as JSON: {\"summary\": str, \"alternative_explanations\": [str]}."
)


def _numbers(text: str) -> set[str]:
    return {f"{float(n):g}" for n in re.findall(r"\d+(?:\.\d+)?", text)}


def grounded(text: FindingText, facts: dict[str, Any], status: str) -> bool:
    allowed = _numbers(json.dumps(facts, default=str))
    used = _numbers(text.summary + " " + " ".join(text.alternative_explanations))
    if not used <= allowed:
        log.info("AI narrative rejected: numbers not in facts %s", sorted(used - allowed)[:5])
        return False
    if status != "confirmed" and re.search(r"\b(confirmed|proven|definitely|certainly)\b", text.summary, re.I):
        log.info("AI narrative rejected: overstated certainty")
        return False
    return True


async def narrate_finding(f: dict[str, Any]) -> FindingText | None:
    facts = {k: f.get(k) for k in ("title", "summary", "status", "status_reason", "cause_label", "cluster_label",
                                   "products", "scope_desc", "change_date", "alternatives", "missing_data")}
    facts["tests"] = [{k: t[k] for k in ("dimension", "value_label", "complaints", "units", "rate", "rate_elsewhere", "lift")}
                      for t in f.get("tests", [])[:5]]
    facts["documents"] = [{"id": c.get("id"), "text": c.get("text")} for c in
                          (f["evidence"].get("inspections", []) + f["evidence"].get("shipments", []))[:3]]
    try:
        res = await complete_json([{"role": "system", "content": NARRATE_SYSTEM},
                                   {"role": "user", "content": json.dumps(facts, default=str)}], FindingText, max_tokens=900)
    except LLMError as exc:
        log.info("LLM narrative skipped: %s", exc)
        return None
    return res if grounded(res, facts, f["status"]) else None
