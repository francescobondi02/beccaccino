"""Score checkpoints against the heuristic on mirrored held-out deals."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from dataclasses import dataclass

import torch

from evaluation.arena import EVAL_SEED_BASE, NeuralAgent, play_match
from evaluation.heuristic import HeuristicAgent
from evaluation.stats import wilson_interval
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

    @property
    def win_rate(self) -> float:
        return self.wins / self.games

    @property
    def interval(self) -> tuple[float, float]:
        return wilson_interval(self.wins, self.games)


def evaluate_mirrored(
    candidate,
    baseline,
    *,
    games: int = DEFAULT_GAMES,
    seed: int = HELDOUT_SEED_BASE,
    win_points: int = WIN_POINTS,
) -> tuple[int, int]:
    """Play every seeded deal twice and return candidate wins and total games."""
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
    wins = candidate_team0.team0_wins + candidate_team1.team1_wins
    return wins, 2 * games


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
        wins, total_games = evaluate_mirrored(candidate, baseline, games=games)
        results.append(CheckpointScore(path, wins, total_games))
    return results


def format_score(result: CheckpointScore) -> str:
    low, high = result.interval
    return (
        f"{result.checkpoint}: {result.wins}/{result.games} wins "
        f"({result.win_rate:.2%}); Wilson 95% CI [{low:.2%}, {high:.2%}]"
    )


def verdict(results: Sequence[CheckpointScore]) -> str:
    """Choose the highest point estimate, reporting equal leaders as a tie."""
    if not results:
        raise ValueError("at least one result is required")

    best_rate = max(result.win_rate for result in results)
    leaders = sorted(result.checkpoint for result in results if result.win_rate == best_rate)
    if len(leaders) > 1:
        return f"VERDICT: tie at {best_rate:.2%}: {', '.join(leaders)}"
    return f"VERDICT: ship {leaders[0]} ({best_rate:.2%}, highest held-out win rate)"


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
