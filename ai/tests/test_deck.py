"""Tests for deck definitions — validates card counts and point values."""

from becca_env.deck import DECK, Suit, Value, card_points, card_strength


def test_deck_has_40_cards():
    assert len(DECK) == 40


def test_deck_has_10_cards_per_suit():
    for suit in Suit:
        cards = [c for c in DECK if c.suit == suit]
        assert len(cards) == 10


def test_total_raw_points_is_32():
    """Total raw points in deck = 32.
    4 suits * (asso=3 + tre=1 + due=1 + re=1 + cavallo=1 + fante=1 + 4 zeros) = 4*8 = 32.
    """
    total = sum(card_points[c.value] for c in DECK)
    assert total == 32


def test_all_values_have_strength():
    for v in Value:
        assert v in card_strength


def test_strength_is_unique():
    strengths = list(card_strength.values())
    assert len(strengths) == len(set(strengths))
