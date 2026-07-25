"""The Beccaccino signalling convention: what a declared signal claims.

The engine deliberately does NOT enforce any of this. A dishonest signal is a
legal move and must stay legal — bluffing is part of the game, and an engine that
rejected it would be wrong. This module only defines what each signal *claims*
about the declarer's hand.

It exists because three places must agree on that definition, and previously only
one of them had it:
  - reward shaping (`becca_env/env.py`), which grounds the signal slots,
  - the BC teacher (`evaluation/heuristic.py`), which supplies warm-start targets,
  - the offline audit (`evaluation/signal_audit.py`).

If they disagreed, we would train against one convention and measure another.

The claims are judged against the hand the declarer holds *after* the led card is
gone, which is what a signal is about: volo says "that was my last one".
"""

from __future__ import annotations

from becca_env.deck import Card, Suit, Value, card_strength
from becca_env.game import Signal

# A busso claims strength — a card that can actually win the suit. Asso is the
# floor: below it the claim is empty, since re/cavallo/fante carry points but
# lose to asso/due/tre.
BUSSO_STRENGTH_FLOOR = card_strength[Value.ASSO]

# A striscio claims length: at least two more cards of the suit after this lead.
STRISCIO_MIN_REMAINING = 2


def signal_is_honest(signal: Signal, hand_after: list[Card], suit: Suit) -> bool:
    """Is `signal`'s claim consistent with what the declarer still holds?

    `hand_after` is the declarer's hand once the led card has been removed;
    `suit` is the suit they led.
    """
    same_suit = [c for c in hand_after if c.suit == suit]
    if signal is Signal.VOLO:
        return not same_suit
    if signal is Signal.STRISCIO:
        return len(same_suit) >= STRISCIO_MIN_REMAINING
    return any(card_strength[c.value] >= BUSSO_STRENGTH_FLOOR for c in same_suit)


def honest_signal_for(hand_after: list[Card], suit: Suit) -> Signal | None:
    """The signal the convention would declare for this lead, or None if the hand
    supports no claim.

    Used as the BC teacher's signalling policy, so warm-start targets are honest
    by construction rather than arbitrary. Ordered most-informative first: a void
    is the sharpest fact about a suit, then strength, then mere length. Every
    branch is checked by `signal_is_honest`, so the teacher can never label a
    claim its own audit would reject.
    """
    same_suit = [c for c in hand_after if c.suit == suit]
    if not same_suit:
        return Signal.VOLO
    if any(card_strength[c.value] >= BUSSO_STRENGTH_FLOOR for c in same_suit):
        return Signal.BUSSO
    if len(same_suit) >= STRISCIO_MIN_REMAINING:
        return Signal.STRISCIO
    return None
