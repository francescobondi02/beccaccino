"""Small statistics helpers for evaluation. Pure stdlib (no torch/numpy) so it
imports cheaply from tests and scripts."""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence

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


def paired_mean_interval(scores: Sequence[float], z: float = DEFAULT_Z) -> tuple[float, float]:
    """Normal interval over one score per mirrored deal."""
    if not scores:
        raise ValueError("at least one paired score is required")
    mean = sum(scores) / len(scores)
    if len(scores) < 2:
        return (0.0, 1.0)
    half_width = z * statistics.stdev(scores) / math.sqrt(len(scores))
    return max(0.0, mean - half_width), min(1.0, mean + half_width)


def paired_difference_interval(
    leader: Sequence[float],
    competitor: Sequence[float],
    z: float = DEFAULT_Z,
) -> tuple[float, float]:
    """Normal interval for paired per-deal score differences."""
    if len(leader) != len(competitor):
        raise ValueError("paired scores must cover the same held-out deals")
    differences = [a - b for a, b in zip(leader, competitor)]
    if not differences:
        raise ValueError("paired deal scores are required")
    mean = sum(differences) / len(differences)
    if len(differences) < 2:
        return (-1.0, 1.0)
    half_width = z * statistics.stdev(differences) / math.sqrt(len(differences))
    return mean - half_width, mean + half_width
