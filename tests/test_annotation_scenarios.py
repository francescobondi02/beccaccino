"""Focused contracts for deterministic offline annotation batches."""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from pathlib import Path

import pytest

from becca_env.deck import Card, Suit, Value, card_points
from becca_env.rules import determine_hand_winner
from scripts import generate_annotation_scenarios as generator
from scripts.annotation_scenario_constants import (
    ANNOTATION_DIFFICULTIES,
    ANNOTATION_IMPORTANCE_VALUES,
    ANNOTATION_TAGS,
    IMPORTANCE_CURATED_CORNER_CASE,
    IMPORTANCE_STANDARD,
    IMPORTANCE_USEFUL_UNCOMMON,
    MIN_CURATED_CORNER_SHARE,
    TARGET_DIFFICULTY_MIX,
)

MASTER_SEED = b"private-test-master-seed-material-v1"
BATCH_ID = "expert-2026-08"
SCENARIO_COUNT = 50
MODEL_SHA256 = "ab" * 32


def _fake_policy_margin(game) -> float:
    state_bytes = generator.canonical_json_bytes(generator.public_state(game))
    bucket = hashlib.sha256(state_bytes).digest()[0] % 3
    return (0.05, 1.5, 12.0)[bucket]


@pytest.fixture(scope="module")
def batch() -> list[dict]:
    return generator.generate_batch(
        master_seed=MASTER_SEED,
        batch_id=BATCH_ID,
        scenario_count=SCENARIO_COUNT,
        policy_margin_scorer=_fake_policy_margin,
        max_source_games=20,
    )


def _all_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value).union(*(_all_keys(child) for child in value.values()), set())
    if isinstance(value, list):
        return set().union(*(_all_keys(child) for child in value), set())
    return set()


def _card(card: dict) -> Card:
    return Card(Suit(card["suit"]), Value(card["value"]))


def test_fixed_annotation_constants():
    assert ANNOTATION_DIFFICULTIES == ("easy", "medium", "hard")
    assert ANNOTATION_TAGS == (
        "lead",
        "must_follow",
        "void",
        "partner_winning",
        "high_value_trick",
        "late_round",
        "score_pressure",
        "signal_decision",
    )
    assert ANNOTATION_IMPORTANCE_VALUES == (1, 2, 3)
    assert TARGET_DIFFICULTY_MIX == {"easy": 0.2, "medium": 0.4, "hard": 0.4}
    assert MIN_CURATED_CORNER_SHARE == 0.05


def test_hmac_game_seeds_are_deterministic_domain_separated_and_private():
    first = generator.derive_game_seed(MASTER_SEED, BATCH_ID, 0)

    assert first == generator.derive_game_seed(MASTER_SEED, BATCH_ID, 0)
    assert first != generator.derive_game_seed(MASTER_SEED, BATCH_ID, 1)
    assert first != generator.derive_game_seed(MASTER_SEED, "expert-2026-09", 0)
    assert first != generator.derive_game_seed(b"x" * 32, BATCH_ID, 0)
    assert str(MASTER_SEED) not in str(first)
    assert generator.seed_fingerprint(MASTER_SEED) != hashlib.sha256(MASTER_SEED).hexdigest()


def test_generation_is_deterministic_and_meets_exact_difficulty_quotas(batch):
    regenerated = generator.generate_batch(
        master_seed=MASTER_SEED,
        batch_id=BATCH_ID,
        scenario_count=SCENARIO_COUNT,
        policy_margin_scorer=_fake_policy_margin,
        max_source_games=20,
    )

    assert generator.canonical_json_bytes(regenerated) == generator.canonical_json_bytes(batch)
    assert Counter(item["predictedDifficulty"] for item in batch) == {
        "easy": 10,
        "medium": 20,
        "hard": 20,
    }
    assert [item["code"] for item in batch] == [
        f"{BATCH_ID}-{ordinal:05d}" for ordinal in range(1, SCENARIO_COUNT + 1)
    ]
    assert sum(
        item["importance"] == IMPORTANCE_CURATED_CORNER_CASE for item in batch
    ) >= generator.minimum_curated_corner_count(SCENARIO_COUNT)


def test_forced_card_positions_are_excluded_even_for_signal_leaders(batch):
    assert all(
        generator.distinct_legal_card_count(item["state"]["legalActions"]) > 1 for item in batch
    )

    leader = next(item for item in batch if "lead" in item["tags"])
    state = leader["state"]
    assert len(state["legalActions"]) == len(state["hand"]) * 4
    assert generator.distinct_legal_card_count(state["legalActions"]) == len(state["hand"])
    one_card_actions = [
        {"suit": "denara", "value": "asso", "signal": signal}
        for signal in (None, "striscio", "busso", "volo")
    ]
    assert generator.distinct_legal_card_count(one_card_actions) == 1


def test_tags_are_objective_public_state_predicates(batch):
    for item in batch:
        state = item["state"]
        tags = set(item["tags"])
        current = state["currentTrick"]["plays"]
        lead_suit = current[0]["suit"] if current else None
        hand_suits = {card["suit"] for card in state["hand"]}

        assert ("lead" in tags) is (not current)
        assert ("signal_decision" in tags) is (not current)
        assert ("must_follow" in tags) is bool(current and lead_suit in hand_suits)
        assert ("void" in tags) is bool(current and lead_suit not in hand_suits)
        assert ("late_round" in tags) is (len(state["completedTricks"]) >= 7)
        assert ("score_pressure" in tags) is (max(state["totalScores"].values()) >= 93)

        if current:
            plays = [(play["seat"], _card(play)) for play in current]
            winner = determine_hand_winner(plays, Suit(state["briscola"]))
            assert ("partner_winning" in tags) is (winner % 2 == state["actingSeat"] % 2)
            points = sum(card_points[card.value] for _, card in plays)
            assert ("high_value_trick" in tags) is (points >= 3)

    pressure_state = copy.deepcopy(batch[0]["state"])
    pressure_state["totalScores"]["0"] = 93
    assert "score_pressure" in generator.classify_tags(pressure_state)


def test_importance_uses_explicit_rule_combinations():
    assert (
        generator.classify_importance(["void", "partner_winning", "high_value_trick"])
        == IMPORTANCE_CURATED_CORNER_CASE
    )
    assert (
        generator.classify_importance(["late_round", "high_value_trick"])
        == IMPORTANCE_USEFUL_UNCOMMON
    )
    assert generator.classify_importance(["must_follow"]) == IMPORTANCE_STANDARD


def test_batch_exposes_only_db_import_fields_and_public_state(batch):
    forbidden = {
        "id",
        "version",
        "category",
        "seed",
        "masterSeed",
        "playerHands",
        "hiddenHands",
        "policyMargin",
        "modelScores",
        "logits",
        "hiddenState",
    }

    assert all(set(item) == generator._SCENARIO_KEYS for item in batch)
    assert all(set(item["state"]) == set(generator._STATE_KEYS) for item in batch)
    assert not forbidden.intersection(_all_keys(batch))


def test_validation_rejects_state_tag_importance_and_quota_tampering(batch):
    bad_state = copy.deepcopy(batch)
    bad_state[0]["state"]["totalScores"]["0"] += 1
    with pytest.raises(ValueError, match="stateHash"):
        generator.validate_batch(
            bad_state,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    bad_tags = copy.deepcopy(batch)
    bad_tags[0]["tags"] = ["score_pressure"]
    with pytest.raises(ValueError, match="objective predicates"):
        generator.validate_batch(
            bad_tags,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    bad_importance = copy.deepcopy(batch)
    bad_importance[0]["importance"] = 3 if bad_importance[0]["importance"] != 3 else 1
    with pytest.raises(ValueError, match="objective rule combinations"):
        generator.validate_batch(
            bad_importance,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    bad_quota = copy.deepcopy(batch)
    easy = next(item for item in bad_quota if item["predictedDifficulty"] == "easy")
    easy["predictedDifficulty"] = "hard"
    with pytest.raises(ValueError, match="difficulty quotas"):
        generator.validate_batch(
            bad_quota,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )


def test_manifest_hashes_exact_batch_bytes_and_rejects_tampering(tmp_path, batch):
    batch_path = tmp_path / "nested" / "scenarios.json"
    manifest_path = tmp_path / "nested" / "manifest.json"
    manifest = generator.write_batch_outputs(
        batch=batch,
        batch_id=BATCH_ID,
        master_seed=MASTER_SEED,
        generator_commit="ai@852313d",
        model_sha256=MODEL_SHA256,
        output_batch_path=batch_path,
        manifest_path=manifest_path,
        max_source_games=20,
    )
    batch_bytes = batch_path.read_bytes()
    manifest_bytes = manifest_path.read_bytes()

    assert batch_bytes == generator.canonical_json_bytes(batch)
    assert manifest["batchSha256"] == hashlib.sha256(batch_bytes).hexdigest()
    assert MASTER_SEED not in batch_bytes
    assert MASTER_SEED not in manifest_bytes
    generator.validate_output_bytes(batch_bytes, manifest_bytes)

    tampered_manifest = copy.deepcopy(json.loads(manifest_bytes))
    tampered_manifest["batchSha256"] = "0" * 64
    with pytest.raises(ValueError, match="batchSha256"):
        generator.validate_output_bytes(
            batch_bytes,
            generator.canonical_json_bytes(tampered_manifest),
        )


def test_bounded_search_fails_clearly_when_a_quota_cannot_be_met(monkeypatch):
    monkeypatch.setattr(generator, "predict_difficulty", lambda _state, _margin: "easy")

    with pytest.raises(RuntimeError, match="could not satisfy difficulty quotas.*missing"):
        generator.generate_batch(
            master_seed=MASTER_SEED,
            batch_id=BATCH_ID,
            scenario_count=5,
            policy_margin_scorer=_fake_policy_margin,
            max_source_games=1,
        )


def test_cli_loads_the_model_once_and_writes_valid_outputs(tmp_path):
    seed_file = tmp_path / "master.seed"
    seed_file.write_bytes(MASTER_SEED)
    model_path = tmp_path / "pinned-model.pt"
    batch_path = tmp_path / "batch.json"
    manifest_path = tmp_path / "manifest.json"
    loads: list[Path] = []

    def fake_loader(path: Path):
        loads.append(path)
        return _fake_policy_margin, MODEL_SHA256

    generator.main(
        [
            "--master-seed-file",
            str(seed_file),
            "--batch-id",
            "cli-batch",
            "--scenario-count",
            "10",
            "--model-artifact",
            str(model_path),
            "--output-batch",
            str(batch_path),
            "--manifest",
            str(manifest_path),
            "--generator-commit",
            "test-provenance",
        ],
        scorer_loader=fake_loader,
    )

    written_batch, manifest = generator.validate_output_bytes(
        batch_path.read_bytes(),
        manifest_path.read_bytes(),
    )
    assert loads == [model_path]
    assert len(written_batch) == 10
    assert manifest["batchId"] == "cli-batch"
    assert manifest["modelSha256"] == MODEL_SHA256
    assert manifest["generatorCommit"] == "test-provenance"
