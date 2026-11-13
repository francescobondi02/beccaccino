"""Tests for Wilson confidence intervals and eval count reporting."""

from __future__ import annotations

import pytest
import torch

from evaluation.arena import evaluate_against_random
from evaluation.stats import wilson_interval
from training.network import create_network


def test_wilson_centered_near_half_at_5050():
    lo, hi = wilson_interval(50, 100)
    assert lo < 0.5 < hi
    assert (lo + hi) / 2 == pytest.approx(0.5, abs=0.02)


def test_wilson_zero_n_is_degenerate():
    assert wilson_interval(0, 0) == (0.0, 0.0)


def test_wilson_bounds_contain_point_estimate():
    for wins, n in [(1, 10), (7, 10), (30, 100), (99, 100)]:
        p = wins / n
        lo, hi = wilson_interval(wins, n)
        assert lo <= p <= hi
        assert 0.0 <= lo <= hi <= 1.0


def test_wilson_interval_narrows_as_n_grows():
    _, hi_small = wilson_interval(5, 10)
    lo_small, _ = wilson_interval(5, 10)
    width_small = hi_small - lo_small
    lo_big, hi_big = wilson_interval(500, 1000)
    assert (hi_big - lo_big) < width_small


def test_eval_odd_count_reports_games_actually_played():
    """num_games=7 plays 2*(7//2)=6 games; n must be 6, not 7."""
    net = create_network(version=2, hidden_size=64, num_layers=2)
    wins, n = evaluate_against_random(
        net, num_games=7, device=torch.device("cpu"), return_counts=True
    )
    assert n == 6
    assert 0 <= wins <= n
