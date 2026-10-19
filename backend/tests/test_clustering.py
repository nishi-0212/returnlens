import pytest

from app.services import clustering


@pytest.mark.parametrize("text,group", [
    ("Runs a full size small", "sizing"), ("Size 9 fits like an 8", "sizing"), ("had to size up, too tight", "sizing"),
    ("Left earbud stopped charging after a week", "defective"), ("won't turn on", "defective"),
    ("Box was crushed and two mugs were chipped", "packaging_damage"), ("no padding at all", "packaging_damage"),
    ("Arrived shattered, the courier box was smashed", "delivery_damage"), ("Glass broke in transit", "delivery_damage"),
    ("Looks nothing like the pictures", "not_as_described"), ("Says 100% linen but feels like polyester", "not_as_described"),
    ("Lid seal was missing from the box", "missing_parts"), ("Received the wrong colour", "wrong_item"),
    ("Changed my mind", "changed_mind"), ("Took 12 days to deliver", "late_delivery"),
])
def test_same_problem_different_words(text, group):
    assert clustering.classify("Other", text).category == group


def test_reason_code_used_when_no_comment():
    m = clustering.classify("Too small", "")
    assert m.category == "sizing" and m.method == "reason"


def test_comment_beats_misleading_reason_code():
    assert clustering.classify("Changed mind", "Arrived broken, the courier dropped it").category == "delivery_damage"


def test_unclear_text_is_other():
    assert clustering.classify(None, "ok").category == "other"


def test_positive_reviews_are_not_complaints():
    assert not clustering.is_complaint_review(5, "Love it, exactly as pictured")
    assert clustering.is_complaint_review(2, "Runs small")


def test_themes_and_representatives():
    texts = ["Runs a full size small", "runs small, size up", "Runs small in the toe", "Waist too loose", "waist is loose"]
    idx, names = clustering.themes(texts)
    assert len(idx) == len(texts) and names
    reps = clustering.representatives(texts, 2)
    assert len(reps) == 2 and len(set(reps)) == 2
    assert clustering.variants(["Too small", "too small.", "Too big"])[0] == {"text": "too small", "count": 2}
