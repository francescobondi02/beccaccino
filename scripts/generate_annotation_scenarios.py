"""Generate deterministic offline batches of expert-annotation scenarios."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import tempfile
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from becca_env.deck import Card, Suit, Value, card_points
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase, Signal
from becca_env.observation import CARD_INDEX
from becca_env.rules import determine_hand_winner, follow_suit_filter
from evaluation.heuristic import HeuristicAgent
from scripts.annotation_scenario_constants import (
    ANNOTATION_DIFFICULTIES,
    ANNOTATION_IMPORTANCE_VALUES,
    ANNOTATION_TAGS,
    IMPORTANCE_CURATED_CORNER_CASE,
    IMPORTANCE_STANDARD,
    IMPORTANCE_USEFUL_UNCOMMON,
    METHOD_VERSION,
    MIN_CURATED_CORNER_SHARE,
    RULES_VERSION,
    TARGET_DIFFICULTY_MIX,
)

DEFAULT_MODEL_ARTIFACT = Path("serving/models/run_d2_champion.pt")
WIN_POINTS = 41
SCORE_PRESSURE_RAW = (WIN_POINTS - 10) * 3
MAX_SOURCE_GAMES = 10_000
MAX_DECISIONS_PER_GAME = 600
MIN_MASTER_SEED_BYTES = 32

PolicyMarginScorer = Callable[[BeccaGame], float]

_SIGNALS = (None, Signal.STRISCIO, Signal.BUSSO, Signal.VOLO)
_BATCH_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,72}$")
_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_SCENARIO_KEYS = {
    "code",
    "predictedDifficulty",
    "importance",
    "tags",
    "stateHash",
    "state",
}
_STATE_KEYS = (
    "targetPoints",
    "roundNumber",
    "actingSeat",
    "callerSeat",
    "trickStarter",
    "briscola",
    "totalScores",
    "hand",
    "completedTricks",
    "currentTrick",
    "legalActions",
)
_MANIFEST_KEYS = {
    "batchId",
    "seedFingerprint",
    "generatorCommit",
    "modelSha256",
    "rulesVersion",
    "methodVersion",
    "parameters",
    "counts",
    "batchSha256",
}
_FORBIDDEN_KEYS = {
    "seed",
    "dealSeed",
    "masterSeed",
    "hiddenHands",
    "opponentHands",
    "otherHands",
    "playerHands",
    "player_hands",
    "modelScores",
    "policyMargin",
    "logits",
    "hiddenState",
}
_CORNER_CASE_COMBINATIONS = (
    frozenset({"void", "partner_winning", "high_value_trick"}),
    frozenset({"must_follow", "partner_winning", "high_value_trick", "score_pressure"}),
    frozenset({"lead", "signal_decision", "late_round", "score_pressure"}),
)
_USEFUL_UNCOMMON_COMBINATIONS = (
    frozenset({"score_pressure"}),
    frozenset({"late_round", "high_value_trick"}),
    frozenset({"void", "high_value_trick"}),
    frozenset({"partner_winning", "high_value_trick"}),
    frozenset({"signal_decision", "late_round"}),
)


def canonical_json_bytes(value: object) -> bytes:
    """Serialize JSON canonically, including one terminating newline."""
    return (
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode()


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode()).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_master_seed(master_seed: bytes) -> None:
    if len(master_seed) < MIN_MASTER_SEED_BYTES:
        raise ValueError(f"master seed must contain at least {MIN_MASTER_SEED_BYTES} bytes")


def _require_batch_id(batch_id: str) -> None:
    if not _BATCH_ID_PATTERN.fullmatch(batch_id):
        raise ValueError(
            "batch ID must be 1-73 lowercase letters, digits, or hyphens "
            "and must start with a letter or digit"
        )


def derive_game_seed(master_seed: bytes, batch_id: str, game_index: int) -> int:
    """Derive one private deterministic game seed with domain-separated HMAC."""
    _require_master_seed(master_seed)
    _require_batch_id(batch_id)
    if not isinstance(game_index, int) or game_index < 0:
        raise ValueError("game index must be a non-negative integer")

    encoded_batch_id = batch_id.encode("ascii")
    message = (
        b"becca-annotation-game-seed:v1\0"
        + len(encoded_batch_id).to_bytes(2, "big")
        + encoded_batch_id
        + game_index.to_bytes(8, "big")
    )
    digest = hmac.new(master_seed, message, hashlib.sha256).digest()
    return int.from_bytes(digest, "big")


def seed_fingerprint(master_seed: bytes) -> str:
    """Return a non-secret identifier for a retained private master seed."""
    _require_master_seed(master_seed)
    return hmac.new(
        master_seed,
        b"becca-annotation-seed-fingerprint:v1",
        hashlib.sha256,
    ).hexdigest()


def difficulty_quotas(scenario_count: int) -> dict[str, int]:
    """Allocate the fixed mix with deterministic largest-remainder rounding."""
    if not isinstance(scenario_count, int) or scenario_count <= 0:
        raise ValueError("scenario count must be a positive integer")

    raw = {
        difficulty: scenario_count * TARGET_DIFFICULTY_MIX[difficulty]
        for difficulty in ANNOTATION_DIFFICULTIES
    }
    quotas = {difficulty: math.floor(count) for difficulty, count in raw.items()}
    remaining = scenario_count - sum(quotas.values())
    tie_order = {"medium": 0, "hard": 1, "easy": 2}
    ranked = sorted(
        ANNOTATION_DIFFICULTIES,
        key=lambda difficulty: (-(raw[difficulty] - quotas[difficulty]), tie_order[difficulty]),
    )
    for difficulty in ranked[:remaining]:
        quotas[difficulty] += 1
    return quotas


def minimum_curated_corner_count(scenario_count: int) -> int:
    if not isinstance(scenario_count, int) or scenario_count <= 0:
        raise ValueError("scenario count must be a positive integer")
    return max(1, math.ceil(scenario_count * MIN_CURATED_CORNER_SHARE))


def _card_payload(card: Card) -> dict[str, str]:
    return {"suit": card.suit.value, "value": card.value.value}


def _play_payload(position: int, seat: int, card: Card) -> dict:
    return {
        "position": position,
        "seat": seat,
        "suit": card.suit.value,
        "value": card.value.value,
    }


def _action_payload(card: Card, signal: Signal | None) -> dict:
    return {
        "suit": card.suit.value,
        "value": card.value.value,
        "signal": None if signal is None else signal.value,
    }


def _action_sort_key(action: dict) -> tuple[int, int]:
    card = Card(Suit(action["suit"]), Value(action["value"]))
    signal = None if action["signal"] is None else Signal(action["signal"])
    signal_index = 0 if signal is None else list(Signal).index(signal) + 1
    return CARD_INDEX[card], signal_index


def _legal_action_payloads(game: BeccaGame) -> list[dict]:
    actions = []
    for action in game.legal_actions():
        if isinstance(action, Card):
            card, signal = action, None
        else:
            card, signal = action
        actions.append(_action_payload(card, signal))
    return sorted(actions, key=_action_sort_key)


def distinct_legal_card_count(legal_actions: Sequence[Mapping[str, object]]) -> int:
    """Count card decisions, collapsing a leader's signal variants."""
    return len({(action["suit"], action["value"]) for action in legal_actions})


def _signal_fields(signal: Signal | None, starter_seat: int) -> dict:
    return {
        "signal": None if signal is None else signal.value,
        "signalSeat": None if signal is None else starter_seat,
    }


def public_state(game: BeccaGame) -> dict:
    """Serialize the complete public state for the acting player."""
    if game.win_points != WIN_POINTS or game.phase != GamePhase.PLAY_CARD:
        raise ValueError("annotation scenarios must be live BeccaGame(win_points=41) plays")

    round_state = game.round
    completed_tricks = []
    for number, trick in enumerate(round_state.hands_played, start=1):
        starter_seat = trick.cards[0][0]
        completed_tricks.append(
            {
                "number": number,
                "starterSeat": starter_seat,
                "winnerSeat": trick.winner,
                **_signal_fields(trick.signal, starter_seat),
                "plays": [
                    _play_payload(position, seat, card)
                    for position, (seat, card) in enumerate(trick.cards)
                ],
            }
        )

    current_signal = round_state.trick_signals[0][1] if round_state.trick_signals else None
    current_trick = {
        "number": len(round_state.hands_played) + 1,
        "starterSeat": round_state.trick_starter,
        **_signal_fields(current_signal, round_state.trick_starter),
        "plays": [
            _play_payload(position, seat, card)
            for position, (seat, card) in enumerate(round_state.current_trick)
        ],
    }

    return {
        "targetPoints": game.win_points,
        "roundNumber": round_state.number,
        "actingSeat": game.current_seat,
        "callerSeat": round_state.caller_seat,
        "trickStarter": round_state.trick_starter,
        "briscola": round_state.briscola.value,
        "totalScores": {
            "0": game.total_scores[0],
            "1": game.total_scores[1],
        },
        "hand": [
            _card_payload(card)
            for card in sorted(game.get_hand(game.current_seat), key=CARD_INDEX.__getitem__)
        ],
        "completedTricks": completed_tricks,
        "currentTrick": current_trick,
        "legalActions": _legal_action_payloads(game),
    }


def _parse_card(value: Mapping[str, object]) -> Card:
    if set(value) != {"suit", "value"}:
        raise ValueError("card must contain only suit and value")
    try:
        return Card(Suit(value["suit"]), Value(value["value"]))
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid card: {value}") from error


def _parse_play(value: Mapping[str, object], expected_position: int) -> tuple[int, Card]:
    if set(value) != {"position", "seat", "suit", "value"}:
        raise ValueError("play must contain position, seat, suit, and value")
    if value["position"] != expected_position:
        raise ValueError("trick plays must be ordered by zero-based position")
    seat = value["seat"]
    if not isinstance(seat, int) or seat not in range(4):
        raise ValueError(f"invalid play seat: {seat}")
    return seat, _parse_card({"suit": value["suit"], "value": value["value"]})


def _parse_signal_fields(trick: Mapping[str, object]) -> Signal | None:
    try:
        signal = None if trick["signal"] is None else Signal(trick["signal"])
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid signal: {trick['signal']}") from error
    expected_seat = None if signal is None else trick["starterSeat"]
    if trick["signalSeat"] != expected_seat:
        raise ValueError("signalSeat must identify the signalling trick leader")
    return signal


def _expected_actions(hand: list[Card], current_trick: list[tuple[int, Card]]) -> list[dict]:
    if not current_trick:
        return [
            _action_payload(card, signal)
            for card in sorted(hand, key=CARD_INDEX.__getitem__)
            for signal in _SIGNALS
        ]
    playable = follow_suit_filter(hand, current_trick[0][1].suit)
    return [_action_payload(card, None) for card in sorted(playable, key=CARD_INDEX.__getitem__)]


def classify_tags(state: Mapping[str, object]) -> list[str]:
    """Apply objective, public-state-only tag predicates in fixed order."""
    hand = [_parse_card(card) for card in state["hand"]]
    current = state["currentTrick"]
    current_trick = [_parse_play(play, index) for index, play in enumerate(current["plays"])]
    briscola = Suit(state["briscola"])
    acting_seat = state["actingSeat"]
    scores = state["totalScores"]

    matched: set[str] = set()
    if not current_trick:
        matched.add("lead")
        if any(action["signal"] is not None for action in state["legalActions"]):
            matched.add("signal_decision")
    else:
        lead_suit = current_trick[0][1].suit
        matched.add("must_follow" if any(card.suit == lead_suit for card in hand) else "void")
        winner = determine_hand_winner(current_trick, briscola)
        if TEAM_OF_SEAT[winner] == TEAM_OF_SEAT[acting_seat]:
            matched.add("partner_winning")
        if sum(card_points[card.value] for _, card in current_trick) >= 3:
            matched.add("high_value_trick")

    if len(state["completedTricks"]) >= 7:
        matched.add("late_round")
    if max(scores.values()) >= SCORE_PRESSURE_RAW:
        matched.add("score_pressure")
    return [tag for tag in ANNOTATION_TAGS if tag in matched]


def classify_importance(tags: Sequence[str]) -> int:
    """Map explicit objective rule combinations to the three importance levels."""
    tag_set = frozenset(tags)
    if any(combination <= tag_set for combination in _CORNER_CASE_COMBINATIONS):
        return IMPORTANCE_CURATED_CORNER_CASE
    if any(combination <= tag_set for combination in _USEFUL_UNCOMMON_COMBINATIONS):
        return IMPORTANCE_USEFUL_UNCOMMON
    return IMPORTANCE_STANDARD


def structural_complexity(state: Mapping[str, object]) -> float:
    """Return normalized complexity without consulting tags or model outputs."""
    legal_card_count = distinct_legal_card_count(state["legalActions"])
    current_trick_size = len(state["currentTrick"]["plays"])
    completed_count = len(state["completedTricks"])
    declared_signals = sum(trick["signal"] is not None for trick in state["completedTricks"]) + int(
        state["currentTrick"]["signal"] is not None
    )
    round_depth = min((state["roundNumber"] - 1) / 2, 1.0)

    return (
        0.35 * ((legal_card_count - 2) / 8)
        + 0.20 * (current_trick_size / 3)
        + 0.25 * (completed_count / 9)
        + 0.10 * min(declared_signals / 3, 1.0)
        + 0.10 * round_depth
    )


def predict_difficulty(state: Mapping[str, object], legal_action_margin: float) -> str:
    """Predict difficulty from structure and the model's legal-logit margin."""
    if not math.isfinite(legal_action_margin) or legal_action_margin < 0:
        raise ValueError("policy margin must be a finite non-negative number")

    stable_margin = round(legal_action_margin, 6)
    confidence = min(math.log1p(stable_margin) / math.log(11), 1.0)
    difficulty_score = 0.65 * structural_complexity(state) + 0.35 * (1.0 - confidence)
    if difficulty_score < 0.33:
        return "easy"
    if difficulty_score < 0.62:
        return "medium"
    return "hard"


def load_policy_margin_scorer(model_artifact: Path) -> tuple[PolicyMarginScorer, str]:
    """Load the pinned inference artifact once and return its legal-logit scorer."""
    import torch

    from becca_env.observation import encode_action_mask, encode_observation
    from serving.artifact import load_inference_artifact
    from training.checkpoint import build_net

    model_sha256 = _file_sha256(model_artifact)
    artifact = load_inference_artifact(model_artifact)
    net = build_net(artifact, torch.device("cpu"))
    net.eval()

    def score(game: BeccaGame) -> float:
        observation = encode_observation(game, game.current_seat, obs_size=net.obs_size)
        action_mask = encode_action_mask(game, game.current_seat)
        observation_tensor = torch.from_numpy(observation).unsqueeze(0)
        mask_tensor = torch.from_numpy(action_mask).unsqueeze(0)
        with torch.inference_mode():
            logits, _ = net(observation_tensor, mask_tensor)
        legal_logits = logits[0][mask_tensor[0].bool()]
        if legal_logits.numel() < 2:
            raise ValueError("policy margin requires at least two legal actions")
        top_two = torch.topk(legal_logits, 2).values
        return float(top_two[0] - top_two[1])

    return score, model_sha256


def _scenario_code(batch_id: str, ordinal: int) -> str:
    return f"{batch_id}-{ordinal:05d}"


def _candidate_scenario(
    game: BeccaGame,
    policy_margin_scorer: PolicyMarginScorer,
) -> dict | None:
    state = public_state(game)
    if distinct_legal_card_count(state["legalActions"]) <= 1:
        return None
    state_hash = _sha256(state)
    tags = classify_tags(state)
    return {
        "predictedDifficulty": predict_difficulty(state, policy_margin_scorer(game)),
        "importance": classify_importance(tags),
        "tags": tags,
        "stateHash": state_hash,
        "state": state,
    }


def generate_batch(
    *,
    master_seed: bytes,
    batch_id: str,
    scenario_count: int,
    policy_margin_scorer: PolicyMarginScorer,
    max_source_games: int = MAX_SOURCE_GAMES,
) -> list[dict]:
    """Generate a deterministic batch with exact target difficulty counts."""
    _require_master_seed(master_seed)
    _require_batch_id(batch_id)
    quotas = difficulty_quotas(scenario_count)
    if not isinstance(max_source_games, int) or max_source_games <= 0:
        raise ValueError("max source games must be a positive integer")

    selected: list[dict] = []
    selected_counts = Counter()
    seen_hashes: set[str] = set()

    for game_index in range(max_source_games):
        game_seed = derive_game_seed(master_seed, batch_id, game_index)
        game = BeccaGame(seed=game_seed, win_points=WIN_POINTS)
        agent = HeuristicAgent(seed=game_seed, declare_signals=True)

        for _ in range(MAX_DECISIONS_PER_GAME):
            if game.phase == GamePhase.GAME_OVER:
                break
            if game.phase == GamePhase.CHOOSE_BRISCOLA:
                game.step(agent.select_action(game, game.current_seat))
                continue

            candidate = _candidate_scenario(game, policy_margin_scorer)
            if candidate is not None and candidate["stateHash"] not in seen_hashes:
                difficulty = candidate["predictedDifficulty"]
                if selected_counts[difficulty] < quotas[difficulty]:
                    selected.append(candidate)
                    selected_counts[difficulty] += 1
                    seen_hashes.add(candidate["stateHash"])
                else:
                    replaceable = [
                        (index, item)
                        for index, item in enumerate(selected)
                        if item["predictedDifficulty"] == difficulty
                        and item["importance"] < candidate["importance"]
                    ]
                    if replaceable:
                        replace_index, replaced = min(
                            replaceable,
                            key=lambda pair: (pair[1]["importance"], -pair[0]),
                        )
                        seen_hashes.remove(replaced["stateHash"])
                        selected[replace_index] = candidate
                        seen_hashes.add(candidate["stateHash"])

                corner_count = sum(
                    item["importance"] == IMPORTANCE_CURATED_CORNER_CASE for item in selected
                )
                if len(selected) == scenario_count and corner_count >= minimum_curated_corner_count(
                    scenario_count
                ):
                    batch = [
                        {"code": _scenario_code(batch_id, ordinal), **item}
                        for ordinal, item in enumerate(selected, start=1)
                    ]
                    validate_batch(batch, batch_id=batch_id, expected_count=scenario_count)
                    return batch

            game.step(agent.select_action(game, game.current_seat))
        else:
            raise RuntimeError(
                f"source game {game_index} exceeded {MAX_DECISIONS_PER_GAME} decisions"
            )

    missing = {
        difficulty: quotas[difficulty] - selected_counts[difficulty]
        for difficulty in ANNOTATION_DIFFICULTIES
        if selected_counts[difficulty] < quotas[difficulty]
    }
    raise RuntimeError(
        f"could not satisfy difficulty quotas after {max_source_games} source games; "
        f"missing {missing}, curated corners "
        f"{sum(item['importance'] == IMPORTANCE_CURATED_CORNER_CASE for item in selected)}"
        f"/{minimum_curated_corner_count(scenario_count)}"
    )


def _reject_hidden_fields(value: object) -> None:
    if isinstance(value, dict):
        forbidden = _FORBIDDEN_KEYS.intersection(value)
        if forbidden:
            raise ValueError(f"batch exposes forbidden fields: {sorted(forbidden)}")
        for child in value.values():
            _reject_hidden_fields(child)
    elif isinstance(value, list):
        for child in value:
            _reject_hidden_fields(child)


def _validate_state(state: Mapping[str, object]) -> None:
    if set(state) != set(_STATE_KEYS):
        raise ValueError("scenario state has unexpected or missing fields")
    if state["targetPoints"] != WIN_POINTS:
        raise ValueError("scenario must use BeccaGame(win_points=41)")
    if not isinstance(state["roundNumber"], int) or state["roundNumber"] < 1:
        raise ValueError("roundNumber must be a positive integer")
    for key in ("actingSeat", "callerSeat", "trickStarter"):
        if not isinstance(state[key], int) or state[key] not in range(4):
            raise ValueError(f"{key} must be a seat")
    try:
        briscola = Suit(state["briscola"])
    except (TypeError, ValueError) as error:
        raise ValueError("invalid briscola") from error

    scores = state["totalScores"]
    if set(scores) != {"0", "1"} or any(
        not isinstance(score, int) or score < 0 for score in scores.values()
    ):
        raise ValueError("totalScores must contain non-negative cumulative raw scores")

    completed = state["completedTricks"]
    if not isinstance(completed, list) or len(completed) > 9:
        raise ValueError("completedTricks must contain zero to nine tricks")
    expected_starter = state["callerSeat"]
    seen_cards: set[Card] = set()
    for number, trick in enumerate(completed, start=1):
        if set(trick) != {
            "number",
            "starterSeat",
            "winnerSeat",
            "signal",
            "signalSeat",
            "plays",
        }:
            raise ValueError("completed trick has unexpected or missing fields")
        if trick["number"] != number or trick["starterSeat"] != expected_starter:
            raise ValueError("completed trick history is not chronologically ordered")
        _parse_signal_fields(trick)
        plays = [_parse_play(play, index) for index, play in enumerate(trick["plays"])]
        if len(plays) != 4:
            raise ValueError("completed trick must contain four plays")
        for position, (seat, card) in enumerate(plays):
            if seat != (expected_starter + position) % 4:
                raise ValueError("completed trick seats are out of order")
            if card in seen_cards:
                raise ValueError("card appears more than once")
            seen_cards.add(card)
        winner = determine_hand_winner(plays, briscola)
        if trick["winnerSeat"] != winner:
            raise ValueError("completed trick winner is invalid")
        expected_starter = winner

    current = state["currentTrick"]
    if set(current) != {"number", "starterSeat", "signal", "signalSeat", "plays"}:
        raise ValueError("current trick has unexpected or missing fields")
    if current["number"] != len(completed) + 1:
        raise ValueError("current trick does not follow completed history")
    if current["starterSeat"] != expected_starter or state["trickStarter"] != expected_starter:
        raise ValueError("current trick starter does not follow completed history")
    _parse_signal_fields(current)

    current_plays = [_parse_play(play, index) for index, play in enumerate(current["plays"])]
    if len(current_plays) > 3:
        raise ValueError("current trick must contain zero to three plays")
    for position, (seat, card) in enumerate(current_plays):
        if seat != (expected_starter + position) % 4:
            raise ValueError("current trick seats are out of order")
        if card in seen_cards:
            raise ValueError("card appears more than once")
        seen_cards.add(card)
    if state["actingSeat"] != (expected_starter + len(current_plays)) % 4:
        raise ValueError("actingSeat does not follow current trick")

    hand = [_parse_card(card) for card in state["hand"]]
    if hand != sorted(hand, key=CARD_INDEX.__getitem__):
        raise ValueError("hand must use canonical card order")
    if len(hand) != 10 - len(completed):
        raise ValueError("hand size does not match completed history")
    for card in hand:
        if card in seen_cards:
            raise ValueError("hand contains an already played card")
        seen_cards.add(card)

    expected_actions = _expected_actions(hand, current_plays)
    if state["legalActions"] != expected_actions:
        raise ValueError("flat legal actions do not match the public state")
    if distinct_legal_card_count(expected_actions) <= 1:
        raise ValueError("scenario must offer more than one legal card decision")


def validate_batch(
    batch: object,
    *,
    batch_id: str,
    expected_count: int,
) -> None:
    """Validate shape, privacy, rules, tags, importance, quotas, and hashes."""
    _require_batch_id(batch_id)
    if not isinstance(batch, list) or len(batch) != expected_count:
        raise ValueError(f"batch must contain exactly {expected_count} scenarios")
    _reject_hidden_fields(batch)

    codes: set[str] = set()
    state_hashes: set[str] = set()
    for ordinal, scenario in enumerate(batch, start=1):
        if not isinstance(scenario, dict) or set(scenario) != _SCENARIO_KEYS:
            raise ValueError("scenario has unexpected or missing fields")
        expected_code = _scenario_code(batch_id, ordinal)
        if scenario["code"] != expected_code or scenario["code"] in codes:
            raise ValueError("scenario code is invalid or duplicated")
        if scenario["predictedDifficulty"] not in ANNOTATION_DIFFICULTIES:
            raise ValueError("predicted difficulty is invalid")
        if scenario["importance"] not in ANNOTATION_IMPORTANCE_VALUES:
            raise ValueError("importance is invalid")
        if (
            not isinstance(scenario["tags"], list)
            or not scenario["tags"]
            or len(scenario["tags"]) != len(set(scenario["tags"]))
            or any(tag not in ANNOTATION_TAGS for tag in scenario["tags"])
        ):
            raise ValueError("tags must be unique fixed annotation tags")
        _validate_state(scenario["state"])
        expected_tags = classify_tags(scenario["state"])
        if scenario["tags"] != expected_tags:
            raise ValueError("scenario tags do not match objective predicates")
        if scenario["importance"] != classify_importance(expected_tags):
            raise ValueError("scenario importance does not match objective rule combinations")
        if scenario["stateHash"] != _sha256(scenario["state"]):
            raise ValueError("scenario stateHash is invalid")
        if scenario["stateHash"] in state_hashes:
            raise ValueError("scenario stateHash is duplicated")
        codes.add(scenario["code"])
        state_hashes.add(scenario["stateHash"])

    counts = Counter(scenario["predictedDifficulty"] for scenario in batch)
    if counts != Counter(difficulty_quotas(expected_count)):
        raise ValueError("batch does not satisfy exact difficulty quotas")
    corner_count = sum(
        scenario["importance"] == IMPORTANCE_CURATED_CORNER_CASE for scenario in batch
    )
    if corner_count < minimum_curated_corner_count(expected_count):
        raise ValueError("batch does not satisfy the curated corner-case floor")


def _batch_counts(batch: list[dict]) -> dict:
    difficulty_counts = Counter(scenario["predictedDifficulty"] for scenario in batch)
    importance_counts = Counter(str(scenario["importance"]) for scenario in batch)
    tag_counts = Counter(tag for scenario in batch for tag in scenario["tags"])
    return {
        "difficulty": {
            difficulty: difficulty_counts[difficulty] for difficulty in ANNOTATION_DIFFICULTIES
        },
        "importance": {
            str(importance): importance_counts[str(importance)]
            for importance in ANNOTATION_IMPORTANCE_VALUES
        },
        "tag": {tag: tag_counts[tag] for tag in ANNOTATION_TAGS},
    }


def build_manifest(
    *,
    batch: list[dict],
    batch_bytes: bytes,
    batch_id: str,
    master_seed: bytes,
    generator_commit: str,
    model_sha256: str,
    max_source_games: int = MAX_SOURCE_GAMES,
) -> dict:
    """Build provenance for exact batch bytes without exposing the master seed."""
    if not generator_commit.strip():
        raise ValueError("generator commit/provenance must be non-empty")
    if not _SHA256_PATTERN.fullmatch(model_sha256):
        raise ValueError("model SHA-256 is invalid")
    scenario_count = len(batch)
    return {
        "batchId": batch_id,
        "seedFingerprint": seed_fingerprint(master_seed),
        "generatorCommit": generator_commit,
        "modelSha256": model_sha256,
        "rulesVersion": RULES_VERSION,
        "methodVersion": METHOD_VERSION,
        "parameters": {
            "scenarioCount": scenario_count,
            "difficultyMix": dict(TARGET_DIFFICULTY_MIX),
            "difficultyQuotas": difficulty_quotas(scenario_count),
            "minimumCuratedCorners": minimum_curated_corner_count(scenario_count),
            "maxSourceGames": max_source_games,
        },
        "counts": _batch_counts(batch),
        "batchSha256": hashlib.sha256(batch_bytes).hexdigest(),
    }


def validate_manifest(manifest: object, batch: list[dict], batch_bytes: bytes) -> None:
    """Validate manifest provenance, aggregate counts, and the exact batch hash."""
    if not isinstance(manifest, dict) or set(manifest) != _MANIFEST_KEYS:
        raise ValueError("manifest has unexpected or missing fields")
    if not isinstance(manifest["batchId"], str):
        raise ValueError("manifest batchId is invalid")
    _require_batch_id(manifest["batchId"])
    for key in ("seedFingerprint", "modelSha256", "batchSha256"):
        if not isinstance(manifest[key], str) or not _SHA256_PATTERN.fullmatch(manifest[key]):
            raise ValueError(f"manifest {key} is invalid")
    if not isinstance(manifest["generatorCommit"], str) or not manifest["generatorCommit"].strip():
        raise ValueError("manifest generatorCommit is invalid")
    if manifest["rulesVersion"] != RULES_VERSION or manifest["methodVersion"] != METHOD_VERSION:
        raise ValueError("manifest rules or method version is invalid")

    parameters = manifest["parameters"]
    expected_parameters = {
        "scenarioCount": len(batch),
        "difficultyMix": dict(TARGET_DIFFICULTY_MIX),
        "difficultyQuotas": difficulty_quotas(len(batch)),
        "minimumCuratedCorners": minimum_curated_corner_count(len(batch)),
        "maxSourceGames": (
            parameters.get("maxSourceGames") if isinstance(parameters, dict) else None
        ),
    }
    if (
        not isinstance(parameters, dict)
        or set(parameters) != set(expected_parameters)
        or not isinstance(parameters["maxSourceGames"], int)
        or parameters["maxSourceGames"] <= 0
        or parameters != expected_parameters
    ):
        raise ValueError("manifest parameters are invalid")

    validate_batch(
        batch,
        batch_id=manifest["batchId"],
        expected_count=parameters["scenarioCount"],
    )
    if manifest["counts"] != _batch_counts(batch):
        raise ValueError("manifest counts do not match the batch")
    if manifest["batchSha256"] != hashlib.sha256(batch_bytes).hexdigest():
        raise ValueError("manifest batchSha256 does not match the exact batch bytes")


def validate_output_bytes(batch_bytes: bytes, manifest_bytes: bytes) -> tuple[list[dict], dict]:
    """Parse and validate canonical serialized output artifacts."""
    try:
        batch = json.loads(batch_bytes)
        manifest = json.loads(manifest_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("batch and manifest must be valid UTF-8 JSON") from error
    if canonical_json_bytes(batch) != batch_bytes:
        raise ValueError("batch is not canonical JSON")
    if canonical_json_bytes(manifest) != manifest_bytes:
        raise ValueError("manifest is not canonical JSON")
    validate_manifest(manifest, batch, batch_bytes)
    return batch, manifest


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def write_batch_outputs(
    *,
    batch: list[dict],
    batch_id: str,
    master_seed: bytes,
    generator_commit: str,
    model_sha256: str,
    output_batch_path: Path,
    manifest_path: Path,
    max_source_games: int = MAX_SOURCE_GAMES,
) -> dict:
    """Validate and atomically write canonical batch and manifest files."""
    if output_batch_path.resolve() == manifest_path.resolve():
        raise ValueError("batch and manifest paths must be different")
    validate_batch(batch, batch_id=batch_id, expected_count=len(batch))
    batch_bytes = canonical_json_bytes(batch)
    manifest = build_manifest(
        batch=batch,
        batch_bytes=batch_bytes,
        batch_id=batch_id,
        master_seed=master_seed,
        generator_commit=generator_commit,
        model_sha256=model_sha256,
        max_source_games=max_source_games,
    )
    manifest_bytes = canonical_json_bytes(manifest)
    validate_output_bytes(batch_bytes, manifest_bytes)
    if master_seed in batch_bytes or master_seed in manifest_bytes:
        raise ValueError("raw master seed must not appear in generated output")

    _atomic_write(output_batch_path, batch_bytes)
    _atomic_write(manifest_path, manifest_bytes)
    return manifest


def main(
    argv: Sequence[str] | None = None,
    *,
    scorer_loader: Callable[[Path], tuple[PolicyMarginScorer, str]] | None = None,
) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master-seed-file", required=True, type=Path)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--scenario-count", required=True, type=int)
    parser.add_argument("--model-artifact", type=Path, default=DEFAULT_MODEL_ARTIFACT)
    parser.add_argument("--output-batch", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--generator-commit", required=True)
    args = parser.parse_args(argv)

    master_seed = args.master_seed_file.read_bytes()
    loader = load_policy_margin_scorer if scorer_loader is None else scorer_loader
    policy_margin_scorer, model_sha256 = loader(args.model_artifact)
    batch = generate_batch(
        master_seed=master_seed,
        batch_id=args.batch_id,
        scenario_count=args.scenario_count,
        policy_margin_scorer=policy_margin_scorer,
    )
    manifest = write_batch_outputs(
        batch=batch,
        batch_id=args.batch_id,
        master_seed=master_seed,
        generator_commit=args.generator_commit,
        model_sha256=model_sha256,
        output_batch_path=args.output_batch,
        manifest_path=args.manifest,
    )
    print(
        f"wrote {len(batch)} scenarios to {args.output_batch} "
        f"(batch sha256:{manifest['batchSha256']})"
    )


if __name__ == "__main__":
    main()
