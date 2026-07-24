"""Small statistics helpers for evaluation. Pure stdlib (no torch/numpy) so it
imports cheaply from tests and scripts."""

from __future__ import annotations

import math

DEFAULT_Z = 1.96  # 95% two-sided normal quantile


def wilson_interval(wins: int, n: int, z: float = DEFAULT_Z) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion (default 95%).

    More accurate than the normal approximation for small n and proportions
    near 0/1, and never escapes [0, 1]. Returns (lo, hi)."""
    if n == 0:
        return (0.0, 0.0)
    p = wins / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (center - half, center + half)
