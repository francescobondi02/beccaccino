"""Evaluate a PIMC-augmented network against a baseline opponent.

Wraps a V4 network in an agent that uses pimc_choose_action() instead of
greedy argmax, then plays it against HeuristicAgent. Mirrors the
evaluate_against_heuristic() flow (half games on each team) so results
are directly comparable to the bare-network number.
"""

from __future__ import annotations

import torch

from evaluation.arena import evaluate_side_balanced
from evaluation.heuristic import HeuristicAgent
from inference.pimc import PIMCAgent, PIMCConfig


def evaluate_pimc_against_heuristic(
    net: torch.nn.Module,
    num_games: int = 100,
    win_points: int = 41,
    num_determinizations: int = 20,
    seed: int = 0,
    device: torch.device | None = None,
) -> float:
    """Win rate of PIMC-on-net vs HeuristicAgent. Plays half on each team."""
    pimc = PIMCAgent(
        net,
        PIMCConfig(num_determinizations=num_determinizations, seed=seed),
        device=device,
    )
    pimc_wins, games = evaluate_side_balanced(
        pimc,
        HeuristicAgent(seed=seed + 10000),
        num_games=num_games,
        seed=seed,
        win_points=win_points,
    )
    return pimc_wins / games
