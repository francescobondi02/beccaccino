"""Evaluate a PIMC-augmented network against a baseline opponent.

Wraps a V4 network in an agent that uses pimc_choose_action() instead of
greedy argmax, then plays it against HeuristicAgent. Mirrors the
evaluate_against_heuristic() flow (half games on each team) so results
are directly comparable to the bare-network number.
"""

from __future__ import annotations

import torch

from becca_env.game import BeccaGame
from becca_env.observation import decode_action
from evaluation.heuristic import HeuristicAgent, play_match_heuristic
from inference.pimc import PIMCConfig, pimc_choose_action


class PIMCAgent:
    """Drop-in agent that selects actions via PIMC search.

    The agent's `select_action(game, seat)` returns the same kind of
    action as `game.legal_actions()` would yield (Suit, Card, or
    (Card, Signal|None)), so it slots straight into play_match_heuristic.
    """

    def __init__(
        self,
        net: torch.nn.Module,
        num_determinizations: int = 20,
        seed: int = 0,
        device: torch.device | None = None,
    ):
        self.net = net
        self.cfg = PIMCConfig(num_determinizations=num_determinizations, seed=seed)
        self.device = device if device is not None else next(net.parameters()).device
        self._call_seed = seed
        net.eval()

    def select_action(self, game: BeccaGame, seat: int):
        # Vary seed per call for diversity across moves within the same game
        self.cfg.seed = self._call_seed
        self._call_seed += 1

        flat = pimc_choose_action(
            self.net, game, viewer_seat=seat, config=self.cfg, device=self.device
        )
        return decode_action(flat, game)


def evaluate_pimc_against_heuristic(
    net: torch.nn.Module,
    num_games: int = 100,
    win_points: int = 41,
    num_determinizations: int = 20,
    seed: int = 0,
    device: torch.device | None = None,
) -> float:
    """Win rate of PIMC-on-net vs HeuristicAgent. Plays half on each team."""
    pimc = PIMCAgent(net, num_determinizations=num_determinizations, seed=seed, device=device)
    heur = HeuristicAgent(seed=seed + 10000)
    half = num_games // 2

    t0a, t1a = play_match_heuristic(pimc, heur, num_games=half, seed=seed, win_points=win_points)
    t0b, t1b = play_match_heuristic(
        heur, pimc, num_games=half, seed=seed + half, win_points=win_points
    )

    # PIMC was team0 in match A, team1 in match B
    pimc_wins = t0a + t1b
    return pimc_wins / (2 * half)
