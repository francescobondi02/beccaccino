"""Fail-closed evidence gate for the scoped NearPerfect-v1 claim."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

PROTOCOL_ID = "NearPerfect-v1"


@dataclass(frozen=True)
class NearPerfectSpec:
    protocol_id: str = PROTOCOL_ID
    training_seeds: int = 3
    mirrored_deals_per_opponent: int = 1_000
    historical_opponents: int = 2
    independent_rule_opponents: int = 2
    pimc_opponents: int = 1
    search_teacher_opponents: int = 1
    pimc_min_gain: float = 0.02
    latency_samples: int = 1_000
    latency_p95_seconds: float = 1.0
    latency_max_seconds: float = 5.0
    abr_agents: int = 3
    abr_deals: int = 5_000
    abr_max_edge_upper: float = 0.02
    expert_states: int = 200
    expert_acceptable_rate: float = 0.95


@dataclass(frozen=True)
class GateResult:
    passed: bool
    failures: tuple[str, ...]
    claim: str


def load_evidence(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as stream:
        evidence = json.load(stream)
    if not isinstance(evidence, dict):
        raise ValueError("near-perfect evidence must be a JSON object")
    return evidence


def evaluate_near_perfect(evidence: dict, spec: NearPerfectSpec | None = None) -> GateResult:
    """Validate persisted evidence without inferring or extending experiments."""
    spec = spec or NearPerfectSpec()
    failures: list[str] = []
    if evidence.get("protocol_id") != spec.protocol_id:
        failures.append(f"protocol_id must be {spec.protocol_id}")
    candidate_hash = evidence.get("candidate_sha256", "")
    if len(candidate_hash) != 64:
        failures.append("candidate_sha256 must identify the frozen candidate")

    seeds = evidence.get("training_seed_ids", [])
    if len(set(seeds)) < spec.training_seeds:
        failures.append(f"requires {spec.training_seeds} distinct training seeds")

    opponents = evidence.get("opponents", [])
    category_minimums = {
        "historical": spec.historical_opponents,
        "rule": spec.independent_rule_opponents,
        "pimc": spec.pimc_opponents,
        "search_teacher": spec.search_teacher_opponents,
    }
    for category, minimum in category_minimums.items():
        matches = [row for row in opponents if row.get("category") == category]
        if len(matches) < minimum:
            failures.append(f"requires {minimum} {category} opponent result(s)")
        for row in matches:
            if row.get("mirrored_deals", 0) < spec.mirrored_deals_per_opponent:
                failures.append(
                    f"opponent {row.get('name', '<unnamed>')} has fewer than "
                    f"{spec.mirrored_deals_per_opponent} mirrored deals"
                )
            _require_artifact(row, failures, f"opponent {row.get('name', '<unnamed>')}")
            interval = row.get("paired_interval")
            if not _valid_interval(interval):
                failures.append(f"opponent {row.get('name', '<unnamed>')} lacks a paired interval")

    pimc_gain = evidence.get("pimc_gain", {})
    if pimc_gain.get("estimate", float("-inf")) < spec.pimc_min_gain:
        failures.append(f"PIMC gain must be at least {spec.pimc_min_gain:.0%}")
    if pimc_gain.get("paired_interval", [float("-inf")])[0] <= 0.0:
        failures.append("PIMC gain paired lower bound must exceed zero")
    _require_artifact(pimc_gain, failures, "PIMC gain")

    latency = evidence.get("latency", {})
    if latency.get("samples", 0) < spec.latency_samples:
        failures.append(f"latency requires at least {spec.latency_samples} decisions")
    if latency.get("p95_seconds", float("inf")) >= spec.latency_p95_seconds:
        failures.append(f"latency p95 must be below {spec.latency_p95_seconds:g}s")
    if latency.get("max_seconds", float("inf")) >= spec.latency_max_seconds:
        failures.append(f"latency maximum must be below {spec.latency_max_seconds:g}s")
    _require_artifact(latency, failures, "latency")

    abr_rows = evidence.get("approximate_best_responses", [])
    if len(abr_rows) < spec.abr_agents:
        failures.append(f"requires {spec.abr_agents} approximate best-response agents")
    for row in abr_rows:
        name = row.get("name", "<unnamed>")
        if row.get("mirrored_deals", 0) < spec.abr_deals:
            failures.append(f"ABR {name} has fewer than {spec.abr_deals} mirrored deals")
        if row.get("edge_upper_bound", float("inf")) > spec.abr_max_edge_upper:
            failures.append(f"ABR {name} edge upper bound exceeds {spec.abr_max_edge_upper:.0%}")
        _require_artifact(row, failures, f"ABR {name}")

    expert = evidence.get("expert_states", {})
    total = expert.get("total", 0)
    acceptable = expert.get("acceptable", 0)
    if total < spec.expert_states:
        failures.append(f"expert corpus requires at least {spec.expert_states} states")
    if expert.get("forced_correct", 0) != expert.get("forced_total", -1):
        failures.append("all forced/solved expert states must be correct")
    if total <= 0 or acceptable / total < spec.expert_acceptable_rate:
        failures.append(
            f"expert acceptable-action agreement must be at least {spec.expert_acceptable_rate:.0%}"
        )
    if expert.get("critical_misses", -1) != 0:
        failures.append("expert corpus must have zero critical misses")
    _require_artifact(expert, failures, "expert states")

    passed = not failures
    claim = (
        f"No material exploit found under {spec.protocol_id}."
        if passed
        else f"{spec.protocol_id} claim not supported."
    )
    return GateResult(passed=passed, failures=tuple(failures), claim=claim)


def _valid_interval(value) -> bool:
    return (
        isinstance(value, list | tuple) and len(value) == 2 and 0.0 <= value[0] <= value[1] <= 1.0
    )


def _require_artifact(row: dict, failures: list[str], label: str) -> None:
    artifact = row.get("artifact")
    if not artifact or not Path(artifact).is_file():
        failures.append(f"{label} artifact is missing")
