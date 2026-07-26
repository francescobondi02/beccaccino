"""Translate game state between the backend's JSON and a live `BeccaGame`.

The bot's observation encoder (`becca_env.observation`) is the one used during
training, and it reads a `BeccaGame`. So to let a bot act inside a game the
TypeScript backend owns, we rebuild an equivalent `BeccaGame` here.

Everything crossing the boundary is an **enum string** ("spade", "asso") — never
a numeric index. That is deliberate: Python's `Suit` order (DENARA, SPADE, COPPE,
BASTONI) and Prisma's (denara, coppe, spade, bastoni) transpose spade and coppe,
so any index computed on the backend would silently permute 20 cards, the trump
one-hot, and the void-mask columns. Resolving each string with Python's own
`Suit(...)` lookup removes that failure mode entirely.

The rebuilt game only needs to be faithful in what the encoder reads: hands,
the tricks of the CURRENT round in play order, signals, briscola, trick starter,
and cumulative raw scores. It is not a resumable game.
"""

from __future__ import annotations

from typing import Any

from becca_env.deck import Card, Suit, Value
from becca_env.game import BeccaGame, GamePhase, RoundState, Signal, TrickRecord
from becca_env.rules import determine_hand_winner

NUM_SEATS = 4
TRICKS_PER_ROUND = 10

# Cumulative team scores cross the wire as raw points (the unit
# `encode_observation` normalizes), because the backend stores real points and a
# figures remainder in separate columns: raw = points * 3 + figures.
RAW_PER_POINT = 3


class StateAdapterError(ValueError):
    """The incoming state is malformed or internally inconsistent."""


def _card(dto: dict[str, str]) -> Card:
    try:
        return Card(Suit(dto["suit"]), Value(dto["value"]))
    except (KeyError, ValueError) as exc:
        raise StateAdapterError(f"bad card {dto!r}: {exc}") from exc


def _signal(name: str | None) -> Signal | None:
    if name is None:
        return None
    try:
        return Signal(name)
    except ValueError as exc:
        raise StateAdapterError(f"unknown signal {name!r}") from exc


def _seated_cards(entries: list[dict[str, Any]]) -> list[tuple[int, Card]]:
    """Parse [{seat, suit, value}, ...] preserving the given play order."""
    return [(int(e["seat"]), _card(e)) for e in entries]


def state_dict_to_game(state: dict[str, Any]) -> BeccaGame:
    """Rebuild a `BeccaGame` positioned at the decision the backend is asking about.

    Expected shape (see `game_to_state_dict` for the canonical producer):
        phase           "choose_briscola" | "play_card"
        briscola        suit string, or None before it is chosen
        round_number    1-based
        caller_seat     who chose briscola this round
        trick_starter   seat that led the current trick
        hands           {seat: [{suit, value}, ...]}  cards still held
        completed_tricks[{cards: [{seat, suit, value}, ...],
                          signal: str|None, signal_seat: int|None}]
        current_trick   [{seat, suit, value}, ...] in play order
        current_signal  signal declared by the current trick's leader, or None
        total_scores    {"0": raw, "1": raw} cumulative RAW points
        win_points      target real points for the game
    """
    try:
        phase = GamePhase(state["phase"])
    except (KeyError, ValueError) as exc:
        raise StateAdapterError(f"bad phase: {exc}") from exc
    if phase not in (GamePhase.CHOOSE_BRISCOLA, GamePhase.PLAY_CARD):
        raise StateAdapterError(f"cannot act in phase {phase.value}")

    game = BeccaGame.__new__(BeccaGame)  # bypass __init__: it deals a fresh deck
    game.rng = None  # unused: this game is never stepped forward
    game.win_points = int(state["win_points"])
    game.total_scores = {t: int(state["total_scores"][str(t)]) for t in (0, 1)}
    game.rounds_won = {0: 0, 1: 0}  # not encoded in the observation
    game.round_number = int(state["round_number"])
    game.phase = phase
    game.result = None

    briscola = state.get("briscola")
    hands = {int(seat): [_card(c) for c in cards] for seat, cards in state["hands"].items()}
    _require_all_seats(hands)

    completed = [_trick_record(t, briscola) for t in state.get("completed_tricks", [])]
    if len(completed) > TRICKS_PER_ROUND:
        raise StateAdapterError(f"{len(completed)} completed tricks > {TRICKS_PER_ROUND}")

    current = _seated_cards(state.get("current_trick", []))
    if len(current) >= NUM_SEATS:
        raise StateAdapterError("current_trick is already complete")

    game.round = RoundState(
        number=game.round_number,
        briscola=Suit(briscola) if briscola else None,
        cricca=False,  # affects scoring only, and scores arrive pre-computed
        caller_seat=int(state["caller_seat"]),
        hands_played=completed,
        current_trick=current,
        trick_starter=int(state["trick_starter"]),
        trick_signals=_trick_signals(current, state.get("current_signal")),
        player_hands=hands,
    )
    return game


def _require_all_seats(hands: dict[int, list[Card]]) -> None:
    missing = set(range(NUM_SEATS)) - hands.keys()
    if missing:
        raise StateAdapterError(f"missing hands for seats {sorted(missing)}")


def _trick_record(trick: dict[str, Any], briscola: str | None) -> TrickRecord:
    """Rebuild one completed trick, recomputing its winner from the cards.

    The winner is derived rather than trusted: it is the one field the backend
    could disagree with us about, and recomputing keeps a single rules authority.
    """
    cards = _seated_cards(trick["cards"])
    if len(cards) != NUM_SEATS:
        raise StateAdapterError(f"completed trick has {len(cards)} cards, expected {NUM_SEATS}")
    if briscola is None:
        raise StateAdapterError("completed tricks present but briscola is unset")

    signal_seat = trick.get("signal_seat")
    return TrickRecord(
        winner=determine_hand_winner(cards, Suit(briscola)),
        cards=cards,
        signal=_signal(trick.get("signal")),
        signal_seat=None if signal_seat is None else int(signal_seat),
    )


def _trick_signals(
    current_trick: list[tuple[int, Card]], current_signal: str | None
) -> list[tuple[int, Signal | None]]:
    """Rebuild the in-progress trick's signal list.

    The encoder only reads element 0 (only the leader may signal), but the list
    must align with current_trick so `current_seat` stays consistent.
    """
    if not current_trick:
        return []
    leader_seat = current_trick[0][0]
    signals: list[tuple[int, Signal | None]] = [(leader_seat, _signal(current_signal))]
    signals += [(seat, None) for seat, _ in current_trick[1:]]
    return signals


def game_to_state_dict(game: BeccaGame, seat: int) -> dict[str, Any]:
    """Serialize a live game into the wire format `state_dict_to_game` accepts.

    Used by the parity tests to round-trip real self-play positions, and as the
    executable spec the backend serializer is checked against.
    """
    r = game.round
    leader_signal = r.trick_signals[0][1] if r.trick_signals else None

    return {
        "phase": game.phase.value,
        "briscola": r.briscola.value if r.briscola else None,
        "round_number": r.number,
        "caller_seat": r.caller_seat,
        "trick_starter": r.trick_starter,
        "acting_seat": seat,
        "hands": {str(s): [_card_dto(c) for c in cards] for s, cards in r.player_hands.items()},
        "completed_tricks": [
            {
                "cards": [_seated_card_dto(s, c) for s, c in tr.cards],
                "signal": tr.signal.value if tr.signal else None,
                "signal_seat": tr.signal_seat,
            }
            for tr in r.hands_played
        ],
        "current_trick": [_seated_card_dto(s, c) for s, c in r.current_trick],
        "current_signal": leader_signal.value if leader_signal else None,
        "total_scores": {str(t): game.total_scores[t] for t in (0, 1)},
        "win_points": game.win_points,
    }


def _card_dto(card: Card) -> dict[str, str]:
    return {"suit": card.suit.value, "value": card.value.value}


def _seated_card_dto(seat: int, card: Card) -> dict[str, Any]:
    return {"seat": seat, **_card_dto(card)}
