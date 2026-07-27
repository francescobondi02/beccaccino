"""Score checkpoints against the heuristic on mirrored held-out deals."""

from __future__ import annotations

import argparse
import math
from collections.abc import Sequence
from dataclasses import dataclass

import torch

from evaluation.arena import EVAL_SEED_BASE, NeuralAgent, play_match
from evaluation.heuristic import HeuristicAgent
from evaluation.stats import DEFAULT_Z, wilson_interval
from training.checkpoint import build_net, load_checkpoint

DEFAULT_GAMES = 1_000
WIN_POINTS = 41

# This one-million offset clears all deal ranges used by training and selection:
# the frozen EVAL_SEED_BASE..+eval_games block, random eval's +10_000 offset,
# and training's cfg.seed + games_total + i range (near zero and ~3M for Run D,
# comfortably below EVAL_SEED_BASE = 20,260,724).
HELDOUT_SEED_BASE = EVAL_SEED_BASE + 1_000_000


@dataclass(frozen=True)
class CheckpointScore:
    checkpoint: str
    wins: int
    games: int
    paired_scores: tuple[float, ...] = ()

    @property
    def win_rate(self) -> float:
        return self.wins / self.games

    @property
    def interval(self) -> tuple[float, float]:
        if self.paired_scores:
            return paired_mean_interval(self.paired_scores)
        return wilson_interval(self.wins, self.games)


def paired_mean_interval(scores: Sequence[float], z: float = DEFAULT_Z) -> tuple[float, float]:
    if not scores:
        raise ValueError("at least one paired score is required")
    mean = sum(scores) / len(scores)
    if len(scores) < 2:
        return (0.0, 1.0)
    variance = sum((score - mean) ** 2 for score in scores) / (len(scores) - 1)
    half_width = z * math.sqrt(variance / len(scores))
    return max(0.0, mean - half_width), min(1.0, mean + half_width)


def paired_difference_interval(
    leader: CheckpointScore,
    competitor: CheckpointScore,
    z: float = DEFAULT_Z,
) -> tuple[float, float]:
    if len(leader.paired_scores) != len(competitor.paired_scores):
        raise ValueError("checkpoint scores must cover the same held-out deals")
    differences = [
        leader_score - competitor_score
        for leader_score, competitor_score in zip(leader.paired_scores, competitor.paired_scores)
    ]
    if not differences:
        raise ValueError("paired deal scores are required for a shipping verdict")
    mean = sum(differences) / len(differences)
    if len(differences) < 2:
        return (-1.0, 1.0)
    variance = sum((difference - mean) ** 2 for difference in differences) / (len(differences) - 1)
    half_width = z * math.sqrt(variance / len(differences))
    return mean - half_width, mean + half_width


def evaluate_mirrored(
    candidate,
    baseline,
    *,
    games: int = DEFAULT_GAMES,
    seed: int = HELDOUT_SEED_BASE,
    win_points: int = WIN_POINTS,
) -> tuple[int, int, tuple[float, ...]]:
    """Play every seeded deal twice and preserve its paired candidate score."""
    if games <= 0:
        raise ValueError("games must be positive")

    candidate_team0 = play_match(
        candidate,
        baseline,
        num_games=games,
        win_points=win_points,
        seed=seed,
    )
    candidate_team1 = play_match(
        baseline,
        candidate,
        num_games=games,
        win_points=win_points,
        seed=seed,
    )
    if len(candidate_team0.winners) != games or len(candidate_team1.winners) != games:
        raise RuntimeError("arena did not return one winner per mirrored deal")
    paired_scores = tuple(
        ((winner0 == 0) + (winner1 == 1)) / 2
        for winner0, winner1 in zip(candidate_team0.winners, candidate_team1.winners)
    )
    wins = candidate_team0.team0_wins + candidate_team1.team1_wins
    return wins, 2 * games, paired_scores


def score_checkpoints(
    checkpoint_paths: Sequence[str],
    *,
    games: int = DEFAULT_GAMES,
    device: str | torch.device = "cpu",
) -> list[CheckpointScore]:
    """Load and score checkpoints in input order on one held-out seed block."""
    if not checkpoint_paths:
        raise ValueError("at least one checkpoint is required")

    torch_device = torch.device(device)
    results = []
    for path in checkpoint_paths:
        checkpoint = load_checkpoint(path, map_location=torch_device)
        net = build_net(checkpoint, torch_device)
        candidate = NeuralAgent(net, torch_device, temperature=0.0)
        baseline = HeuristicAgent(seed=HELDOUT_SEED_BASE + 10_000)
        wins, total_games, paired_scores = evaluate_mirrored(candidate, baseline, games=games)
        results.append(CheckpointScore(path, wins, total_games, paired_scores=paired_scores))
    return results


def format_score(result: CheckpointScore) -> str:
    low, high = result.interval
    interval_name = "paired 95% CI" if result.paired_scores else "Wilson 95% CI"
    return (
        f"{result.checkpoint}: {result.wins}/{result.games} wins "
        f"({result.win_rate:.2%}); {interval_name} [{low:.2%}, {high:.2%}]"
    )


def verdict(results: Sequence[CheckpointScore]) -> str:
    """Ship only when the paired held-out lead is positive at 95% confidence."""
    if not results:
        raise ValueError("at least one result is required")

    best_rate = max(result.win_rate for result in results)
    leaders = sorted(result.checkpoint for result in results if result.win_rate == best_rate)
    if len(leaders) > 1:
        return f"VERDICT: tie at {best_rate:.2%}: {', '.join(leaders)}"
    leader = next(result for result in results if result.checkpoint == leaders[0])
    competitors = [result for result in results if result is not leader]
    if not competitors:
        return f"VERDICT: only candidate {leader.checkpoint}; no comparison available"
    if not leader.paired_scores or any(not competitor.paired_scores for competitor in competitors):
        return "VERDICT: inconclusive; paired deal outcomes are required"

    intervals = [
        (competitor, paired_difference_interval(leader, competitor)) for competitor in competitors
    ]
    if all(low > 0.0 for _, (low, _) in intervals):
        return (
            f"VERDICT: ship {leader.checkpoint} ({best_rate:.2%}; paired lead is positive at 95%)"
        )
    closest, (low, high) = min(intervals, key=lambda item: item[1][0])
    return (
        f"VERDICT: inconclusive; {leader.checkpoint} vs {closest.checkpoint} "
        f"paired lead CI [{low:.2%}, {high:.2%}] crosses zero"
    )


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score checkpoints against HeuristicAgent on mirrored held-out deals."
    )
    parser.add_argument("checkpoints", nargs="+", help="Paths to .pt checkpoints")
    parser.add_argument(
        "--games",
        type=_positive_int,
        default=DEFAULT_GAMES,
        help="Held-out deals per checkpoint; each deal is played twice (default: 1000)",
    )
    parser.add_argument("--device", default="cpu")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    results = score_checkpoints(args.checkpoints, games=args.games, device=args.device)

    seed_end = HELDOUT_SEED_BASE + args.games - 1
    print(
        f"Held-out seeds {HELDOUT_SEED_BASE}..{seed_end}; "
        f"{args.games} mirrored deals ({2 * args.games} games), wp={WIN_POINTS}"
    )
    for result in results:
        print(format_score(result))
    print(verdict(results))


if __name__ == "__main__":
    main()
