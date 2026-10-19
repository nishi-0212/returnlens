"""Small, dependency-free statistics used across the analysis.

Return rates are proportions (returned units / ordered units), so comparisons use a
two-proportion z-test. With small counts the test is unreliable, so callers also require
minimum sample sizes before calling anything "unusual" or "improved".
"""
from __future__ import annotations

import math


def rate(k: float, n: float) -> float:
    return float(k) / float(n) if n else 0.0


def z_test(k1: float, n1: float, k2: float, n2: float) -> tuple[float, float]:
    """Is rate1 = k1/n1 higher than rate2 = k2/n2? Returns (z, one-sided p)."""
    if n1 <= 0 or n2 <= 0:
        return 0.0, 1.0
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(max(p * (1 - p) * (1 / n1 + 1 / n2), 1e-12))
    z = (p1 - p2) / se
    return z, 0.5 * math.erfc(z / math.sqrt(2))


def two_sided_p(k1: float, n1: float, k2: float, n2: float) -> float:
    z, _ = z_test(k1, n1, k2, n2)
    return math.erfc(abs(z) / math.sqrt(2))


def lift(k1: float, n1: float, k2: float, n2: float) -> float:
    r1, r2 = rate(k1, n1), rate(k2, n2)
    if r2 == 0:
        return float("inf") if r1 > 0 else 1.0
    return r1 / r2


def wilson(k: float, n: float, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return 0.0, 0.0
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, centre - half), min(1.0, centre + half)


def finite(x: float, cap: float = 99.0) -> float:
    if x is None or math.isnan(x):
        return 0.0
    return cap if math.isinf(x) else round(x, 2)
