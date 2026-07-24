"""Tests for arena evaluation, focused on deal-set determinism.

The frozen EVAL_SEED_BASE guarantees every checkpoint is scored on the same
deals, so a win-rate curve reflects skill rather than sliding deal luck.
"""

from __future__ import annotations

import torch

from evaluation.arena import EVAL_SEED_BASE, evaluate_against_random
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
