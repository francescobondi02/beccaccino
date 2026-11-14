"""Becca Environment — headless Beccaccino game engine for RL training."""

from becca_env.deck import DECK, Card, Suit, Value, card_points, card_strength
from becca_env.game import BeccaGame, GamePhase, Signal, TrickRecord
from becca_env.rules import (
    compute_round_scores,
    detect_cricca,
    determine_trick_winner,
    follow_suit_filter,
)

__all__ = [
    "Suit",
    "Value",
    "Card",
    "DECK",
    "card_points",
    "card_strength",
    "follow_suit_filter",
    "detect_cricca",
    "determine_trick_winner",
    "compute_round_scores",
    "BeccaGame",
    "GamePhase",
    "Signal",
    "TrickRecord",
]
