"""Score checkpoints against the heuristic on mirrored held-out deals."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import torch

from evaluation.arena import EVAL_SEED_BASE, NeuralAgent, iter_mirrored_deals
from evaluation.heuristic import HeuristicAgent
from evaluation.protocol import write_score_jsonl
from evaluation.stats import (
    DEFAULT_Z,
    paired_mean_interval,
    wilson_interval,
)
from evaluation.stats import (
    paired_difference_interval as _paired_difference_interval,
)
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


def paired_difference_interval(
    leader: CheckpointScore,
    competitor: CheckpointScore,
    z: float = DEFAULT_Z,
) -> tuple[float, float]:
    return _paired_difference_interval(
        leader.paired_scores,
        competitor.paired_scores,
        z=z,
    )


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

    records = list(
        iter_mirrored_deals(
            lambda _: candidate,
            lambda _: baseline,
            num_deals=games,
            seed=seed,
            win_points=win_points,
        )
    )
    paired_scores = tuple(record.paired_score for record in records)
    wins = sum(
        int(leg.candidate_score)
        for record in records
        for leg in (record.candidate_team0, record.candidate_team1)
    )
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


def select_champion(
    candidate_path: str,
    incumbent_path: str,
    *,
    protocol_id: str,
    seed_base: int,
    output: str | Path,
    games: int = DEFAULT_GAMES,
    win_points: int = WIN_POINTS,
    device: str | torch.device = "cpu",
):
    """Direct held-out candidate/incumbent match with durable per-deal output."""
    torch_device = torch.device(device)
    candidate_net = build_net(
        load_checkpoint(candidate_path, map_location=torch_device),
        torch_device,
    )
    incumbent_net = build_net(
        load_checkpoint(incumbent_path, map_location=torch_device),
        torch_device,
    )
    records = list(
        iter_mirrored_deals(
            lambda _: NeuralAgent(candidate_net, torch_device, temperature=0.0),
            lambda _: NeuralAgent(incumbent_net, torch_device, temperature=0.0),
            num_deals=games,
            seed=seed_base,
            win_points=win_points,
        )
    )
    return write_score_jsonl(
        output,
        protocol_id=protocol_id,
        candidate_path=candidate_path,
        incumbent_path=incumbent_path,
        seed_base=seed_base,
        win_points=win_points,
        records=records,
    )


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
    parser.add_argument(
        "checkpoints",
        nargs="*",
        help="Benchmark-only paths scored against the frozen heuristic block",
    )
    parser.add_argument(
        "--games",
        type=_positive_int,
        default=DEFAULT_GAMES,
        help="Held-out deals per checkpoint; each deal is played twice (default: 1000)",
    )
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--candidate", help="Candidate checkpoint for direct champion selection")
    parser.add_argument("--incumbent", help="Current champion checkpoint")
    parser.add_argument("--protocol-id", help="Unique immutable protocol/run identifier")
    parser.add_argument("--seed-base", type=int, help="Fresh, predeclared held-out seed base")
    parser.add_argument("--output", default="score.jsonl", help="New JSONL result path")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    champion_values = (args.candidate, args.incumbent, args.protocol_id, args.seed_base)
    if any(value is not None for value in champion_values):
        if not all(value is not None for value in champion_values):
            raise SystemExit(
                "--candidate, --incumbent, --protocol-id, and --seed-base are required together"
            )
        if args.checkpoints:
            raise SystemExit("positional checkpoint benchmarking cannot be mixed with selection")
        summary = select_champion(
            args.candidate,
            args.incumbent,
            protocol_id=args.protocol_id,
            seed_base=args.seed_base,
            output=args.output,
            games=args.games,
            device=args.device,
        )
        low, high = summary.paired_interval
        print(
            f"{args.protocol_id}: {summary.wins}/{summary.games} wins "
            f"({summary.win_rate:.2%}); paired 95% CI [{low:.2%}, {high:.2%}]"
        )
        print(f"DECISION: {summary.decision}; wrote {args.output}")
        return
    if not args.checkpoints:
        raise SystemExit("provide checkpoint paths or --candidate/--incumbent selection inputs")
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
