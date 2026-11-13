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
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

from becca_env.deck import Card, Suit, Value, card_points, card_strength
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase, Signal
from becca_env.observation import CARD_INDEX
from becca_env.rules import determine_hand_winner, follow_suit_filter
from evaluation.heuristic import HeuristicAgent
from scripts.annotation_scenario_constants import (
    ANNOTATION_DIFFICULTIES,
    ANNOTATION_FAMILIES,
    ANNOTATION_IMPORTANCE_VALUES,
    ANNOTATION_TAGS,
    BRISCOLA_CLOSE_THRESHOLD,
    DIVERSITY_PENALTY,
    IMPORTANCE_USEFUL_UNCOMMON,
    MAX_SCENARIOS_PER_SOURCE_GAME,
    METHOD_VERSION,
    RULES_VERSION,
)

DEFAULT_MODEL_ARTIFACT = Path("serving/models/run_d2_champion.pt")
WIN_POINTS = 41
SCORE_PRESSURE_RAW = (WIN_POINTS - 10) * 3
DEFAULT_SOURCE_GAME_COUNT = 120
MAX_DECISIONS_PER_GAME = 600
MIN_MASTER_SEED_BYTES = 32

PolicyScoreScorer = Callable[[BeccaGame], Sequence[float]]

_SIGNALS = (None, Signal.STRISCIO, Signal.BUSSO, Signal.VOLO)
_BATCH_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,72}$")
_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_SCENARIO_KEYS = {
    "code",
    "decisionType",
    "predictedDifficulty",
    "importance",
    "tags",
    "stateHash",
    "state",
}
_PLAY_STATE_KEYS = (
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
_BRISCOLA_STATE_KEYS = (
    "targetPoints",
    "roundNumber",
    "actingSeat",
    "callerSeat",
    "totalScores",
    "hand",
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


@dataclass(frozen=True)
class ModelMargins:
    """Normalized model confidence margins for one public decision."""

    action: float
    card: float | None = None
    signal: float | None = None


@dataclass(frozen=True)
class GenerationAudit:
    """Aggregate-only generation metadata safe for the public manifest."""

    source_games_scanned: int
    source_games_with_candidates: int
    candidate_pool_counts: Mapping[str, int]
    selected_source_games: int
    max_selected_per_source_game: int


@dataclass(frozen=True)
class GenerationResult:
    scenarios: list[dict]
    audit: GenerationAudit


@dataclass(frozen=True)
class _Candidate:
    scenario: dict
    family: str
    source_game_index: int
    quality: float
    feature_signature: tuple[object, ...]
    discovery_index: int


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


def family_quotas(scenario_count: int) -> dict[str, int]:
    """Allocate three near-equal family quotas with deterministic remainder order."""
    if not isinstance(scenario_count, int) or scenario_count <= 0:
        raise ValueError("scenario count must be a positive integer")

    base, remainder = divmod(scenario_count, len(ANNOTATION_FAMILIES))
    quotas = {family: base for family in ANNOTATION_FAMILIES}
    for family in ANNOTATION_FAMILIES[:remainder]:
        quotas[family] += 1
    return quotas


def _selection_family_order(quotas: Mapping[str, int]) -> list[str]:
    return [
        family
        for ordinal in range(max(quotas.values(), default=0))
        for family in ANNOTATION_FAMILIES
        if quotas[family] > ordinal
    ]


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
    if game.phase != GamePhase.PLAY_CARD:
        raise ValueError("card action payloads require a play-card decision")
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


def briscola_public_state(game: BeccaGame) -> dict:
    """Serialize a public briscola-choice state for the caller."""
    if game.win_points != WIN_POINTS or game.phase != GamePhase.CHOOSE_BRISCOLA:
        raise ValueError("briscola scenarios must be live BeccaGame(win_points=41) choices")

    round_state = game.round
    return {
        "targetPoints": game.win_points,
        "roundNumber": round_state.number,
        "actingSeat": game.current_seat,
        "callerSeat": round_state.caller_seat,
        "totalScores": {
            "0": game.total_scores[0],
            "1": game.total_scores[1],
        },
        "hand": [
            _card_payload(card)
            for card in sorted(game.get_hand(game.current_seat), key=CARD_INDEX.__getitem__)
        ],
        "legalActions": [suit.value for suit in Suit],
    }


def play_card_public_state(game: BeccaGame) -> dict:
    """Serialize a public card-play state for the acting player."""
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


def public_state(game: BeccaGame) -> dict:
    """Serialize the complete public state for either supported decision."""
    if game.phase == GamePhase.CHOOSE_BRISCOLA:
        return briscola_public_state(game)
    if game.phase == GamePhase.PLAY_CARD:
        return play_card_public_state(game)
    raise ValueError(f"unsupported annotation decision phase: {game.phase.value}")


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


def _hand_suit_scores(state: Mapping[str, object]) -> dict[Suit, float]:
    hand = [_parse_card(card) for card in state["hand"]]
    scores = {}
    for suit in Suit:
        suited_cards = [card for card in hand if card.suit == suit]
        scores[suit] = len(suited_cards) + 0.05 * sum(
            card_strength[card.value] for card in suited_cards
        )
    return scores


def briscola_strength_closeness(state: Mapping[str, object]) -> float:
    """Return top-two public hand-strength closeness on a 0..1 scale."""
    top, second = sorted(_hand_suit_scores(state).values(), reverse=True)[:2]
    return 1.0 - min((top - second) / max(top, 1.0), 1.0)


def risk_tradeoffs(state: Mapping[str, object]) -> dict[str, bool]:
    """Identify concrete public card-play tradeoffs."""
    hand = [_parse_card(card) for card in state["hand"]]
    current = state["currentTrick"]
    trick = [_parse_play(play, index) for index, play in enumerate(current["plays"])]
    if not trick:
        return {
            "partner_points": False,
            "trump_or_discard": False,
            "win_or_lose": False,
        }

    briscola = Suit(state["briscola"])
    acting_seat = state["actingSeat"]
    legal_cards = [
        _parse_card({"suit": action["suit"], "value": action["value"]})
        for action in state["legalActions"]
    ]
    current_winner = determine_hand_winner(trick, briscola)
    partner_points = (
        TEAM_OF_SEAT[current_winner] == TEAM_OF_SEAT[acting_seat]
        and any(card_points[card.value] > 0 for card in legal_cards)
        and any(card_points[card.value] == 0 for card in legal_cards)
    )
    lead_suit = trick[0][1].suit
    is_void = all(card.suit != lead_suit for card in hand)
    trump_or_discard = (
        is_void
        and any(card.suit == briscola for card in legal_cards)
        and any(card.suit != briscola for card in legal_cards)
    )
    resulting_team_wins = {
        TEAM_OF_SEAT[determine_hand_winner([*trick, (acting_seat, card)], briscola)]
        == TEAM_OF_SEAT[acting_seat]
        for card in legal_cards
    }
    return {
        "partner_points": partner_points,
        "trump_or_discard": trump_or_discard,
        "win_or_lose": resulting_team_wins == {False, True},
    }


def _current_trick_points(state: Mapping[str, object]) -> int:
    plays = state["currentTrick"]["plays"]
    return sum(card_points[_parse_play(play, index)[1].value] for index, play in enumerate(plays))


def _scenario_family(
    state: Mapping[str, object],
    decision_type: str,
) -> str | None:
    """Return the V1 expert-decision family selected by public state."""
    if decision_type == GamePhase.CHOOSE_BRISCOLA.value:
        return (
            "borderline_briscola"
            if briscola_strength_closeness(state) >= BRISCOLA_CLOSE_THRESHOLD
            else None
        )
    if decision_type != GamePhase.PLAY_CARD.value:
        raise ValueError(f"unsupported decision type: {decision_type}")
    if not state["currentTrick"]["plays"]:
        return "lead"
    if any(risk_tradeoffs(state).values()):
        return "risk"
    return None


def _top_two_probability_margin(probabilities: Sequence[float]) -> float:
    top, second = sorted(probabilities, reverse=True)[:2]
    return max(0.0, min(top - second, 1.0))


def normalized_top_two_margin(scores: Sequence[float]) -> float:
    """Convert finite model scores to a top-two softmax margin in 0..1."""
    if len(scores) < 2 or any(not math.isfinite(score) for score in scores):
        raise ValueError("policy scoring requires at least two finite legal-action scores")
    maximum = max(scores)
    exponentials = [math.exp(score - maximum) for score in scores]
    total = sum(exponentials)
    probabilities = [value / total for value in exponentials]
    return _top_two_probability_margin(probabilities)


def model_margins(game: BeccaGame, scores: Sequence[float]) -> ModelMargins:
    """Compute normalized action margins, separating card and signal for leaders."""
    legal_actions = game.legal_actions()
    if len(scores) != len(legal_actions):
        raise ValueError(
            f"policy scorer returned {len(scores)} scores for {len(legal_actions)} legal actions"
        )

    action_margin = normalized_top_two_margin(scores)
    if game.phase != GamePhase.PLAY_CARD or game.round.current_trick:
        return ModelMargins(action=action_margin)

    maximum = max(scores)
    exponentials = [math.exp(score - maximum) for score in scores]
    total = sum(exponentials)
    probabilities = [value / total for value in exponentials]
    card_probabilities: defaultdict[Card, float] = defaultdict(float)
    signal_probabilities: defaultdict[Signal | None, float] = defaultdict(float)
    for action, probability in zip(legal_actions, probabilities, strict=True):
        card, signal = action
        card_probabilities[card] += probability
        signal_probabilities[signal] += probability

    return ModelMargins(
        action=action_margin,
        card=_top_two_probability_margin(list(card_probabilities.values())),
        signal=_top_two_probability_margin(list(signal_probabilities.values())),
    )


def decision_ambiguity(
    decision_type: str,
    state: Mapping[str, object],
    margins: ModelMargins,
) -> float:
    """Combine normalized model uncertainty with decision-specific public evidence."""
    if decision_type == GamePhase.CHOOSE_BRISCOLA.value:
        return 0.5 * (1.0 - margins.action) + 0.5 * briscola_strength_closeness(state)
    if decision_type == GamePhase.PLAY_CARD.value and not state["currentTrick"]["plays"]:
        if margins.card is None or margins.signal is None:
            raise ValueError("leader ambiguity requires separate card and signal margins")
        return 0.5 * (1.0 - margins.card) + 0.5 * (1.0 - margins.signal)
    if decision_type == GamePhase.PLAY_CARD.value:
        return 1.0 - margins.action
    raise ValueError(f"unsupported decision type: {decision_type}")


def strategic_impact(decision_type: str, state: Mapping[str, object]) -> float:
    """Score strategic impact from public state only, on a 0..1 scale."""
    score_pressure = max(state["totalScores"].values()) >= SCORE_PRESSURE_RAW
    if decision_type == GamePhase.CHOOSE_BRISCOLA.value:
        return 0.85 + 0.15 * score_pressure

    if not state["currentTrick"]["plays"]:
        card_count = distinct_legal_card_count(state["legalActions"])
        choice_factor = min(max(card_count - 2, 0) / 8, 1.0)
        suit_count = len({action["suit"] for action in state["legalActions"]})
        suit_factor = max(suit_count - 1, 0) / 3
        return min(
            0.15
            + 0.35 * choice_factor
            + 0.15 * suit_factor
            + 0.20 * (not state["completedTricks"])
            + 0.15 * score_pressure,
            1.0,
        )

    tradeoff_count = sum(risk_tradeoffs(state).values())
    return min(
        0.35
        + 0.15 * tradeoff_count
        + 0.20 * (_current_trick_points(state) >= 3)
        + 0.15 * score_pressure,
        1.0,
    )


def candidate_quality(ambiguity: float, impact: float) -> float:
    if not 0.0 <= ambiguity <= 1.0 or not 0.0 <= impact <= 1.0:
        raise ValueError("candidate ambiguity and impact must be normalized to 0..1")
    return round(0.6 * ambiguity + 0.4 * impact, 6)


def predict_difficulty(quality: float) -> str:
    """Derive display metadata from intrinsic selected-candidate quality."""
    if not 0.0 <= quality <= 1.0:
        raise ValueError("candidate quality must be normalized to 0..1")
    if quality < 0.45:
        return "easy"
    if quality < 0.70:
        return "medium"
    return "hard"


def load_policy_score_scorer(model_artifact: Path) -> tuple[PolicyScoreScorer, str]:
    """Load the pinned inference artifact once and return legal scores in mask order."""
    import torch

    from becca_env.observation import encode_action_mask, encode_observation
    from serving.artifact import load_inference_artifact
    from training.checkpoint import build_net

    model_sha256 = _file_sha256(model_artifact)
    artifact = load_inference_artifact(model_artifact)
    net = build_net(artifact, torch.device("cpu"))
    net.eval()

    def action_index(game: BeccaGame, action: object) -> int:
        if game.phase == GamePhase.CHOOSE_BRISCOLA:
            return list(Suit).index(action)
        if isinstance(action, Card):
            return CARD_INDEX[action] * 4
        card, signal = action
        signal_index = 0 if signal is None else list(Signal).index(signal) + 1
        return CARD_INDEX[card] * 4 + signal_index

    def score(game: BeccaGame) -> list[float]:
        observation = encode_observation(game, game.current_seat, obs_size=net.obs_size)
        action_mask = encode_action_mask(game, game.current_seat)
        observation_tensor = torch.from_numpy(observation).unsqueeze(0)
        mask_tensor = torch.from_numpy(action_mask).unsqueeze(0)
        with torch.inference_mode():
            logits, _ = net(observation_tensor, mask_tensor)
        legal_actions = game.legal_actions()
        if len(legal_actions) < 2:
            raise ValueError("policy scoring requires at least two legal actions")
        return [float(logits[0, action_index(game, action)]) for action in legal_actions]

    return score, model_sha256


def _scenario_code(batch_id: str, ordinal: int) -> str:
    return f"{batch_id}-{ordinal:05d}"


def _public_feature_signature(
    family: str,
    state: Mapping[str, object],
) -> tuple[object, ...]:
    score_pressure = max(state["totalScores"].values()) >= SCORE_PRESSURE_RAW
    if family == "borderline_briscola":
        hand = [_parse_card(card) for card in state["hand"]]
        suit_counts = tuple(
            sorted(
                (sum(card.suit == suit for card in hand) for suit in Suit),
                reverse=True,
            )
        )
        return (
            family,
            suit_counts,
            score_pressure,
        )
    if family == "lead":
        card_count = distinct_legal_card_count(state["legalActions"])
        return (
            family,
            not state["completedTricks"],
            min(card_count // 2, 5),
            len({action["suit"] for action in state["legalActions"]}),
            len(state["completedTricks"]) >= 7,
            score_pressure,
        )
    if family != "risk":
        raise ValueError(f"unsupported annotation family: {family}")
    tradeoffs = risk_tradeoffs(state)
    return (
        family,
        *(tradeoffs[name] for name in ("partner_points", "trump_or_discard", "win_or_lose")),
        len(state["currentTrick"]["plays"]),
        _current_trick_points(state) >= 3,
        score_pressure,
    )


def _candidate_scenario(
    game: BeccaGame,
    policy_score_scorer: PolicyScoreScorer,
    *,
    source_game_index: int,
    discovery_index: int,
) -> _Candidate | None:
    state = public_state(game)
    decision_type = game.phase.value
    if (
        decision_type == GamePhase.PLAY_CARD.value
        and distinct_legal_card_count(state["legalActions"]) <= 1
    ):
        return None
    family = _scenario_family(state, decision_type)
    if family is None:
        return None

    margins = model_margins(game, policy_score_scorer(game))
    ambiguity = decision_ambiguity(decision_type, state, margins)
    impact = strategic_impact(decision_type, state)
    quality = candidate_quality(ambiguity, impact)
    state_hash = _sha256(state)
    scenario = {
        "decisionType": decision_type,
        "predictedDifficulty": predict_difficulty(quality),
        "importance": IMPORTANCE_USEFUL_UNCOMMON,
        "tags": [family],
        "stateHash": state_hash,
        "state": state,
    }
    return _Candidate(
        scenario=scenario,
        family=family,
        source_game_index=source_game_index,
        quality=quality,
        feature_signature=_public_feature_signature(family, state),
        discovery_index=discovery_index,
    )


def _collect_candidate_pool(
    *,
    master_seed: bytes,
    batch_id: str,
    policy_score_scorer: PolicyScoreScorer,
    source_game_count: int,
) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    seen_hashes: set[str] = set()
    discovery_index = 0

    for game_index in range(source_game_count):
        game_seed = derive_game_seed(master_seed, batch_id, game_index)
        game = BeccaGame(seed=game_seed, win_points=WIN_POINTS)
        agent = HeuristicAgent(seed=game_seed, declare_signals=True)

        for _ in range(MAX_DECISIONS_PER_GAME):
            if game.phase == GamePhase.GAME_OVER:
                break
            candidate = _candidate_scenario(
                game,
                policy_score_scorer,
                source_game_index=game_index,
                discovery_index=discovery_index,
            )
            discovery_index += 1
            if candidate is not None and candidate.scenario["stateHash"] not in seen_hashes:
                candidates.append(candidate)
                seen_hashes.add(candidate.scenario["stateHash"])
            game.step(agent.select_action(game, game.current_seat))
        else:
            raise RuntimeError(
                f"source game {game_index} exceeded {MAX_DECISIONS_PER_GAME} decisions"
            )
    return candidates


def _select_candidates(
    candidates: Sequence[_Candidate],
    *,
    batch_id: str,
    scenario_count: int,
    source_games_scanned: int,
) -> GenerationResult:
    quotas = family_quotas(scenario_count)
    pool_counts = Counter(candidate.family for candidate in candidates)
    selected: list[_Candidate] = []
    selected_indexes: set[int] = set()
    source_counts: Counter[int] = Counter()
    signature_counts: Counter[tuple[object, ...]] = Counter()

    def remaining_selection_is_feasible(
        selected_indexes: set[int],
        source_counts: Counter[int],
        remaining: Mapping[str, int],
    ) -> bool:
        families = [family for family in ANNOTATION_FAMILIES if remaining[family] > 0]
        for size in range(1, len(families) + 1):
            for family_subset in combinations(families, size):
                demand = sum(remaining[family] for family in family_subset)
                available_by_source: Counter[int] = Counter(
                    candidate.source_game_index
                    for index, candidate in enumerate(candidates)
                    if index not in selected_indexes
                    and candidate.family in family_subset
                    and source_counts[candidate.source_game_index] < MAX_SCENARIOS_PER_SOURCE_GAME
                )
                capacity = sum(
                    min(
                        count,
                        MAX_SCENARIOS_PER_SOURCE_GAME - source_counts[source],
                    )
                    for source, count in available_by_source.items()
                )
                if capacity < demand:
                    return False
        return True

    for family in _selection_family_order(quotas):
        eligible = [
            (index, candidate)
            for index, candidate in enumerate(candidates)
            if index not in selected_indexes
            and candidate.family == family
            and source_counts[candidate.source_game_index] < MAX_SCENARIOS_PER_SOURCE_GAME
        ]
        if not eligible:
            selected_family_counts = Counter(candidate.family for candidate in selected)
            missing = {
                name: quotas[name] - selected_family_counts[name]
                for name in ANNOTATION_FAMILIES
                if selected_family_counts[name] < quotas[name]
            }
            raise RuntimeError(
                f"could not satisfy family quotas after scanning {source_games_scanned} "
                f"source games with a {MAX_SCENARIOS_PER_SOURCE_GAME}/source cap; "
                f"missing {missing}, pool {dict(pool_counts)}"
            )

        ranked = sorted(
            eligible,
            key=lambda pair: (
                -(
                    pair[1].quality
                    - DIVERSITY_PENALTY * signature_counts[pair[1].feature_signature]
                ),
                pair[1].discovery_index,
            ),
        )
        chosen_pair: tuple[int, _Candidate] | None = None
        for index, candidate in ranked:
            selected_indexes.add(index)
            source_counts[candidate.source_game_index] += 1
            selected_family_counts = Counter(item.family for item in selected)
            selected_family_counts[candidate.family] += 1
            remaining = {
                name: quotas[name] - selected_family_counts[name] for name in ANNOTATION_FAMILIES
            }
            if remaining_selection_is_feasible(
                selected_indexes,
                source_counts,
                remaining,
            ):
                chosen_pair = (index, candidate)
                break
            selected_indexes.remove(index)
            source_counts[candidate.source_game_index] -= 1
            if source_counts[candidate.source_game_index] == 0:
                del source_counts[candidate.source_game_index]

        if chosen_pair is None:
            raise RuntimeError(
                f"could not satisfy family quotas after scanning {source_games_scanned} "
                f"source games with a {MAX_SCENARIOS_PER_SOURCE_GAME}/source cap"
            )
        index, chosen = chosen_pair
        selected.append(chosen)
        signature_counts[chosen.feature_signature] += 1

    batch = [
        {"code": _scenario_code(batch_id, ordinal), **candidate.scenario}
        for ordinal, candidate in enumerate(selected, start=1)
    ]
    audit = GenerationAudit(
        source_games_scanned=source_games_scanned,
        source_games_with_candidates=len({candidate.source_game_index for candidate in candidates}),
        candidate_pool_counts={family: pool_counts[family] for family in ANNOTATION_FAMILIES},
        selected_source_games=len(source_counts),
        max_selected_per_source_game=max(source_counts.values(), default=0),
    )
    validate_batch(batch, batch_id=batch_id, expected_count=scenario_count)
    return GenerationResult(scenarios=batch, audit=audit)


def generate_batch_result(
    *,
    master_seed: bytes,
    batch_id: str,
    scenario_count: int,
    policy_score_scorer: PolicyScoreScorer,
    source_game_count: int = DEFAULT_SOURCE_GAME_COUNT,
) -> GenerationResult:
    """Collect a complete deterministic pool, then select the requested batch."""
    _require_master_seed(master_seed)
    _require_batch_id(batch_id)
    family_quotas(scenario_count)
    if not isinstance(source_game_count, int) or source_game_count <= 0:
        raise ValueError("source game count must be a positive integer")
    candidates = _collect_candidate_pool(
        master_seed=master_seed,
        batch_id=batch_id,
        policy_score_scorer=policy_score_scorer,
        source_game_count=source_game_count,
    )
    return _select_candidates(
        candidates,
        batch_id=batch_id,
        scenario_count=scenario_count,
        source_games_scanned=source_game_count,
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


def _validate_common_state(state: Mapping[str, object]) -> None:
    if state["targetPoints"] != WIN_POINTS:
        raise ValueError("scenario must use BeccaGame(win_points=41)")
    if not isinstance(state["roundNumber"], int) or state["roundNumber"] < 1:
        raise ValueError("roundNumber must be a positive integer")
    for key in ("actingSeat", "callerSeat"):
        if not isinstance(state[key], int) or state[key] not in range(4):
            raise ValueError(f"{key} must be a seat")
    scores = state["totalScores"]
    if (
        not isinstance(scores, dict)
        or set(scores) != {"0", "1"}
        or any(not isinstance(score, int) or score < 0 for score in scores.values())
    ):
        raise ValueError("totalScores must contain non-negative cumulative raw scores")


def _validate_briscola_state(state: Mapping[str, object]) -> None:
    if set(state) != set(_BRISCOLA_STATE_KEYS):
        raise ValueError("choose_briscola state has unexpected or missing fields")
    _validate_common_state(state)
    if state["actingSeat"] != state["callerSeat"]:
        raise ValueError("briscola actingSeat must be the callerSeat")

    hand = [_parse_card(card) for card in state["hand"]]
    if hand != sorted(hand, key=CARD_INDEX.__getitem__) or len(hand) != 10:
        raise ValueError("briscola hand must contain ten cards in canonical order")
    if len(hand) != len(set(hand)):
        raise ValueError("briscola hand contains duplicate cards")
    if state["legalActions"] != [suit.value for suit in Suit]:
        raise ValueError("briscola legalActions must contain all suits in canonical order")


def _validate_play_state(state: Mapping[str, object]) -> None:
    if set(state) != set(_PLAY_STATE_KEYS):
        raise ValueError("play_card state has unexpected or missing fields")
    _validate_common_state(state)
    if not isinstance(state["trickStarter"], int) or state["trickStarter"] not in range(4):
        raise ValueError("trickStarter must be a seat")
    try:
        briscola = Suit(state["briscola"])
    except (TypeError, ValueError) as error:
        raise ValueError("invalid briscola") from error

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


def _validate_state(decision_type: str, state: Mapping[str, object]) -> None:
    if not isinstance(state, dict):
        raise ValueError("scenario state must be an object")
    if decision_type == GamePhase.CHOOSE_BRISCOLA.value:
        _validate_briscola_state(state)
    elif decision_type == GamePhase.PLAY_CARD.value:
        _validate_play_state(state)
    else:
        raise ValueError("scenario decisionType is invalid")


def validate_batch(
    batch: object,
    *,
    batch_id: str,
    expected_count: int,
) -> None:
    """Validate shape, privacy, rules, family balance, and hashes."""
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
        if scenario["decisionType"] not in (
            GamePhase.CHOOSE_BRISCOLA.value,
            GamePhase.PLAY_CARD.value,
        ):
            raise ValueError("scenario decisionType is invalid")
        if scenario["predictedDifficulty"] not in ANNOTATION_DIFFICULTIES:
            raise ValueError("predicted difficulty is invalid")
        if scenario["importance"] not in ANNOTATION_IMPORTANCE_VALUES:
            raise ValueError("importance is invalid")
        if (
            not isinstance(scenario["tags"], list)
            or len(scenario["tags"]) != 1
            or scenario["tags"][0] not in ANNOTATION_TAGS
        ):
            raise ValueError("tags must contain exactly one annotation family")
        _validate_state(scenario["decisionType"], scenario["state"])
        expected_family = _scenario_family(scenario["state"], scenario["decisionType"])
        if expected_family is None or scenario["tags"][0] != expected_family:
            raise ValueError("scenario tags must contain exactly its public-state family")
        if scenario["importance"] != IMPORTANCE_USEFUL_UNCOMMON:
            raise ValueError("V1 scenarios must use useful importance")
        if scenario["stateHash"] != _sha256(scenario["state"]):
            raise ValueError("scenario stateHash is invalid")
        if scenario["stateHash"] in state_hashes:
            raise ValueError("scenario stateHash is duplicated")
        codes.add(scenario["code"])
        state_hashes.add(scenario["stateHash"])

    family_counts = Counter(scenario["tags"][0] for scenario in batch)
    if family_counts != Counter(family_quotas(expected_count)):
        raise ValueError("batch does not satisfy deterministic family quotas")


def _batch_counts(batch: list[dict], audit: GenerationAudit | None = None) -> dict:
    difficulty_counts = Counter(scenario["predictedDifficulty"] for scenario in batch)
    importance_counts = Counter(str(scenario["importance"]) for scenario in batch)
    family_counts = Counter(scenario["tags"][0] for scenario in batch)
    counts = {
        "difficulty": {
            difficulty: difficulty_counts[difficulty] for difficulty in ANNOTATION_DIFFICULTIES
        },
        "importance": {
            str(importance): importance_counts[str(importance)]
            for importance in ANNOTATION_IMPORTANCE_VALUES
        },
        "family": {family: family_counts[family] for family in ANNOTATION_FAMILIES},
    }
    if audit is not None:
        counts["candidatePoolFamily"] = {
            family: audit.candidate_pool_counts[family] for family in ANNOTATION_FAMILIES
        }
        counts["sourceGameCoverage"] = {
            "scanned": audit.source_games_scanned,
            "withCandidates": audit.source_games_with_candidates,
            "selected": audit.selected_source_games,
            "maxSelectedPerGame": audit.max_selected_per_source_game,
        }
    return counts


def build_manifest(
    *,
    batch: list[dict],
    batch_bytes: bytes,
    batch_id: str,
    master_seed: bytes,
    generator_commit: str,
    model_sha256: str,
    audit: GenerationAudit,
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
            "familyQuotas": family_quotas(scenario_count),
            "sourceGameCount": audit.source_games_scanned,
            "maxScenariosPerSourceGame": MAX_SCENARIOS_PER_SOURCE_GAME,
            "diversityPenalty": DIVERSITY_PENALTY,
        },
        "counts": _batch_counts(batch, audit),
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
        "familyQuotas": family_quotas(len(batch)),
        "sourceGameCount": (
            parameters.get("sourceGameCount") if isinstance(parameters, dict) else None
        ),
        "maxScenariosPerSourceGame": MAX_SCENARIOS_PER_SOURCE_GAME,
        "diversityPenalty": DIVERSITY_PENALTY,
    }
    if (
        not isinstance(parameters, dict)
        or set(parameters) != set(expected_parameters)
        or not isinstance(parameters["sourceGameCount"], int)
        or parameters["sourceGameCount"] <= 0
        or parameters != expected_parameters
    ):
        raise ValueError("manifest parameters are invalid")

    validate_batch(
        batch,
        batch_id=manifest["batchId"],
        expected_count=parameters["scenarioCount"],
    )
    counts = manifest["counts"]
    expected_batch_counts = _batch_counts(batch)
    if (
        not isinstance(counts, dict)
        or set(counts) != {*expected_batch_counts, "candidatePoolFamily", "sourceGameCoverage"}
        or any(counts[key] != value for key, value in expected_batch_counts.items())
    ):
        raise ValueError("manifest counts do not match the batch")
    candidate_pool = counts["candidatePoolFamily"]
    if (
        not isinstance(candidate_pool, dict)
        or set(candidate_pool) != set(ANNOTATION_FAMILIES)
        or any(
            not isinstance(candidate_pool[family], int)
            or candidate_pool[family] < counts["family"][family]
            for family in ANNOTATION_FAMILIES
        )
    ):
        raise ValueError("manifest candidate-pool counts are invalid")
    coverage = counts["sourceGameCoverage"]
    if not isinstance(coverage, dict) or set(coverage) != {
        "scanned",
        "withCandidates",
        "selected",
        "maxSelectedPerGame",
    }:
        raise ValueError("manifest source-game coverage is invalid")
    if any(not isinstance(value, int) for value in coverage.values()):
        raise ValueError("manifest source-game coverage is invalid")
    if not (
        coverage["scanned"] == parameters["sourceGameCount"]
        and 1 <= coverage["selected"] <= coverage["withCandidates"] <= coverage["scanned"]
        and coverage["selected"] <= len(batch)
        and 1 <= coverage["maxSelectedPerGame"]
        and coverage["maxSelectedPerGame"] <= MAX_SCENARIOS_PER_SOURCE_GAME
        and coverage["selected"] * coverage["maxSelectedPerGame"] >= len(batch)
    ):
        raise ValueError("manifest source-game coverage is invalid")
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
    audit: GenerationAudit,
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
        audit=audit,
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
    scorer_loader: Callable[[Path], tuple[PolicyScoreScorer, str]] | None = None,
) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master-seed-file", required=True, type=Path)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--scenario-count", required=True, type=int)
    parser.add_argument(
        "--source-game-count",
        type=int,
        default=DEFAULT_SOURCE_GAME_COUNT,
    )
    parser.add_argument("--model-artifact", type=Path, default=DEFAULT_MODEL_ARTIFACT)
    parser.add_argument("--output-batch", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--generator-commit", required=True)
    args = parser.parse_args(argv)

    master_seed = args.master_seed_file.read_bytes()
    loader = load_policy_score_scorer if scorer_loader is None else scorer_loader
    policy_score_scorer, model_sha256 = loader(args.model_artifact)
    generation = generate_batch_result(
        master_seed=master_seed,
        batch_id=args.batch_id,
        scenario_count=args.scenario_count,
        policy_score_scorer=policy_score_scorer,
        source_game_count=args.source_game_count,
    )
    manifest = write_batch_outputs(
        batch=generation.scenarios,
        batch_id=args.batch_id,
        master_seed=master_seed,
        generator_commit=args.generator_commit,
        model_sha256=model_sha256,
        output_batch_path=args.output_batch,
        manifest_path=args.manifest,
        audit=generation.audit,
    )
    print(
        f"wrote {len(generation.scenarios)} scenarios to {args.output_batch} "
        f"(batch sha256:{manifest['batchSha256']})"
    )


if __name__ == "__main__":
    main()
