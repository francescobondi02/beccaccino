"""Observation encoding: game state -> numpy tensor for neural network input.

Encodes the imperfect-information observation from one player's perspective
into a fixed-size feature vector suitable for policy/value networks.

v3 layout (462 features):
  my_hand:          40   binary, which cards I currently hold
  card_status:      40 * 5 = 200   per-card one-hot of where it currently is:
                       [unseen, in_my_hand, played_by_partner,
                        played_by_left_opp, played_by_right_opp]
                       NOTE: cards in CURRENT trick are also marked here
                       (status follows whoever played them).
  current_trick:    40 * 4 = 160  one-hot for each of 4 trick positions
                                  (so the net knows what's on the table NOW)
  briscola:         4    one-hot suit (zeros until briscola is chosen)
  my_seat:          4    one-hot
  trick_starter:    4    one-hot
  hand_number:      10   one-hot, hand index 0..9 in this round
  round_number:     10   one-hot, capped at 10
  scores:           2    team0_norm, team1_norm in [0, 1]
  void_mask:        4 * 4 = 16   1 if seat S is *known* void in suit V
                                 (deduced from prior failure-to-follow).
                                 Rows are seats relative to me:
                                   row 0 = me      (always 0 — placeholder
                                                    for fixed shape)
                                   row 1 = left opponent  (seat (me+1)%4)
                                   row 2 = partner        (seat (me+2)%4)
                                   row 3 = right opponent (seat (me+3)%4)
                                 Helps the net deduce hidden hands.
  signal_mask:      4 * 3 = 12   1 if the seat at this relative position has
                                 declared this signal (striscio/busso/volo)
                                 anywhere this round. Signals are public, so
                                 row 0 (me) IS populated (unlike void_mask —
                                 my own past signals aren't otherwise in the
                                 obs). Makes the cooperative channel learnable.
  Total = 40 + 200 + 160 + 4 + 4 + 4 + 10 + 10 + 2 + 16 + 12 = 462
"""

from __future__ import annotations

import numpy as np

from becca_env.deck import DECK, Card, Suit
from becca_env.game import BeccaGame, GamePhase, Signal  # noqa: F401  re-exported

# Card indexing: 40 cards total, ordered by suit then value
CARD_INDEX: dict[Card, int] = {card: i for i, card in enumerate(DECK)}
SUIT_INDEX: dict[Suit, int] = {s: i for i, s in enumerate(Suit)}
NUM_CARDS = 40
NUM_SUITS = 4
NUM_SIGNALS = 3  # striscio, busso, volo
# striscio=0, busso=1, volo=2
SIGNAL_INDEX: dict[Signal, int] = {s: i for i, s in enumerate(Signal)}

# Card-status one-hot has 5 classes: unseen / mine / partner / left / right
CARD_STATUS_CLASSES = 5
STATUS_UNSEEN = 0
STATUS_MINE = 1
STATUS_PARTNER = 2
STATUS_LEFT_OPP = 3
STATUS_RIGHT_OPP = 4

OBS_SIZE = 462

# Full-state size for the centralized (CTDE) critic: the actor obs plus the 3
# hidden hands (train-time only; the policy never sees this).
FULL_STATE_SIZE = OBS_SIZE + 3 * NUM_CARDS  # 462 + 120 = 582


def _seat_status_class(player_seat: int, viewer_seat: int) -> int:
    """Classify another seat relative to the viewer.

    Returns one of STATUS_PARTNER / STATUS_LEFT_OPP / STATUS_RIGHT_OPP.
    (The viewer's own cards use STATUS_MINE; this helper is for OPP cards.)
    """
    rel = (player_seat - viewer_seat) % 4
    if rel == 0:
        # Same seat as viewer; should not be called for the viewer's own cards
        return STATUS_MINE
    if rel == 2:
        return STATUS_PARTNER
    if rel == 1:
        return STATUS_LEFT_OPP
    # rel == 3
    return STATUS_RIGHT_OPP


def _compute_void_mask(game: BeccaGame, viewer_seat: int) -> np.ndarray:
    """Per-(other-seat, suit) flag: is the seat *known* void in this suit?

    A seat is provably void in suit S if at any earlier point it was forced to
    play (it didn't lead) and chose a non-S card on a trick whose lead suit
    was S — under follow-suit rules, that means it had no S in hand.

    Rows in the returned 4x4 matrix are arranged relative to viewer_seat:
      row 0 = me, row 1 = left opp, row 2 = partner, row 3 = right opp.
    Row 0 stays 0 (we obviously know our own hand exactly via my_hand).
    """
    mask = np.zeros((4, 4), dtype=np.float32)
    r = game.round
    # Walk through completed tricks
    for tr in r.hands_played:
        if not tr.cards:
            continue
        lead_suit = tr.cards[0][1].suit
        lead_idx = SUIT_INDEX[lead_suit]
        for s, card in tr.cards[1:]:  # skip the leader; they chose lead_suit
            if card.suit != lead_suit:
                # seat s could not follow → void in lead_suit forever
                rel = (s - viewer_seat) % 4
                mask[rel, lead_idx] = 1.0
    # Also from the IN-PROGRESS trick, if anyone has already failed to follow
    if r.current_trick:
        lead_suit = r.current_trick[0][1].suit
        lead_idx = SUIT_INDEX[lead_suit]
        for s, card in r.current_trick[1:]:
            if card.suit != lead_suit:
                rel = (s - viewer_seat) % 4
                mask[rel, lead_idx] = 1.0
    return mask


def _compute_signal_mask(game: BeccaGame, viewer_seat: int) -> np.ndarray:
    """Per-(declarer-seat, signal-type) flag: has this seat declared this signal
    anywhere this round? Signals are public, so this is fully observable.

    Rows in the returned 4x3 matrix are relative to viewer_seat:
      row 0 = me, row 1 = left opp, row 2 = partner, row 3 = right opp.
    Unlike the void mask, row 0 IS populated: my own past signals aren't
    otherwise encoded, and a partner needs to read them symmetrically.
    """
    mask = np.zeros((4, NUM_SIGNALS), dtype=np.float32)
    r = game.round
    # Completed tricks: each carries the leader's declared signal (if any).
    for tr in r.hands_played:
        if tr.signal is not None and tr.signal_seat is not None:
            rel = (tr.signal_seat - viewer_seat) % 4
            mask[rel, SIGNAL_INDEX[tr.signal]] = 1.0
    # In-progress trick: only the leader (index 0) can have signalled.
    if r.trick_signals:
        leader_seat, leader_signal = r.trick_signals[0]
        if leader_signal is not None:
            rel = (leader_seat - viewer_seat) % 4
            mask[rel, SIGNAL_INDEX[leader_signal]] = 1.0
    return mask


def encode_observation(game: BeccaGame, seat: int) -> np.ndarray:
    """Encode the game state from `seat`'s perspective into a feature vector."""
    obs = np.zeros(OBS_SIZE, dtype=np.float32)
    r = game.round
    offset = 0

    # My hand (40)
    my_hand = r.player_hands.get(seat, [])
    for card in my_hand:
        obs[offset + CARD_INDEX[card]] = 1.0
    offset += NUM_CARDS

    # Per-card status one-hot (40 * 5 = 200)
    # Default: every card UNSEEN. Then mark mine, mark each played card.
    status_block = obs[offset : offset + NUM_CARDS * CARD_STATUS_CLASSES]
    status_block[STATUS_UNSEEN::CARD_STATUS_CLASSES] = 1.0  # default
    # My hand → mine
    for card in my_hand:
        ci = CARD_INDEX[card]
        base = ci * CARD_STATUS_CLASSES
        status_block[base + STATUS_UNSEEN] = 0.0
        status_block[base + STATUS_MINE] = 1.0
    # Cards from completed tricks
    for tr in r.hands_played:
        for player_seat, card in tr.cards:
            ci = CARD_INDEX[card]
            base = ci * CARD_STATUS_CLASSES
            status_block[base + STATUS_UNSEEN] = 0.0
            if player_seat == seat:
                status_block[base + STATUS_MINE] = 1.0
            else:
                cls = _seat_status_class(player_seat, seat)
                status_block[base + cls] = 1.0
    # Cards in current (in-progress) trick
    for player_seat, card in r.current_trick:
        ci = CARD_INDEX[card]
        base = ci * CARD_STATUS_CLASSES
        status_block[base + STATUS_UNSEEN] = 0.0
        if player_seat == seat:
            status_block[base + STATUS_MINE] = 1.0
        else:
            cls = _seat_status_class(player_seat, seat)
            status_block[base + cls] = 1.0
    offset += NUM_CARDS * CARD_STATUS_CLASSES

    # Current trick cards (160 = 4 positions * 40 cards)
    for i, (_, card) in enumerate(r.current_trick):
        obs[offset + i * NUM_CARDS + CARD_INDEX[card]] = 1.0
    offset += 4 * NUM_CARDS

    # Briscola suit (4)
    if r.briscola is not None:
        obs[offset + SUIT_INDEX[r.briscola]] = 1.0
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
    obs[offset] = min(game.total_scores[0] / max_raw, 1.0)
    obs[offset + 1] = min(game.total_scores[1] / max_raw, 1.0)
    offset += 2

    # Void mask (4x4 = 16): rows = relative seat (0=me, 1=left, 2=partner, 3=right)
    void = _compute_void_mask(game, seat)
    obs[offset : offset + 16] = void.flatten()
    offset += 16

    # Signal mask (4x3 = 12): rows = relative seat, cols = striscio/busso/volo
    signals = _compute_signal_mask(game, seat)
    obs[offset : offset + 4 * NUM_SIGNALS] = signals.flatten()
    offset += 4 * NUM_SIGNALS

    assert offset == OBS_SIZE, f"obs offset {offset} != {OBS_SIZE}"
    return obs


def encode_full_state(game: BeccaGame, seat: int, obs: np.ndarray | None = None) -> np.ndarray:
    """Full-state encoding for the centralized critic (train time only).

    Actor obs ⊕ the 3 hidden hands as binary card vectors, ordered by relative
    seat to mirror the void/signal-mask convention: left opp (rel 1), partner
    (rel 2), right opp (rel 3). The policy never sees this — it exists so the
    value head can fit returns it otherwise can't explain in a hidden-hand game.
    """
    full = np.zeros(FULL_STATE_SIZE, dtype=np.float32)
    full[:OBS_SIZE] = encode_observation(game, seat) if obs is None else obs
    r = game.round
    for rel in (1, 2, 3):
        other_seat = (seat + rel) % 4
        block = OBS_SIZE + (rel - 1) * NUM_CARDS
        for card in r.player_hands.get(other_seat, []):
            full[block + CARD_INDEX[card]] = 1.0
    return full


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
