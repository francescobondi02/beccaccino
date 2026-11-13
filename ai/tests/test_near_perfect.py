from __future__ import annotations

import json

from evaluation.near_perfect import PROTOCOL_ID, evaluate_near_perfect, load_evidence
from scripts.check_near_perfect import main


def _artifact(tmp_path, name):
    path = tmp_path / name
    path.write_text("{}\n")
    return str(path)


def _passing_evidence(tmp_path):
    opponent_artifact = _artifact(tmp_path, "opponent.jsonl")
    abr_artifact = _artifact(tmp_path, "abr.jsonl")
    return {
        "protocol_id": PROTOCOL_ID,
        "candidate_sha256": "a" * 64,
        "training_seed_ids": ["seed-1", "seed-2", "seed-3"],
        "opponents": [
            {
                "name": "champion-a",
                "category": "historical",
                "mirrored_deals": 1_000,
                "paired_interval": [0.51, 0.55],
                "artifact": opponent_artifact,
            },
            {
                "name": "champion-b",
                "category": "historical",
                "mirrored_deals": 1_000,
                "paired_interval": [0.50, 0.54],
                "artifact": opponent_artifact,
            },
            {
                "name": "rule-a",
                "category": "rule",
                "mirrored_deals": 1_000,
                "paired_interval": [0.70, 0.74],
                "artifact": opponent_artifact,
            },
            {
                "name": "rule-b",
                "category": "rule",
                "mirrored_deals": 1_000,
                "paired_interval": [0.68, 0.72],
                "artifact": opponent_artifact,
            },
            {
                "name": "repaired-pimc",
                "category": "pimc",
                "mirrored_deals": 1_000,
                "paired_interval": [0.48, 0.52],
                "artifact": opponent_artifact,
            },
            {
                "name": "search-teacher",
                "category": "search_teacher",
                "mirrored_deals": 1_000,
                "paired_interval": [0.49, 0.53],
                "artifact": opponent_artifact,
            },
        ],
        "pimc_gain": {
            "estimate": 0.03,
            "paired_interval": [0.01, 0.05],
            "artifact": opponent_artifact,
        },
        "latency": {
            "samples": 1_000,
            "p95_seconds": 0.8,
            "max_seconds": 4.2,
            "artifact": opponent_artifact,
        },
        "approximate_best_responses": [
            {
                "name": f"abr-{index}",
                "mirrored_deals": 5_000,
                "edge_upper_bound": 0.02,
                "artifact": abr_artifact,
            }
            for index in range(3)
        ],
        "expert_states": {
            "total": 200,
            "forced_total": 80,
            "forced_correct": 80,
            "acceptable": 190,
            "critical_misses": 0,
            "artifact": _artifact(tmp_path, "expert.jsonl"),
        },
    }


def test_complete_evidence_supports_scoped_claim(tmp_path):
    result = evaluate_near_perfect(_passing_evidence(tmp_path))

    assert result.passed
    assert result.failures == ()
    assert result.claim == f"No material exploit found under {PROTOCOL_ID}."


def test_gate_fails_closed_across_research_dimensions(tmp_path):
    evidence = _passing_evidence(tmp_path)
    evidence["training_seed_ids"] = ["one"]
    evidence["opponents"] = evidence["opponents"][:-1]
    evidence["pimc_gain"]["paired_interval"] = [-0.01, 0.04]
    evidence["latency"]["p95_seconds"] = 1.0
    evidence["approximate_best_responses"][0]["edge_upper_bound"] = 0.03
    evidence["expert_states"]["critical_misses"] = 1

    result = evaluate_near_perfect(evidence)

    assert not result.passed
    assert any("training seeds" in failure for failure in result.failures)
    assert any("search_teacher" in failure for failure in result.failures)
    assert any("PIMC gain paired lower" in failure for failure in result.failures)
    assert any("latency p95" in failure for failure in result.failures)
    assert any("ABR abr-0" in failure for failure in result.failures)
    assert any("critical misses" in failure for failure in result.failures)


def test_cli_returns_nonzero_for_incomplete_evidence(tmp_path, capsys):
    evidence_path = tmp_path / "evidence.json"
    evidence_path.write_text(json.dumps({"protocol_id": PROTOCOL_ID}))

    assert main([str(evidence_path)]) == 1
    assert '"passed": false' in capsys.readouterr().out


def test_load_evidence_requires_json_object(tmp_path):
    evidence_path = tmp_path / "evidence.json"
    evidence_path.write_text("[]")

    try:
        load_evidence(evidence_path)
    except ValueError as exc:
        assert "JSON object" in str(exc)
    else:
        raise AssertionError("list evidence should be rejected")
