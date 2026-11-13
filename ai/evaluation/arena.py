"""Arena: pit agents against each other to measure relative strength.

Supports: trained model vs random baseline, model vs model, Elo tracking.
"""

from __future__ import annotations

import random
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

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
        obs = encode_observation(game, seat, obs_size=self.net.obs_size)
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
    winners: list[int] = field(default_factory=list)

    @property
    def total_games(self) -> int:
        return self.team0_wins + self.team1_wins + self.draws

    @property
    def team0_winrate(self) -> float:
        if self.total_games == 0:
            return 0.0
        return self.team0_wins / self.total_games


@dataclass(frozen=True)
class GameRecord:
    seed: int
    candidate_team: int
    winner_team: int
    initial_caller: int
    initial_briscola: str
    rounds: int
    actions: int
    candidate_signals: int
    opponent_signals: int
    final_scores: tuple[int, int]

    @property
    def candidate_score(self) -> float:
        return float(self.winner_team == self.candidate_team)


@dataclass(frozen=True)
class MirroredDealRecord:
    seed: int
    candidate_team0: GameRecord
    candidate_team1: GameRecord

    @property
    def paired_score(self) -> float:
        return (self.candidate_team0.candidate_score + self.candidate_team1.candidate_score) / 2


AgentFactory = Callable[[int], object]


def play_recorded_game(
    candidate,
    opponent,
    *,
    candidate_team: int,
    seed: int,
    win_points: int = 41,
) -> GameRecord:
    """Play one game and retain the public slices needed by promotion reports."""
    if candidate_team not in (0, 1):
        raise ValueError("candidate_team must be 0 or 1")
    game = BeccaGame(seed=seed, win_points=win_points)
    initial_caller = game.current_seat
    initial_briscola = ""
    actions = 0
    candidate_signals = 0
    opponent_signals = 0

    while game.phase != GamePhase.GAME_OVER:
        seat = game.current_seat
        team = TEAM_OF_SEAT[seat]
        agent = candidate if team == candidate_team else opponent
        info = game.step(agent.select_action(game, seat))
        actions += 1
        if not initial_briscola and game.round.briscola is not None:
            initial_briscola = game.round.briscola.value
        if info.get("signal") is not None:
            if team == candidate_team:
                candidate_signals += 1
            else:
                opponent_signals += 1

    return GameRecord(
        seed=seed,
        candidate_team=candidate_team,
        winner_team=game.result.winner_team,
        initial_caller=initial_caller,
        initial_briscola=initial_briscola,
        rounds=game.round.number,
        actions=actions,
        candidate_signals=candidate_signals,
        opponent_signals=opponent_signals,
        final_scores=(game.total_scores[0], game.total_scores[1]),
    )


def iter_mirrored_deals(
    candidate_factory: AgentFactory,
    opponent_factory: AgentFactory,
    *,
    num_deals: int,
    seed: int,
    win_points: int = 41,
) -> Iterator[MirroredDealRecord]:
    """Play each deal on both sides, resetting agent state for every leg."""
    if num_deals <= 0:
        raise ValueError("num_deals must be positive")
    for offset in range(num_deals):
        deal_seed = seed + offset
        yield MirroredDealRecord(
            seed=deal_seed,
            candidate_team0=play_recorded_game(
                candidate_factory(deal_seed),
                opponent_factory(deal_seed),
                candidate_team=0,
                seed=deal_seed,
                win_points=win_points,
            ),
            candidate_team1=play_recorded_game(
                candidate_factory(deal_seed),
                opponent_factory(deal_seed),
                candidate_team=1,
                seed=deal_seed,
                win_points=win_points,
            ),
        )


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
        record = play_recorded_game(
            team0_agent,
            team1_agent,
            candidate_team=0,
            seed=seed + i,
            win_points=win_points,
        )
        winner = record.winner_team
        result.winners.append(winner)
        if winner == 0:
            result.team0_wins += 1
        else:
            result.team1_wins += 1

    return result


def evaluate_side_balanced(
    candidate,
    opponent,
    *,
    num_games: int,
    seed: int,
    win_points: int = 41,
) -> tuple[int, int]:
    """Evaluate on disjoint seed blocks with each agent playing both sides.

    This preserves the historical monitoring contract. Promotion uses
    `iter_mirrored_deals`, which replays every seed on both sides.
    """
    half = num_games // 2
    candidate_team0 = play_match(
        candidate,
        opponent,
        num_games=half,
        win_points=win_points,
        seed=seed,
    )
    candidate_team1 = play_match(
        opponent,
        candidate,
        num_games=half,
        win_points=win_points,
        seed=seed + half,
    )
    return candidate_team0.team0_wins + candidate_team1.team1_wins, 2 * half


ELO_SCALE = 400.0  # standard Elo logistic scale
LADDER_INIT_RATING = 1000.0
LADDER_ITERATIONS = 20  # fixed-point passes for the round-robin solve


def _expected_score(rating_a: float, rating_b: float) -> float:
    """Logistic expected score of A vs B (same convention as EloTracker)."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / ELO_SCALE))


def elo_ladder(
    checkpoints: dict[str, BeccaNet],
    num_games: int = 100,
    block_seed: int = EVAL_SEED_BASE,
    win_points: int = 41,
    device: torch.device = torch.device("cpu"),
    k_factor: float = 32.0,
) -> dict[str, float]:
    """Rank checkpoints by Elo on ONE frozen block of deals (round-robin).

    Each unordered pair plays num_games twice (sides swapped) to cancel any
    first-seat advantage, yielding a combined score in [0, 1]. Ratings start at
    LADDER_INIT_RATING and are solved by LADDER_ITERATIONS fixed-point passes of
    the standard Elo update. Deterministic given the same block_seed.
    """
    names = list(checkpoints)
    ratings = {n: LADDER_INIT_RATING for n in names}

    # Pairwise combined scores from A's perspective, computed once.
    pair_score: dict[tuple[str, str], float] = {}
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            records = iter_mirrored_deals(
                lambda _: NeuralAgent(checkpoints[a], device, temperature=0.0),
                lambda _: NeuralAgent(checkpoints[b], device, temperature=0.0),
                num_deals=num_games,
                seed=block_seed,
                win_points=win_points,
            )
            pair_score[(a, b)] = sum(record.paired_score for record in records) / num_games

    for _ in range(LADDER_ITERATIONS):
        for (a, b), score_a in pair_score.items():
            exp_a = _expected_score(ratings[a], ratings[b])
            delta = k_factor * (score_a - exp_a)
            ratings[a] += delta
            ratings[b] -= delta
    return ratings


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
    wins, n = evaluate_side_balanced(
        NeuralAgent(net, device, temperature=0.0),
        RandomAgent(seed=seed + 10000),
        num_games=num_games,
        seed=seed,
    )
    return (wins, n) if return_counts else wins / n
