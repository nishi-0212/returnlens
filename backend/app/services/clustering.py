"""Complaint clustering: put return reasons, return comments and reviews into recurring problem groups.

1. Normalize the text (case, apostrophes, spacing) and combine the reason code with the comment.
2. Score each complaint against a taxonomy of problem types with phrase patterns, so different
   wording lands in the same group ("runs small", "size 9 fits like an 8", "had to size up").
   The reason code counts as a weaker signal than what the customer actually wrote.
3. Optionally ask the LLM to place complaints the patterns could not (validated against the
   fixed list of groups; anything else is ignored).
4. Inside each group, TF-IDF + agglomerative clustering (scikit-learn) finds sub-themes, and the
   complaints closest to the group's centre are shown as representative examples.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

import numpy as np

CATEGORIES: dict[str, dict[str, str]] = {
    "sizing": {"label": "Sizing / fit", "cause": "sizing",
               "about": "The product doesn't fit as expected (runs small/large, size chart doesn't match)."},
    "defective": {"label": "Defective / stopped working", "cause": "manufacturing",
                  "about": "The product is faulty or stopped working."},
    "packaging_damage": {"label": "Damaged packaging", "cause": "packaging",
                         "about": "Weak or inadequate packaging let the product get damaged."},
    "delivery_damage": {"label": "Damaged in delivery", "cause": "shipping",
                        "about": "The product arrived broken because of handling in transit."},
    "not_as_described": {"label": "Not as described", "cause": "product_description",
                         "about": "The product differs from the photos, description or specifications."},
    "missing_parts": {"label": "Missing components", "cause": "manufacturing",
                      "about": "Parts or accessories were missing from the box."},
    "quality": {"label": "Poor quality / material", "cause": "manufacturing",
                "about": "The material or build quality is worse than expected."},
    "wrong_item": {"label": "Wrong item sent", "cause": "fulfillment",
                   "about": "A different product, colour or size was shipped."},
    "late_delivery": {"label": "Late delivery", "cause": "shipping", "about": "The order arrived too late."},
    "changed_mind": {"label": "Changed mind / not needed", "cause": "none",
                     "about": "Not a product problem: the customer no longer wanted it."},
    "other": {"label": "Other / unclear", "cause": "none", "about": "Couldn't be placed in a known group."},
}
ACTIONABLE = [k for k, v in CATEGORIES.items() if v["cause"] != "none"]

P = lambda *ps: [re.compile(p, re.I) for p in ps]  # noqa: E731
PATTERNS: dict[str, list[tuple[re.Pattern, float]]] = {
    "sizing": [(p, 3) for p in P(
        r"\b(too|runs?|way|bit|slightly|really|very)\s+(small|big|large|tight|loose|short|long|narrow|wide|snug)\b",
        r"\bsize (up|down)\b", r"\bsizing\b", r"\bsize chart\b", r"\bsize guide\b", r"\b(does ?n.?t|does not|did ?n.?t) fit\b",
        r"\b(smaller|bigger|larger|tighter|looser) than (my|the|usual|expected)\b", r"\bsize \d+(\.\d)? fits like\b",
        r"\bfits? (small|large|big|tight|loose)\b", r"\bfit is off\b", r"\bone size (up|down|smaller|bigger)\b",
        r"\bruns? (a )?(full |half )?size (small|big|large)\b", r"\b(full|half) size (small|big|large|up|down)\b",
        r"\bcompared to the (size )?chart\b", r"\b(narrow|short|tight|small|long|big)\b.{0,25}\b(size )?chart\b")]
    + [(p, 1.2) for p in P(r"\btoe ?box\b", r"\btoes? (hit|touch)\b", r"\b(waist|inseam|thighs?|shoulders?|sleeves?)\b",
                           r"\bfit\b")],
    "defective": [(p, 3) for p in P(
        r"\bstopped (working|charging|turning on)\b", r"\b(wo ?n.?t|does ?n.?t|does not|will not|can.?t) (turn on|charge|work|power|connect|pair)\b",
        r"\bdefect(ive)?\b", r"\bfaulty\b", r"\b(is|was|went|are) dead\b", r"\bbroke (after|within)\b", r"\bmalfunction",
        r"\bno power\b", r"\bkeeps? (dropping|disconnecting|cutting) out\b", r"\bdead after\b", r"\bnever charges?\b")]
    + [(p, 1) for p in P(r"\bcharg(ing|e)\b", r"\bbattery\b", r"\bleak(s|ing)?\b", r"\bnot working\b")],
    "packaging_damage": [(p, 3.2) for p in P(
        r"\b(box|packaging|package|packing|carton|mailer)\b.{0,25}\b(crushed|thin|flimsy|damaged|torn|caved|dented|weak|ripped)\b",
        r"\b(flimsy|thin|weak|cheap) (box|packaging|carton|mailer)\b", r"\bno (padding|dividers?|bubble ?wrap|protection|cushioning)\b",
        r"\bpoorly packed\b", r"\bpackaging (too|was|is) (thin|weak|bad|poor)\b", r"\bloose in (the|a) (thin )?box\b",
        r"\brattling\b", r"\bbadly packed\b", r"\bnot packed (well|properly)\b", r"\bpackaging too thin\b")],
    "delivery_damage": [(p, 3) for p in P(
        r"\b(arrived|came|delivered|reached)\s+(broken|damaged|shattered|cracked|smashed|in pieces)\b", r"\bon arrival\b",
        r"\bin transit\b", r"\bin shipping\b", r"\bshattered\b", r"\bmishandled\b", r"\bdamaged in (shipping|transit|delivery)\b",
        r"\b(courier|delivery (guy|person|agent|boy)|shipper|carrier)\b.{0,30}\b(dropped|smashed|damaged|mishandled|broke|threw)\b",
        r"\bfrom the courier\b", r"\bcame in pieces\b", r"\bbroke in transit\b")],
    "not_as_described": [(p, 3) for p in P(
        r"\bnot as (described|pictured|shown|advertised)\b", r"\bnothing like the (photos?|pictures?|images?)\b",
        r"\b(different|differs) (from|than) (the )?(photos?|pictures?|images?|description|listing|website)\b",
        r"\bmisleading\b", r"\b(colou?r) (is|was|looks) (completely )?(different|off|not)\b",
        r"\b(photos?|pictures?|images?) (made it|show|look|showed)\b", r"\bnot (100%|real|genuine|actual|actually)\b",
        r"\b(says|claims|listed as|described as|advertised as)\b", r"\b(feels like|is) (a )?(polyester|plastic|synthetic)\b",
        r"\bnot what (the|was) (described|shown|pictured)\b", r"\bnot like the (photos?|pictures?)\b",
        r"\bnot \w+ like (in )?the (photos?|pictures?|images?)\b")],
    "missing_parts": [(p, 3) for p in P(
        r"\bmissing\b", r"\b(was ?n.?t|were ?n.?t|not) (in the box|included)\b", r"\bno \w+ (was )?(included|in the box)\b",
        r"\bincomplete\b", r"\bdid ?n.?t (come|include) with\b", r"\bwithout (the|a|its) \w+\b")],
    "wrong_item": [(p, 3.5) for p in P(
        r"\bwrong (item|product|colou?r|size|model|one)\b", r"\b(received|got|sent) (a |the )?(different|wrong)\b",
        r"\bnot what i ordered\b", r"\bdifferent (size|colou?r|item) than i ordered\b")],
    "quality": [(p, 2.5) for p in P(
        r"\b(cheap|flimsy|poor|bad|low|terrible) (quality|material|feel|build|stitching)\b", r"\bcheap(ly made| feel)\b",
        r"\b(material|fabric) (feels|is) (thin|cheap|flimsy)\b", r"\b(stitching|seams?) (coming|came|is coming) (loose|apart|undone)\b",
        r"\bfaded\b", r"\bpilling\b", r"\bfell apart\b", r"\bpoorly made\b")],
    "late_delivery": [(p, 3) for p in P(
        r"\b(arrived|came|delivered) (too |very )?late\b", r"\blate delivery\b", r"\bdelivery was (very |too )?(late|slow)\b",
        r"\btook \d+ days\b", r"\btoo late\b", r"\bdelayed\b", r"\bnever arrived on time\b")],
    "changed_mind": [(p, 3) for p in P(
        r"\bchanged? (my )?mind\b", r"\bno longer (need|want)", r"\bordered by mistake\b", r"\bfound (it )?cheaper\b",
        r"\bdo ?n.?t (need|want) (it|this|them)\b", r"\bgift\b", r"\bnot needed\b", r"\baccidental(ly)? order")],
}
REASON_CODES = {
    "sizing": ["too small", "too big", "too large", "doesn't fit", "does not fit", "size", "fit"],
    "defective": ["defective", "faulty", "not working", "broken item", "malfunction"],
    "delivery_damage": ["damaged on arrival", "arrived damaged", "damaged in transit", "shipping damage", "doa"],
    "packaging_damage": ["damaged packaging", "packaging"],
    "not_as_described": ["not as described", "not as pictured", "inaccurate", "description"],
    "missing_parts": ["missing", "incomplete"],
    "wrong_item": ["wrong item", "wrong product", "incorrect item"],
    "quality": ["quality", "poor quality"],
    "late_delivery": ["late", "arrived late", "delayed"],
    "changed_mind": ["changed mind", "no longer needed", "unwanted", "mistake", "better price"],
}
GENERIC_DAMAGE = re.compile(r"^\s*damaged?\s*$", re.I)
POSITIVE = re.compile(r"\b(love|great|perfect|excellent|works well|happy|exactly as|good quality|recommend)\b", re.I)


def normalize(text: str | None) -> str:
    if text is None or (isinstance(text, float) and text != text):
        return ""
    t = str(text).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = re.sub(r"\s+", " ", t).strip()
    return t


@dataclass
class Match:
    category: str
    confidence: float
    method: str  # text | reason | llm | none
    scores: dict[str, float]


def classify(reason: str | None, comment: str | None) -> Match:
    """Rule-based classification of one complaint."""
    text = normalize(comment)
    scores: Counter[str] = Counter()
    low = text.lower()
    for cat, pats in PATTERNS.items():
        for pat, w in pats:
            if pat.search(low):
                scores[cat] += w
    # disambiguation between look-alike groups
    if scores["missing_parts"] and re.search(r"\bmissing (the )?point\b", low):
        scores["missing_parts"] = 0
    if scores["packaging_damage"] and scores["delivery_damage"]:
        if re.search(r"\b(courier|transit|dropped|mishandled|smashed)\b", low) and not re.search(
                r"\b(thin|flimsy|no padding|no dividers|poorly packed)\b", low):
            scores["packaging_damage"] *= 0.5
        else:
            scores["delivery_damage"] *= 0.6
    if scores["defective"] and scores["delivery_damage"] and re.search(r"\b(arrived|on arrival|transit)\b", low):
        scores["defective"] *= 0.5
    if scores["not_as_described"] and scores["missing_parts"] >= 3 and re.search(r"\b(included|missing|in the box)\b", low):
        scores["not_as_described"] *= 0.5
    if scores["not_as_described"] and scores["sizing"] >= 3:
        scores["not_as_described"] *= 0.6
    if scores["wrong_item"] and re.search(r"\bwrong size\b", low) and not re.search(r"\b(sent|received|got)\b", low):
        scores["wrong_item"] = 0
    text_best = max(scores.items(), key=lambda kv: kv[1]) if scores else None

    rcode = normalize(reason).lower()
    reason_cat = None
    if rcode and not GENERIC_DAMAGE.match(rcode):
        for cat, words in REASON_CODES.items():
            if any(w in rcode for w in words):
                reason_cat = cat
                break
    if text_best and text_best[1] >= 2.5:
        cat, s = text_best
        if reason_cat == cat:
            s += 1.5
        conf = min(0.97, 0.55 + 0.08 * s)
        return Match(cat, round(conf, 2), "text", dict(scores))
    if reason_cat:
        if text_best and text_best[1] >= 1 and text_best[0] != reason_cat and reason_cat in ("changed_mind",):
            return Match(text_best[0], 0.55, "text", dict(scores))
        return Match(reason_cat, 0.6 if not text else 0.65, "reason", dict(scores))
    if GENERIC_DAMAGE.match(rcode):
        # "Damaged" with no comment: packaging vs transit is unknown; transit is the more common case
        return Match("packaging_damage" if scores["packaging_damage"] else "delivery_damage", 0.45, "reason", dict(scores))
    if text_best and text_best[1] >= 1:
        return Match(text_best[0], 0.45, "text", dict(scores))
    return Match("other", 0.0, "none", dict(scores))


def is_complaint_review(rating: float | None, text: str | None) -> bool:
    """Reviews only count as complaints when they are negative or mention a problem."""
    t = normalize(text)
    try:
        rating = float(rating) if rating is not None else None
    except (TypeError, ValueError):
        rating = None
    if rating is not None and rating != rating:
        rating = None
    if rating is not None and rating >= 4:
        return False
    if rating is None and POSITIVE.search(t) and not re.search(r"\bbut\b", t, re.I):
        return False
    return True


# ---------------------------------------------------------------- sub-themes and examples

def _vectorize(texts: list[str]):
    from sklearn.feature_extraction.text import TfidfVectorizer
    vec = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", min_df=1, sublinear_tf=True,
                          token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9]+\b")
    x = vec.fit_transform(texts)
    return vec, x


def themes(texts: list[str], max_themes: int = 4) -> tuple[list[int], list[str]]:
    """Sub-cluster texts. Returns (theme index per text, theme labels)."""
    clean = [t for t in texts]
    if len(clean) < 4:
        return [0] * len(clean), [_label_from_counts(clean)]
    try:
        from sklearn.cluster import AgglomerativeClustering
        vec, x = _vectorize(clean)
        if x.shape[1] < 2:
            return [0] * len(clean), [_label_from_counts(clean)]
        dense = x.toarray()
        model = AgglomerativeClustering(n_clusters=None, distance_threshold=0.92, metric="cosine", linkage="average")
        labels = model.fit_predict(dense)
    except Exception:  # very short or identical texts
        return [0] * len(clean), [_label_from_counts(clean)]
    counts = Counter(labels)
    top = [lab for lab, n in counts.most_common() if n >= 2][:max_themes]
    terms = np.array(vec.get_feature_names_out())
    names, mapping = [], {}
    for i, lab in enumerate(top):
        rows = dense[labels == lab]
        weights = rows.mean(axis=0)
        best = [terms[j] for j in weights.argsort()[::-1][:6]]
        picked: list[str] = []
        for t in best:  # prefer bigrams, avoid repeats
            if any(t in p or p in t for p in picked):
                continue
            picked.append(t)
            if len(picked) == 2:
                break
        names.append(" / ".join(picked) if picked else f"theme {i + 1}")
        mapping[lab] = i
    out = [mapping.get(lab, len(names)) for lab in labels]
    if any(o == len(names) for o in out):
        names.append("other wording")
    return out, names


def _label_from_counts(texts: list[str]) -> str:
    words = Counter(w for t in texts for w in re.findall(r"[a-z]{4,}", t.lower()))
    return " / ".join(w for w, _ in words.most_common(2)) or "general"


def representatives(texts: list[str], k: int = 3) -> list[int]:
    """Indices of the k complaints closest to the group's centre (distinct wording)."""
    if not texts:
        return []
    if len(texts) <= k:
        return list(range(len(texts)))
    try:
        _, x = _vectorize(texts)
        centre = np.asarray(x.mean(axis=0)).ravel()
        sims = x @ centre
        order = np.argsort(-np.asarray(sims).ravel())
    except Exception:
        order = range(len(texts))
    seen, picked = set(), []
    for i in order:
        key = re.sub(r"[^a-z]", "", texts[i].lower())[:40]
        if key in seen:
            continue
        seen.add(key)
        picked.append(int(i))
        if len(picked) == k:
            break
    return picked


def variants(texts: list[str], k: int = 6) -> list[dict[str, Any]]:
    """The different ways customers phrased the same problem, with counts."""
    c = Counter(re.sub(r"[.!]+$", "", normalize(t)).lower() for t in texts if t and len(t) < 160)
    return [{"text": t, "count": n} for t, n in c.most_common(k)]


# ---------------------------------------------------------------- LLM assist

LLM_SYSTEM = (
    "You classify e-commerce return comments and reviews into fixed problem groups. Use only the group keys given. "
    "If a text doesn't clearly fit, use 'other'. Respond with JSON: {\"items\": [{\"id\": str, \"group\": str}]}."
)


def llm_messages(items: list[dict[str, str]]) -> list[dict[str, str]]:
    import json
    groups = {k: v["about"] for k, v in CATEGORIES.items()}
    return [{"role": "system", "content": LLM_SYSTEM},
            {"role": "user", "content": json.dumps({"groups": groups, "texts": items})}]
