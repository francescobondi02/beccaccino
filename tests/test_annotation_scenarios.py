"""Focused contracts for deterministic V2 annotation batches."""

from __future__ import annotations

import copy
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

import pytest

from becca_env.deck import Suit
from becca_env.game import BeccaGame, GamePhase
from scripts import generate_annotation_scenarios as generator
from scripts.annotation_scenario_constants import (
    ANNOTATION_DIFFICULTIES,
    ANNOTATION_FAMILIES,
    ANNOTATION_IMPORTANCE_VALUES,
    ANNOTATION_TAGS,
    IMPORTANCE_USEFUL_UNCOMMON,
    MAX_SCENARIOS_PER_SOURCE_GAME,
)

MASTER_SEED = b"private-test-master-seed-material-v1"
BATCH_ID = "expert-2026-08"
SCENARIO_COUNT = 18
SOURCE_GAME_COUNT = 12
MODEL_SHA256 = "ab" * 32


def _fake_policy_scores(game: BeccaGame) -> list[float]:
    state_digest = hashlib.sha256(
        generator.canonical_json_bytes(generator.public_state(game))
    ).digest()
    return [
        int.from_bytes(
            hashlib.sha256(state_digest + index.to_bytes(2, "big")).digest()[:2],
            "big",
        )
        / 8192
        for index in range(len(game.legal_actions()))
    ]


@pytest.fixture(scope="module")
def generation() -> generator.GenerationResult:
    return generator.generate_batch_result(
        master_seed=MASTER_SEED,
        batch_id=BATCH_ID,
        scenario_count=SCENARIO_COUNT,
        policy_score_scorer=_fake_policy_scores,
        source_game_count=SOURCE_GAME_COUNT,
    )


@pytest.fixture(scope="module")
def batch(generation: generator.GenerationResult) -> list[dict]:
    return generation.scenarios


def _all_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value).union(*(_all_keys(child) for child in value.values()), set())
    if isinstance(value, list):
        return set().union(*(_all_keys(child) for child in value), set())
    return set()


def _scenario_family(scenario: dict) -> str:
    return scenario["tags"][0]


def test_v2_annotation_constants():
    assert ANNOTATION_DIFFICULTIES == ("easy", "medium", "hard")
    assert ANNOTATION_FAMILIES == ("borderline_briscola", "lead", "risk")
    assert ANNOTATION_IMPORTANCE_VALUES == (1, 2, 3)
    assert ANNOTATION_TAGS == ANNOTATION_FAMILIES


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (1, {"borderline_briscola": 1, "lead": 0, "risk": 0}),
        (2, {"borderline_briscola": 1, "lead": 1, "risk": 0}),
        (3, {"borderline_briscola": 1, "lead": 1, "risk": 1}),
        (4, {"borderline_briscola": 2, "lead": 1, "risk": 1}),
        (8, {"borderline_briscola": 3, "lead": 3, "risk": 2}),
    ],
)
def test_family_quotas_are_near_equal_for_arbitrary_counts(count, expected):
    assert generator.family_quotas(count) == expected


def test_hmac_game_seeds_are_deterministic_domain_separated_and_private():
    first = generator.derive_game_seed(MASTER_SEED, BATCH_ID, 0)

    assert first == generator.derive_game_seed(MASTER_SEED, BATCH_ID, 0)
    assert first != generator.derive_game_seed(MASTER_SEED, BATCH_ID, 1)
    assert first != generator.derive_game_seed(MASTER_SEED, "expert-2026-09", 0)
    assert first != generator.derive_game_seed(b"x" * 32, BATCH_ID, 0)
    assert str(MASTER_SEED) not in str(first)
    assert generator.seed_fingerprint(MASTER_SEED) != hashlib.sha256(MASTER_SEED).hexdigest()


def test_batch_contains_both_strict_state_shapes_and_hashes_state_only(batch):
    decision_types = Counter(item["decisionType"] for item in batch)
    assert (
        decision_types["choose_briscola"]
        == generator.family_quotas(SCENARIO_COUNT)["borderline_briscola"]
    )
    assert decision_types["play_card"] == SCENARIO_COUNT - decision_types["choose_briscola"]

    for item in batch:
        state = item["state"]
        expected_keys = (
            generator._BRISCOLA_STATE_KEYS
            if item["decisionType"] == "choose_briscola"
            else generator._PLAY_STATE_KEYS
        )
        assert set(state) == set(expected_keys)
        assert item["stateHash"] == generator._sha256(state)
        assert item["stateHash"] != generator._sha256(
            {"decisionType": item["decisionType"], "state": state}
        )


def test_generation_is_deterministic_and_family_balanced(generation):
    regenerated = generator.generate_batch_result(
        master_seed=MASTER_SEED,
        batch_id=BATCH_ID,
        scenario_count=SCENARIO_COUNT,
        policy_score_scorer=_fake_policy_scores,
        source_game_count=SOURCE_GAME_COUNT,
    )

    assert generator.canonical_json_bytes(regenerated.scenarios) == generator.canonical_json_bytes(
        generation.scenarios
    )
    assert regenerated.audit == generation.audit
    assert Counter(map(_scenario_family, generation.scenarios)) == Counter(
        generator.family_quotas(SCENARIO_COUNT)
    )
    assert [item["code"] for item in generation.scenarios] == [
        f"{BATCH_ID}-{ordinal:05d}" for ordinal in range(1, SCENARIO_COUNT + 1)
    ]


def test_collection_scans_every_configured_source_game(monkeypatch):
    original = generator.derive_game_seed
    visited: list[int] = []

    def tracking_seed(master_seed: bytes, batch_id: str, game_index: int) -> int:
        visited.append(game_index)
        return original(master_seed, batch_id, game_index)

    monkeypatch.setattr(generator, "derive_game_seed", tracking_seed)
    result = generator.generate_batch_result(
        master_seed=MASTER_SEED,
        batch_id="full-pool-test",
        scenario_count=9,
        policy_score_scorer=_fake_policy_scores,
        source_game_count=8,
    )

    assert visited == list(range(8))
    assert result.audit.source_games_scanned == 8
    assert result.audit.source_games_with_candidates == 8
    assert all(count > 9 for count in result.audit.candidate_pool_counts.values())


def test_selected_scenarios_respect_the_private_source_cap(generation):
    audit = generation.audit

    assert audit.max_selected_per_source_game <= MAX_SCENARIOS_PER_SOURCE_GAME
    assert audit.selected_source_games >= math.ceil(SCENARIO_COUNT / 2)


def _candidate(
    family: str,
    source: int,
    quality: float,
    discovery: int,
    signature: str,
) -> generator._Candidate:
    return generator._Candidate(
        scenario={"stateHash": f"{family}-{source}-{discovery}"},
        family=family,
        source_game_index=source,
        quality=quality,
        feature_signature=(signature,),
        discovery_index=discovery,
    )


def test_selection_preserves_capacity_for_later_families(monkeypatch):
    monkeypatch.setattr(generator, "validate_batch", lambda *args, **kwargs: None)
    candidates = [
        _candidate("borderline_briscola", 0, 1.0, 0, "b0"),
        _candidate("borderline_briscola", 1, 0.9, 1, "b1"),
        _candidate("lead", 0, 1.0, 2, "lead"),
        _candidate("risk", 0, 1.0, 3, "risk"),
    ]

    result = generator._select_candidates(
        candidates,
        batch_id="feasible-source-cap",
        scenario_count=3,
        source_games_scanned=2,
    )

    assert [item["stateHash"] for item in result.scenarios] == [
        "borderline_briscola-1-1",
        "lead-0-2",
        "risk-0-3",
    ]


def test_quality_uses_ambiguity_and_impact_and_diversity_changes_selection(
    monkeypatch,
):
    assert generator.candidate_quality(0.8, 0.2) > generator.candidate_quality(0.2, 0.2)
    assert generator.candidate_quality(0.2, 0.8) > generator.candidate_quality(0.2, 0.2)

    monkeypatch.setattr(generator, "validate_batch", lambda *args, **kwargs: None)
    candidates = [
        _candidate("borderline_briscola", 0, 1.0, 0, "repeated"),
        _candidate("borderline_briscola", 1, 0.99, 1, "repeated"),
        _candidate("borderline_briscola", 2, 0.9, 2, "different"),
        _candidate("lead", 3, 1.0, 3, "lead"),
        _candidate("risk", 4, 1.0, 4, "risk"),
    ]

    result = generator._select_candidates(
        candidates,
        batch_id="diverse-selection",
        scenario_count=4,
        source_games_scanned=5,
    )
    briscola_hashes = [
        item["stateHash"]
        for item in result.scenarios
        if item["stateHash"].startswith("borderline_briscola")
    ]
    assert briscola_hashes == [
        "borderline_briscola-0-0",
        "borderline_briscola-2-2",
    ]


def test_normalized_model_margin_and_briscola_ambiguity(batch):
    assert generator.normalized_top_two_margin([0.0, 0.0]) == 0.0
    assert 0.99 < generator.normalized_top_two_margin([100.0, 0.0]) <= 1.0

    state = next(item["state"] for item in batch if item["decisionType"] == "choose_briscola")
    closeness = generator.briscola_strength_closeness(state)
    low_model_margin = generator.decision_ambiguity(
        "choose_briscola",
        state,
        generator.ModelMargins(action=0.1),
    )
    high_model_margin = generator.decision_ambiguity(
        "choose_briscola",
        state,
        generator.ModelMargins(action=0.9),
    )

    assert 0.0 <= closeness <= 1.0
    assert low_model_margin == pytest.approx(0.5 * 0.9 + 0.5 * closeness)
    assert high_model_margin == pytest.approx(0.5 * 0.1 + 0.5 * closeness)
    assert low_model_margin > high_model_margin


def test_leader_card_and_signal_margins_are_separate():
    game = BeccaGame(seed=17, win_points=41)
    game.step(Suit.DENARA)
    assert game.phase == GamePhase.PLAY_CARD
    assert not game.round.current_trick

    actions = game.legal_actions()
    first_card = actions[0][0]
    card_dominant = [8.0 if card == first_card else 0.0 for card, _signal in actions]
    card_margins = generator.model_margins(game, card_dominant)
    assert card_margins.card > 0.9
    assert card_margins.signal == pytest.approx(0.0)

    signal_dominant = [8.0 if signal is None else 0.0 for _card, signal in actions]
    signal_margins = generator.model_margins(game, signal_dominant)
    assert signal_margins.card == pytest.approx(0.0)
    assert signal_margins.signal > 0.9


def test_each_scenario_exposes_only_its_public_state_family(batch):
    briscola_items = [item for item in batch if item["decisionType"] == "choose_briscola"]
    lead_items = [item for item in batch if item["tags"] == ["lead"]]
    risk_items = [item for item in batch if item["tags"] == ["risk"]]

    assert all(
        item["tags"] == ["borderline_briscola"]
        and generator.briscola_strength_closeness(item["state"])
        >= generator.BRISCOLA_CLOSE_THRESHOLD
        for item in briscola_items
    )
    assert all(not item["state"]["currentTrick"]["plays"] for item in lead_items)
    assert all(any(generator.risk_tradeoffs(item["state"]).values()) for item in risk_items)
    assert len(risk_items) == generator.family_quotas(SCENARIO_COUNT)["risk"]


def test_strategic_impact_is_explicitly_public_and_high_for_briscola(batch):
    briscola = next(item for item in batch if item["decisionType"] == "choose_briscola")
    lead = next(item for item in batch if item["tags"] == ["lead"])
    risk = next(item for item in batch if item["tags"] == ["risk"])

    assert generator.strategic_impact("choose_briscola", briscola["state"]) >= 0.85
    assert 0.0 <= generator.strategic_impact("play_card", lead["state"]) <= 1.0
    assert 0.0 <= generator.strategic_impact("play_card", risk["state"]) <= 1.0


def test_batch_exposes_no_private_selection_or_model_fields(batch):
    forbidden = {
        "seed",
        "dealSeed",
        "masterSeed",
        "playerHands",
        "hiddenHands",
        "modelScores",
        "policyMargin",
        "modelMargin",
        "cardMargin",
        "signalMargin",
        "suitScores",
        "sourceGameId",
        "sourceGameIndex",
        "selectionScore",
        "strategicImpact",
        "ambiguity",
        "quality",
        "family",
        "diversitySignature",
        "selectionMetrics",
        "logits",
        "hiddenState",
    }

    assert all(set(item) == generator._SCENARIO_KEYS for item in batch)
    assert not forbidden.intersection(_all_keys(batch))
    assert MASTER_SEED not in generator.canonical_json_bytes(batch)


def test_selected_v1_scenarios_have_equal_useful_importance(batch):
    assert {item["importance"] for item in batch} == {IMPORTANCE_USEFUL_UNCOMMON}


def test_validation_rejects_state_tag_decision_and_private_field_tampering(batch):
    bad_state = copy.deepcopy(batch)
    bad_state[0]["state"]["totalScores"]["0"] += 1
    with pytest.raises(ValueError, match="stateHash"):
        generator.validate_batch(
            bad_state,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    bad_tags = copy.deepcopy(batch)
    bad_tags[0]["tags"] = ["lead"]
    with pytest.raises(ValueError, match="public-state family"):
        generator.validate_batch(
            bad_tags,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    bad_decision = copy.deepcopy(batch)
    bad_decision[0]["decisionType"] = "play_card"
    with pytest.raises(ValueError, match="play_card state"):
        generator.validate_batch(
            bad_decision,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )

    private_field = copy.deepcopy(batch)
    private_field[0]["selectionMetrics"] = {"quality": 1.0}
    with pytest.raises(ValueError, match="forbidden fields"):
        generator.validate_batch(
            private_field,
            batch_id=BATCH_ID,
            expected_count=SCENARIO_COUNT,
        )


def test_manifest_has_family_and_source_coverage_without_source_ids(
    tmp_path,
    generation,
):
    batch_path = tmp_path / "nested" / "scenarios.json"
    manifest_path = tmp_path / "nested" / "manifest.json"
    manifest = generator.write_batch_outputs(
        batch=generation.scenarios,
        batch_id=BATCH_ID,
        master_seed=MASTER_SEED,
        generator_commit="ai@852313d",
        model_sha256=MODEL_SHA256,
        output_batch_path=batch_path,
        manifest_path=manifest_path,
        audit=generation.audit,
    )
    batch_bytes = batch_path.read_bytes()
    manifest_bytes = manifest_path.read_bytes()

    assert batch_bytes == generator.canonical_json_bytes(generation.scenarios)
    assert manifest["batchSha256"] == hashlib.sha256(batch_bytes).hexdigest()
    assert manifest["parameters"]["familyQuotas"] == generator.family_quotas(SCENARIO_COUNT)
    assert manifest["counts"]["family"] == generator.family_quotas(SCENARIO_COUNT)
    assert "tag" not in manifest["counts"]
    assert manifest["counts"]["sourceGameCoverage"]["scanned"] == SOURCE_GAME_COUNT
    assert "sourceGameIds" not in _all_keys(manifest)
    assert MASTER_SEED not in batch_bytes
    assert MASTER_SEED not in manifest_bytes
    generator.validate_output_bytes(batch_bytes, manifest_bytes)

    tampered_manifest = copy.deepcopy(json.loads(manifest_bytes))
    tampered_manifest["counts"]["sourceGameCoverage"]["maxSelectedPerGame"] = 3
    with pytest.raises(ValueError, match="source-game coverage"):
        generator.validate_output_bytes(
            batch_bytes,
            generator.canonical_json_bytes(tampered_manifest),
        )


def test_bounded_search_fails_clearly_when_source_cap_blocks_quotas():
    with pytest.raises(RuntimeError, match="family quotas.*2/source cap"):
        generator.generate_batch_result(
            master_seed=MASTER_SEED,
            batch_id=BATCH_ID,
            scenario_count=5,
            policy_score_scorer=_fake_policy_scores,
            source_game_count=1,
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
        return _fake_policy_scores, MODEL_SHA256

    generator.main(
        [
            "--master-seed-file",
            str(seed_file),
            "--batch-id",
            "cli-batch",
            "--scenario-count",
            "9",
            "--source-game-count",
            "8",
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
    assert len(written_batch) == 9
    assert manifest["batchId"] == "cli-batch"
    assert manifest["modelSha256"] == MODEL_SHA256
    assert manifest["generatorCommit"] == "test-provenance"
    assert manifest["counts"]["sourceGameCoverage"]["scanned"] == 8
