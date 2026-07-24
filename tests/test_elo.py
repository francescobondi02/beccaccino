"""Tests for the Elo update fix and the round-robin elo_ladder."""

from __future__ import annotations

import torch

from evaluation.elo import EloTracker
from training.network import create_network


def test_equal_ratings_5050_leaves_rating_unchanged():
    """At equal ratings a 50% result is exactly the expected score, so the
    rating must not move. Regression guard against the old `* total` factor,
    which amplified any rounding into a large swing."""
    tracker = EloTracker()
    tracker.update(wins=50, losses=50, step=0)
    assert tracker.current_rating == 1000.0


def test_single_update_bounded_by_k_factor():
    """A win can move the rating by at most k_factor per rating period (the
    `* total` bug let one eval move it by thousands)."""
    tracker = EloTracker(k_factor=32.0)
    tracker.update(wins=100, losses=0, step=0)
    assert 1000.0 < tracker.current_rating <= 1000.0 + 32.0


def test_elo_ladder_ranks_stronger_checkpoint_higher():
    """A checkpoint that beats another on the frozen block must rank higher."""
    from evaluation import arena

    strong = create_network(version=2, hidden_size=64, num_layers=2)
    weak = create_network(version=2, hidden_size=64, num_layers=2)

    # Deterministic outcome without real games: stub play_match so `strong`
    # always wins as team0 and `weak` always loses. play_match returns a
    # MatchResult; team0 is the first agent passed.
    def fake_play_match(team0_agent, team1_agent, num_games, win_points, seed):
        res = arena.MatchResult()
        strong_is_team0 = team0_agent.net is strong
        res.team0_wins = num_games if strong_is_team0 else 0
        res.team1_wins = 0 if strong_is_team0 else num_games
        return res

    orig = arena.play_match
    arena.play_match = fake_play_match
    try:
        ratings = arena.elo_ladder(
            {"strong": strong, "weak": weak}, num_games=10, device=torch.device("cpu")
        )
    finally:
        arena.play_match = orig

    assert ratings["strong"] > ratings["weak"]


def test_elo_ladder_is_deterministic():
    """Same block_seed and checkpoints -> identical ratings."""
    from evaluation.arena import elo_ladder

    a = create_network(version=2, hidden_size=32, num_layers=2)
    b = create_network(version=2, hidden_size=32, num_layers=2)
    nets = {"a": a, "b": b}
    r1 = elo_ladder(nets, num_games=6, win_points=5, device=torch.device("cpu"))
    r2 = elo_ladder(nets, num_games=6, win_points=5, device=torch.device("cpu"))
    assert r1 == r2
