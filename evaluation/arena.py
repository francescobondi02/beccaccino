"""Arena: pit agents against each other to measure relative strength.

Supports: trained model vs random baseline, model vs model, Elo tracking.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import torch

from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase
from becca_env.observation import decode_action, encode_action_mask, encode_observation
from training.network import BeccaNet

# Frozen base seed for evaluation. Every checkpoint is scored on the SAME deals
# so the win-rate curve reflects skill, not deal luck. The value is arbitrary
# but must never change, or historical eval numbers stop being comparable.
EVAL_SEED_BASE = 20260724


class RandomAgent:
    """Baseline: picks uniformly at random from legal actions."""

    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)

    def select_action(self, game: BeccaGame, seat: int) -> object:
        actions = game.legal_actions()
        return self.rng.choice(actions)


class NeuralAgent:
    """Trained neural network agent."""

    def __init__(
        self, net: BeccaNet, device: torch.device = torch.device("cpu"), temperature: float = 0.0
    ):
        self.net = net
        self.device = device
        self.temperature = temperature

    @torch.no_grad()
    def select_action(self, game: BeccaGame, seat: int) -> object:
        obs = encode_observation(game, seat)
        mask = encode_action_mask(game, seat)

        obs_t = torch.from_numpy(obs).unsqueeze(0).to(self.device)
        mask_t = torch.from_numpy(mask).unsqueeze(0).to(self.device)

        logits, _ = self.net(obs_t, mask_t)

        if self.temperature <= 0:
            action_idx = logits.argmax(dim=-1).item()
        else:
            scaled = logits / self.temperature
            dist = torch.distributions.Categorical(logits=scaled)
            action_idx = dist.sample().item()

        return decode_action(action_idx, game)


@dataclass
class MatchResult:
    team0_wins: int = 0
    team1_wins: int = 0
    draws: int = 0
    total_rounds: int = 0

    @property
    def total_games(self) -> int:
        return self.team0_wins + self.team1_wins + self.draws

    @property
    def team0_winrate(self) -> float:
        if self.total_games == 0:
            return 0.0
        return self.team0_wins / self.total_games


def play_match(
    team0_agent,
    team1_agent,
    num_games: int = 100,
    win_points: int = 41,
    seed: int = 0,
) -> MatchResult:
    """Play multiple games between two agents.

    team0_agent controls seats 0 and 2.
    team1_agent controls seats 1 and 3.
    """
    result = MatchResult()

    for i in range(num_games):
        game = BeccaGame(seed=seed + i, win_points=win_points)

        while game.phase != GamePhase.GAME_OVER:
            seat = game.current_seat
            team = TEAM_OF_SEAT[seat]
            agent = team0_agent if team == 0 else team1_agent
            action = agent.select_action(game, seat)
            game.step(action)

        winner = game.result.winner_team
        if winner == 0:
            result.team0_wins += 1
        else:
            result.team1_wins += 1

    return result


def evaluate_against_random(
    net: BeccaNet,
    num_games: int = 200,
    device: torch.device = torch.device("cpu"),
    seed: int = EVAL_SEED_BASE,
    return_counts: bool = False,
) -> float | tuple[int, int]:
    """Quick evaluation: trained agent vs random.

    Returns the win rate (0-1) by default, or (wins, n) when return_counts=True
    so the caller can compute a confidence interval. n is the number of games
    actually played (2 * (num_games // 2)), not num_games."""
    neural = NeuralAgent(net, device, temperature=0.0)
    rando = RandomAgent(seed=seed + 10000)

    # Play half as team 0, half as team 1
    half = num_games // 2

    r1 = play_match(neural, rando, num_games=half, seed=seed)
    r2 = play_match(rando, neural, num_games=half, seed=seed + half)

    wins = r1.team0_wins + r2.team1_wins
    n = 2 * half
    return (wins, n) if return_counts else wins / n
