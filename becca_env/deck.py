"""Deck definitions for the 40-card Italian (Romagnole) deck."""

from enum import Enum
from typing import NamedTuple


class Suit(Enum):
    DENARA = "denara"
    SPADE = "spade"
    COPPE = "coppe"
    BASTONI = "bastoni"


class Value(Enum):
    ASSO = "asso"
    DUE = "due"
    TRE = "tre"
    QUATTRO = "quattro"
    CINQUE = "cinque"
    SEI = "sei"
    SETTE = "sette"
    FANTE = "fante"
    CAVALLO = "cavallo"
    RE = "re"


class Card(NamedTuple):
    suit: Suit
    value: Value


DECK: list[Card] = [Card(s, v) for s in Suit for v in Value]
assert len(DECK) == 40

# Strength ordering for trick-taking (higher = stronger)
card_strength: dict[Value, int] = {
    Value.TRE: 10,
    Value.DUE: 9,
    Value.ASSO: 8,
    Value.RE: 7,
    Value.CAVALLO: 6,
    Value.FANTE: 5,
    Value.SETTE: 4,
    Value.SEI: 3,
    Value.CINQUE: 2,
    Value.QUATTRO: 1,
}

# Points (multiplied by 3 to avoid fractions, same as backend)
# Asso=3 (1 real point), Tre/Due/Re/Cavallo/Fante=1 (1/3 real point), others=0
card_points: dict[Value, int] = {
    Value.ASSO: 3,
    Value.TRE: 1,
    Value.DUE: 1,
    Value.RE: 1,
    Value.CAVALLO: 1,
    Value.FANTE: 1,
    Value.QUATTRO: 0,
    Value.CINQUE: 0,
    Value.SEI: 0,
    Value.SETTE: 0,
}
