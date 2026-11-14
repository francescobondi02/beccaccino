"""Frozen 1888-feature encoder used by the October 2026 Kaggle policy.

Keep this layout separate from the 518-feature training and historical policies.
"""

from __future__ import annotations

import numpy as np

from becca_env.deck import DECK, Card, Suit, card_points
from becca_env.game import TEAM_OF_SEAT, BeccaGame, Signal

CARD_INDEX: dict[Card, int] = {card: i for i, card in enumerate(DECK)}
NUM_CARDS = 40
NUM_SUITS = 4
NUM_SIGNALS = 3
PLAY_SIZE = NUM_CARDS + 4
TRICK_SIZE = 4 * PLAY_SIZE + NUM_SIGNALS + 4
OBS_SIZE = NUM_CARDS + 10 * TRICK_SIZE + 4 + 4 + 4 + 1 + 2 + 2 + 1


def encode_observation(game: BeccaGame, seat: int) -> np.ndarray:
    """Preserve chronological public play, relative seats and raw score figures."""
    obs = np.zeros(OBS_SIZE, dtype=np.float32)
    round_state = game.round
    for card in round_state.player_hands.get(seat, []):
        obs[CARD_INDEX[card]] = 1.0

    tricks = [(tr.cards, tr.signal, tr.winner) for tr in round_state.tricks_played]
    if round_state.current_trick:
        signal = round_state.trick_signals[0][1] if round_state.trick_signals else None
        tricks.append((round_state.current_trick, signal, None))
    for trick_index, (cards, signal, winner) in enumerate(tricks):
        offset = NUM_CARDS + trick_index * TRICK_SIZE
        for position, (player, card) in enumerate(cards):
            play_offset = offset + position * PLAY_SIZE
            obs[play_offset + CARD_INDEX[card]] = 1.0
            obs[play_offset + NUM_CARDS + (player - seat) % 4] = 1.0
        if signal is not None:
            obs[offset + 4 * PLAY_SIZE + list(Signal).index(signal)] = 1.0
        if winner is not None:
            obs[offset + 4 * PLAY_SIZE + NUM_SIGNALS + (winner - seat) % 4] = 1.0

    offset = NUM_CARDS + 10 * TRICK_SIZE
    if round_state.briscola is not None:
        obs[offset + list(Suit).index(round_state.briscola)] = 1.0
    offset += NUM_SUITS
    for player in (round_state.caller_seat, round_state.trick_starter):
        obs[offset + (player - seat) % 4] = 1.0
        offset += 4
    obs[offset] = float(round_state.cricca)
    offset += 1

    round_scores = [0, 0]
    for trick in round_state.tricks_played:
        round_scores[TEAM_OF_SEAT[trick.winner]] += sum(
            card_points[card.value] for _, card in trick.cards
        )
    if len(round_state.tricks_played) == 10:
        round_scores[TEAM_OF_SEAT[round_state.tricks_played[-1].winner]] += 3
    if round_state.cricca:
        round_scores[TEAM_OF_SEAT[round_state.caller_seat]] += 9
    own_team = TEAM_OF_SEAT[seat]
    teams = (own_team, 1 - own_team)
    obs[offset : offset + 2] = [game.total_scores[team] / (game.win_points * 3) for team in teams]
    obs[offset + 2 : offset + 4] = [round_scores[team] / 44 for team in teams]
    obs[offset + 4] = 1.0 / game.win_points
    return obs
