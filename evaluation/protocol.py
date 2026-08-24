"""Persisted, mirrored checkpoint-selection protocol."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from evaluation.arena import GameRecord, MirroredDealRecord
from evaluation.stats import paired_mean_interval

MIN_CHAMPION_DEALS = 1_000


@dataclass(frozen=True)
class ChampionSummary:
    deals: int
    games: int
    wins: int
    win_rate: float
    paired_interval: tuple[float, float]
    decision: str
    slices: dict


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_champion(records: list[MirroredDealRecord]) -> ChampionSummary:
    if not records:
        raise ValueError("at least one mirrored deal is required")
    seeds = [record.seed for record in records]
    if len(seeds) != len(set(seeds)):
        raise ValueError("duplicate deal seeds are not allowed")

    legs = [leg for record in records for leg in (record.candidate_team0, record.candidate_team1)]
    paired_scores = [record.paired_score for record in records]
    wins = sum(int(leg.candidate_score) for leg in legs)
    interval = paired_mean_interval(paired_scores)
    if len(records) < MIN_CHAMPION_DEALS:
        decision = f"insufficient: requires at least {MIN_CHAMPION_DEALS} mirrored deals"
    elif interval[0] > 0.5:
        decision = "promote"
    else:
        decision = "retain incumbent"

    return ChampionSummary(
        deals=len(records),
        games=len(legs),
        wins=wins,
        win_rate=wins / len(legs),
        paired_interval=interval,
        decision=decision,
        slices=_slice_report(legs),
    )


def write_score_jsonl(
    path: str | Path,
    *,
    protocol_id: str,
    candidate_path: str | Path,
    incumbent_path: str | Path,
    seed_base: int,
    win_points: int,
    records: list[MirroredDealRecord],
) -> ChampionSummary:
    """Create a non-overwritable score artifact for one held-out seed block."""
    if not protocol_id.strip():
        raise ValueError("protocol_id must not be blank")
    expected_seeds = list(range(seed_base, seed_base + len(records)))
    if [record.seed for record in records] != expected_seeds:
        raise ValueError("deal records do not match the declared contiguous seed block")
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    summary = summarize_champion(records)
    manifest = {
        "type": "manifest",
        "protocol_id": protocol_id,
        "candidate": str(candidate_path),
        "candidate_sha256": sha256_file(candidate_path),
        "incumbent": str(incumbent_path),
        "incumbent_sha256": sha256_file(incumbent_path),
        "seed_base": seed_base,
        "deals": len(records),
        "win_points": win_points,
    }
    with output.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(manifest, sort_keys=True) + "\n")
        for record in records:
            row = {
                "type": "deal",
                "seed": record.seed,
                "paired_score": record.paired_score,
                "legs": [
                    asdict(record.candidate_team0),
                    asdict(record.candidate_team1),
                ],
            }
            stream.write(json.dumps(row, sort_keys=True) + "\n")
        stream.write(
            json.dumps(
                {"type": "summary", **asdict(summary)},
                sort_keys=True,
            )
            + "\n"
        )
    return summary


def _slice_report(legs: list[GameRecord]) -> dict:
    groups: dict[str, dict[str, list[GameRecord]]] = {
        "candidate_team": defaultdict(list),
        "initial_caller_seat": defaultdict(list),
        "caller_role": defaultdict(list),
        "briscola": defaultdict(list),
        "rounds": defaultdict(list),
    }
    for leg in legs:
        groups["candidate_team"][str(leg.candidate_team)].append(leg)
        groups["initial_caller_seat"][str(leg.initial_caller)].append(leg)
        caller_role = "candidate" if leg.initial_caller % 2 == leg.candidate_team else "incumbent"
        groups["caller_role"][caller_role].append(leg)
        groups["briscola"][leg.initial_briscola].append(leg)
        groups["rounds"][str(leg.rounds)].append(leg)

    report = {
        name: {
            key: {
                "games": len(rows),
                "wins": sum(int(row.candidate_score) for row in rows),
                "win_rate": sum(row.candidate_score for row in rows) / len(rows),
            }
            for key, rows in sorted(values.items())
        }
        for name, values in groups.items()
    }
    report["signals"] = {
        "candidate_total": sum(leg.candidate_signals for leg in legs),
        "incumbent_total": sum(leg.opponent_signals for leg in legs),
        "candidate_per_game": sum(leg.candidate_signals for leg in legs) / len(legs),
        "incumbent_per_game": sum(leg.opponent_signals for leg in legs) / len(legs),
    }
    report["game_length"] = {
        "mean_rounds": sum(leg.rounds for leg in legs) / len(legs),
        "mean_actions": sum(leg.actions for leg in legs) / len(legs),
        "max_actions": max(leg.actions for leg in legs),
    }
    return report
