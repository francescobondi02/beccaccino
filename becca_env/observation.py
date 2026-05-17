"""Observation encoding: game state -> numpy tensor for neural network input.

Encodes the imperfect-information observation from one player's perspective
into a fixed-size feature vector suitable for policy/value networks.
"""

from __future__ import annotations

import numpy as np

from becca_env.deck import DECK, Card, Suit
from becca_env.game import BeccaGame, GamePhase, Signal

# Card indexing: 40 cards total, ordered by suit then value
CARD_INDEX: dict[Card, int] = {card: i for i, card in enumerate(DECK)}
NUM_CARDS = 40
NUM_SUITS = 4
NUM_SIGNALS = 3  # striscio, busso, volo

# Feature vector layout:
# [0:40]     my hand (binary)
# [40:80]    cards played this trick (one-hot per position * 4 slots = not quite, see below)
# Actually let's use a cleaner layout:
#
# my_hand:           40  (binary: which cards I hold)
# cards_seen:        40  (binary: cards that have been played in previous tricks this round)
# current_trick:     40*4 = 160  (one-hot for each of 4 trick positions)
# briscola:          4   (one-hot suit)
# my_seat:           4   (one-hot)
# trick_starter:     4   (one-hot)
# hand_number:       10  (one-hot, which hand 1-10)
# round_number:      10  (one-hot, capped at 10)
# scores:            2   (normalized team0, team1 scores)
# signals_this_round: 10*3 = 30  (for each hand, which signal was declared)
# signal_declarer:   10*4 = 40   (for each hand, who declared)
# Total: 40+40+160+4+4+4+10+10+2+30+40 = 344

OBS_SIZE = 344


def encode_observation(game: BeccaGame, seat: int) -> np.ndarray:
    """Encode the game state from `seat`'s perspective into a feature vector."""
    obs = np.zeros(OBS_SIZE, dtype=np.float32)
    r = game.round
    offset = 0

    # My hand (40)
    for card in r.player_hands.get(seat, []):
        obs[offset + CARD_INDEX[card]] = 1.0
    offset += NUM_CARDS

    # Cards seen in previous tricks (40)
    for tr in r.hands_played:
        for _, card in tr.cards:
            obs[offset + CARD_INDEX[card]] = 1.0
    offset += NUM_CARDS

    # Current trick cards (160 = 4 positions * 40 cards)
    for i, (_, card) in enumerate(r.current_trick):
        obs[offset + i * NUM_CARDS + CARD_INDEX[card]] = 1.0
    offset += 4 * NUM_CARDS

    # Briscola suit (4)
    if r.briscola is not None:
        suit_idx = list(Suit).index(r.briscola)
        obs[offset + suit_idx] = 1.0
    offset += NUM_SUITS

    # My seat (4)
    obs[offset + seat] = 1.0
    offset += 4

    # Trick starter (4)
    obs[offset + r.trick_starter] = 1.0
    offset += 4

    # Hand number (10) — 0-indexed
    hand_num = min(len(r.hands_played), 9)
    obs[offset + hand_num] = 1.0
    offset += 10

    # Round number (10) — 0-indexed, capped
    round_idx = min(r.number - 1, 9)
    obs[offset + round_idx] = 1.0
    offset += 10

    # Scores (2) — normalized to [0, 1] range based on win_points
    max_raw = game.win_points * 3
    obs[offset] = game.total_scores[0] / max_raw
    obs[offset + 1] = game.total_scores[1] / max_raw
    offset += 2

    # Signals this round (10 hands * 3 signal types = 30)
    signal_to_idx = {Signal.STRISCIO: 0, Signal.BUSSO: 1, Signal.VOLO: 2}
    for i, tr in enumerate(r.hands_played):
        if i >= 10:
            break
        if tr.signal is not None:
            obs[offset + i * NUM_SIGNALS + signal_to_idx[tr.signal]] = 1.0
    offset += 30

    # Signal declarers (10 hands * 4 seats = 40)
    for i, tr in enumerate(r.hands_played):
        if i >= 10:
            break
        if tr.signal_seat is not None:
            obs[offset + i * 4 + tr.signal_seat] = 1.0
    offset += 40

    assert offset == OBS_SIZE
    return obs


def encode_action_mask(game: BeccaGame, seat: int) -> np.ndarray:
    """Create a binary mask over the action space indicating legal actions.

    Action space: 40 cards * 4 signal options = 160 for trick leader
                  40 cards for followers
    We unify to 160 (card_idx * 4 + signal_idx).
    For non-leaders, only signal_idx=0 (no signal) slots are valid.
    For briscola choice: first 4 slots represent the 4 suits.
    """
    if game.phase == GamePhase.CHOOSE_BRISCOLA:
        mask = np.zeros(160, dtype=np.float32)
        mask[:4] = 1.0  # 4 suits
        return mask

    mask = np.zeros(160, dtype=np.float32)
    actions = game.legal_actions()

    if game.phase == GamePhase.PLAY_CARD:
        is_leader = len(game.round.current_trick) == 0

        if is_leader:
            for card, signal in actions:
                card_idx = CARD_INDEX[card]
                sig_idx = 0 if signal is None else (list(Signal).index(signal) + 1)
                mask[card_idx * 4 + sig_idx] = 1.0
        else:
            for card in actions:
                card_idx = CARD_INDEX[card]
                mask[card_idx * 4] = 1.0  # only "no signal" slot

    return mask


def decode_action(action_idx: int, game: BeccaGame):
    """Convert a flat action index back to game action.

    For CHOOSE_BRISCOLA: action_idx 0-3 maps to Suit.
    For PLAY_CARD: action_idx = card_idx * 4 + signal_idx.
    """
    if game.phase == GamePhase.CHOOSE_BRISCOLA:
        return list(Suit)[action_idx]

    card_idx = action_idx // 4
    sig_idx = action_idx % 4

    card = DECK[card_idx]
    signal = None if sig_idx == 0 else list(Signal)[sig_idx - 1]

    is_leader = len(game.round.current_trick) == 0
    if is_leader:
        return (card, signal)
    else:
        return card
