"""Tests for arena evaluation, focused on deal-set determinism.

The frozen EVAL_SEED_BASE guarantees every checkpoint is scored on the same
deals, so a win-rate curve reflects skill rather than sliding deal luck.
"""

from __future__ import annotations

import torch

from evaluation import arena
from evaluation.arena import EVAL_SEED_BASE, MatchResult, evaluate_against_random
from training.network import create_network


def test_eval_against_random_is_deterministic_on_frozen_seed():
    """Two evals of the same net at the default (frozen) seed must be identical."""
    net = create_network(version=2, hidden_size=64, num_layers=2)
    wr1 = evaluate_against_random(net, num_games=20, device=torch.device("cpu"))
    wr2 = evaluate_against_random(net, num_games=20, device=torch.device("cpu"))
    assert wr1 == wr2


def test_eval_seed_base_default_matches_explicit():
    """The default seed IS EVAL_SEED_BASE (no hidden per-call drift)."""
    net = create_network(version=2, hidden_size=64, num_layers=2)
    wr_default = evaluate_against_random(net, num_games=20, device=torch.device("cpu"))
    wr_explicit = evaluate_against_random(
        net, num_games=20, device=torch.device("cpu"), seed=EVAL_SEED_BASE
    )
    assert wr_default == wr_explicit


def test_side_balanced_monitoring_uses_disjoint_seed_blocks(monkeypatch):
    candidate = object()
    opponent = object()
    calls = []
    results = [
        MatchResult(team0_wins=2, team1_wins=1),
        MatchResult(team0_wins=1, team1_wins=2),
    ]

    def fake_play_match(team0, team1, num_games, win_points, seed):
        calls.append((team0, team1, num_games, win_points, seed))
        return results[len(calls) - 1]

    monkeypatch.setattr(arena, "play_match", fake_play_match)

    wins, games = arena.evaluate_side_balanced(
        candidate,
        opponent,
        num_games=7,
        seed=50,
        win_points=11,
    )

    assert (wins, games) == (4, 6)
    assert calls == [
        (candidate, opponent, 3, 11, 50),
        (opponent, candidate, 3, 11, 53),
    ]
