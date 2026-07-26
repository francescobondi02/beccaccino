"""FastAPI serving endpoint for Beccaccino AI.

Two stateless entry points:

- `POST /predict` — low-level: takes an already-encoded observation vector.
  Used by callers that own the encoding themselves.
- `POST /act` — what the game backend calls: takes RAW game state as enum
  strings, and owns encoding, inference, and action decoding. This keeps the
  training-time observation encoder as the single implementation, so a bot can
  never read a differently-encoded board than the one it learned on.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from becca_env.deck import Card
from becca_env.game import GamePhase
from becca_env.observation import OBS_SIZE
from serving.state_adapter import StateAdapterError, state_dict_to_game
from serving.tiers import (
    TierUnavailableError,
    UnknownTierError,
    available_tiers,
    get_agent,
)
from training.network import ACTION_SIZE

app = FastAPI(title="Becca AI", description="Beccaccino card game AI inference")

_session = None

# Sampling temperature bounds. 0 is greedy; above ~2 the policy is close to
# uniform over legal moves, which is indistinguishable from a random opponent.
MAX_TEMPERATURE = 2.0


class GameState(BaseModel):
    """Observation from the backend (pre-encoded OBS_SIZE vector + action mask)."""

    obs: list[float]
    action_mask: list[float]


class ActionResponse(BaseModel):
    action: int
    confidence: float


def _get_session():
    global _session
    if _session is None:
        import onnxruntime as ort

        model_path = Path(__file__).parent / "model.onnx"
        if not model_path.exists():
            raise HTTPException(500, "Model not found. Run export_onnx.py first.")
        _session = ort.InferenceSession(str(model_path))
    return _session


@app.post("/predict", response_model=ActionResponse)
def predict(state: GameState):
    """Given a game observation, return the best action."""
    session = _get_session()

    # Validate widths up front so malformed cross-boundary requests return a
    # clear 422 rather than a cryptic 500 from onnxruntime. Importing OBS_SIZE
    # keeps this in lockstep with the encoder.
    if len(state.obs) != OBS_SIZE:
        raise HTTPException(422, f"obs must have length {OBS_SIZE}, got {len(state.obs)}")
    if len(state.action_mask) != ACTION_SIZE:
        raise HTTPException(
            422, f"action_mask must have length {ACTION_SIZE}, got {len(state.action_mask)}"
        )

    obs = np.array(state.obs, dtype=np.float32).reshape(1, -1)
    mask = np.array(state.action_mask, dtype=np.float32).reshape(1, -1)

    # No legal action → nothing to choose; reject cleanly instead of letting the
    # empty-array reduction below raise an opaque 500.
    if not np.any(mask[0] > 0):
        raise HTTPException(422, "action_mask has no legal actions")

    logits, _ = session.run(None, {"obs": obs, "action_mask": mask})
    logits = logits[0]

    # Greedy action selection
    action = int(np.argmax(logits))
    # Confidence: softmax probability of chosen action (only over legal actions)
    legal_logits = logits[mask[0] > 0]
    exp_logits = np.exp(legal_logits - legal_logits.max())
    probs = exp_logits / exp_logits.sum()
    confidence = float(probs.max())

    return ActionResponse(action=action, confidence=confidence)


class ActRequest(BaseModel):
    """Raw game state plus which bot should move.

    `state` is the wire format documented in `serving.state_adapter`. Cards and
    suits are enum strings; the caller never computes a card or action index.
    """

    state: dict[str, Any]
    seat: int = Field(ge=0, le=3)
    tier: str
    temperature: float = Field(default=0.0, ge=0.0, le=MAX_TEMPERATURE)
    expected_legal_cards: list[dict[str, str]] | None = None


class BriscolaMove(BaseModel):
    kind: Literal["briscola"] = "briscola"
    suit: str


class CardMove(BaseModel):
    kind: Literal["card"] = "card"
    suit: str
    value: str
    signal: str | None = None


@app.post("/act")
def act(request: ActRequest) -> BriscolaMove | CardMove:
    """Choose a move for a bot seat from raw game state."""
    try:
        game = state_dict_to_game(request.state)
    except StateAdapterError as exc:
        raise HTTPException(422, f"malformed game state: {exc}") from exc

    if game.current_seat != request.seat:
        raise HTTPException(
            409, f"not seat {request.seat}'s turn (current seat is {game.current_seat})"
        )

    _reject_on_legal_move_disagreement(game, request)

    try:
        agent = get_agent(request.tier, request.temperature)
    except UnknownTierError as exc:
        raise HTTPException(422, str(exc)) from exc
    except TierUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc

    action = agent.select_action(game, request.seat)
    return _move_response(game, action)


def _reject_on_legal_move_disagreement(game, request: ActRequest) -> None:
    """Refuse to move if our rules engine and the caller's disagree on the board.

    The caller may send the card set IT believes is legal. If that differs from
    what we derive, one of us is looking at a different game — better a loud 409
    the backend can log and fall back from than a plausible move on a wrong board.

    This catches legality drift only. Wrong scores or a truncated signal history
    do not change which cards are playable, and are covered by the parity tests
    instead (see docs/BOT_PLAY_DESIGN.md §5.3).
    """
    if request.expected_legal_cards is None or game.phase != GamePhase.PLAY_CARD:
        return

    expected = {(c["suit"], c["value"]) for c in request.expected_legal_cards}
    ours = {(card.suit.value, card.value.value) for card in _legal_cards(game)}
    if expected != ours:
        raise HTTPException(
            409,
            "legal-move disagreement: "
            f"backend={sorted(expected)} bot={sorted(ours)} — refusing to move",
        )


def _legal_cards(game) -> set:
    """The distinct cards playable now, collapsing a leader's signal variants."""
    if game.phase != GamePhase.PLAY_CARD:
        return set()

    actions = game.legal_actions()
    if actions and isinstance(actions[0], Card):  # followers get bare cards
        return set(actions)
    return {card for card, _ in actions}  # leader: (card, signal) pairs


def _move_response(game, action) -> BriscolaMove | CardMove:
    """Translate an agent's action into the wire response.

    A leader's action is a (Card, Signal|None) pair; a follower's is a bare Card.
    `Card` is itself a NamedTuple, so these must be told apart by element type —
    an isinstance(action, tuple) check matches BOTH and silently unpacks a card
    into (suit, value).
    """
    if game.phase == GamePhase.CHOOSE_BRISCOLA:
        return BriscolaMove(suit=action.value)

    if isinstance(action, Card):
        card, signal = action, None
    else:
        card, signal = action

    return CardMove(
        suit=card.suit.value,
        value=card.value.value,
        signal=signal.value if signal else None,
    )


@app.get("/tiers")
def tiers():
    """Difficulty tiers this deployment can serve, weakest first."""
    return [
        {"name": t.name, "label": t.label, "description": t.description} for t in available_tiers()
    ]


@app.get("/health")
def health():
    return {"status": "ok"}
