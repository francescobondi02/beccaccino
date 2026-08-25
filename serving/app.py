"""FastAPI endpoint for raw-state Beccaccino bot inference."""

from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from becca_env.deck import Card
from becca_env.game import GamePhase
from serving.state_adapter import StateAdapterError, state_dict_to_game
from serving.tiers import (
    TierUnavailableError,
    UnknownTierError,
    available_tiers,
    get_agent,
)

BOT_SERVICE_TOKEN_ENV = "BOT_SERVICE_TOKEN"
PROMOTED_TIER = "forte"


def _configured_bot_token() -> str:
    token = os.environ.get(BOT_SERVICE_TOKEN_ENV)
    if not token:
        raise RuntimeError(f"{BOT_SERVICE_TOKEN_ENV} must be set and not empty")
    return token


def _require_bot_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = _configured_bot_token()

    scheme, separator, supplied = (authorization or "").partition(" ")
    if (
        separator != " "
        or scheme.lower() != "bearer"
        or not secrets.compare_digest(supplied, expected)
    ):
        raise HTTPException(
            status_code=401,
            detail="invalid bot service credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Fail startup unless the promoted policy and production config are usable."""
    _configured_bot_token()
    get_agent(PROMOTED_TIER)
    yield


app = FastAPI(
    title="Becca AI",
    description="Beccaccino card game AI inference",
    lifespan=lifespan,
)

# Sampling temperature bounds. 0 is greedy; above ~2 the policy is close to
# uniform over legal moves, which is indistinguishable from a random opponent.
MAX_TEMPERATURE = 2.0


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


@app.post("/act", dependencies=[Depends(_require_bot_token)])
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
    instead.
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
    return _readiness_response(PROMOTED_TIER)


@app.get("/ready", dependencies=[Depends(_require_bot_token)])
def ready(tier: str):
    return _readiness_response(tier)


def _readiness_response(tier: str) -> dict[str, str]:
    try:
        get_agent(tier)
    except UnknownTierError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, f"tier {tier!r} is unavailable") from exc
    return {"status": "ok", "model": "ready", "tier": tier}
