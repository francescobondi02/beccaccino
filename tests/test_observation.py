"""Tests for the v3 observation encoding (462 features).

Layout invariants verified here:
  - shape = (462,) float32, values in [0, 1]
  - per-card status block is exactly one-hot per card (5 classes)
  - own hand bits agree with status MINE bits
  - cards seen in completed tricks have correct seat-classification
    (partner / left opp / right opp)
  - void mask flips on the right cell when a seat fails to follow suit
  - signal mask flips on the right (relative seat, signal type) cell
"""

from __future__ import annotations

import numpy as np

from becca_env.deck import Card, Suit, Value
from becca_env.game import BeccaGame, GamePhase
from becca_env.observation import (
    CARD_INDEX,
    CARD_STATUS_CLASSES,
    NUM_CARDS,
    NUM_SIGNALS,
    OBS_SIZE,
    SIGNAL_INDEX,
    STATUS_LEFT_OPP,
    STATUS_MINE,
    STATUS_PARTNER,
    STATUS_RIGHT_OPP,
    STATUS_UNSEEN,
    SUIT_INDEX,
    encode_observation,
)


def _make_game_in_play(briscola: Suit) -> BeccaGame:
    g = BeccaGame(seed=0)
    g.round.briscola = briscola
    g.phase = GamePhase.PLAY_CARD
    g.round.current_trick = []
    g.round.trick_signals = []
    return g


def _status_block(obs: np.ndarray) -> np.ndarray:
    """Return the (40, 5) status one-hot block."""
    return obs[40 : 40 + NUM_CARDS * CARD_STATUS_CLASSES].reshape(NUM_CARDS, CARD_STATUS_CLASSES)


_SIGNAL_BLOCK = 4 * NUM_SIGNALS  # 12, the trailing signal mask
_VOID_BLOCK = 16                 # void mask sits just before the signal mask


def _void_block(obs: np.ndarray) -> np.ndarray:
    """Return the (4, 4) void mask block (precedes the trailing signal mask)."""
    start = OBS_SIZE - _SIGNAL_BLOCK - _VOID_BLOCK
    return obs[start : start + _VOID_BLOCK].reshape(4, 4)


def _signal_block(obs: np.ndarray) -> np.ndarray:
    """Return the (4, 3) signal mask block at the end of the obs vector."""
    return obs[OBS_SIZE - _SIGNAL_BLOCK : OBS_SIZE].reshape(4, NUM_SIGNALS)


def test_obs_shape_and_dtype():
    g = BeccaGame(seed=1)
    obs = encode_observation(g, seat=0)
    assert obs.shape == (OBS_SIZE,)
    assert obs.dtype == np.float32
    assert obs.min() >= 0.0
    assert obs.max() <= 1.0


def test_status_block_is_strict_one_hot():
    """Every card must have exactly one status class set."""
    g = BeccaGame(seed=42)
    obs = encode_observation(g, seat=0)
    block = _status_block(obs)
    sums = block.sum(axis=1)
    np.testing.assert_array_equal(sums, np.ones(NUM_CARDS), err_msg="not one-hot")


def test_my_hand_and_status_mine_agree():
    """The 40 my_hand bits must equal the MINE column of the status block."""
    g = BeccaGame(seed=7)
    obs = encode_observation(g, seat=0)
    my_hand_bits = obs[:40]
    mine_col = _status_block(obs)[:, STATUS_MINE]
    np.testing.assert_array_equal(my_hand_bits, mine_col)


def test_other_seats_unseen_at_round_start():
    """Before any card is played, all opponent cards are STATUS_UNSEEN."""
    g = _make_game_in_play(briscola=Suit.DENARA)
    # Hand seat 1 a known card
    other_card = Card(Suit.SPADE, Value.RE)
    if other_card in g.round.player_hands[0]:
        # very rare; swap
        g.round.player_hands[0].remove(other_card)
        g.round.player_hands[1].append(other_card)
    obs = encode_observation(g, seat=0)
    block = _status_block(obs)
    if other_card in g.round.player_hands[1]:
        ci = CARD_INDEX[other_card]
        assert block[ci, STATUS_UNSEEN] == 1.0
        assert block[ci, STATUS_MINE] == 0.0


def test_status_classifies_partner_left_right_correctly():
    """We are seat 0. Partner=2, left=1, right=3.
    Stage a completed trick where each opp played a distinct known card."""
    g = _make_game_in_play(briscola=Suit.DENARA)
    g.round.trick_starter = 0

    # Force seat 0 to have ONLY denara, others to have ONLY their played card.
    # We construct a trick: 0 leads quattro_denara, 1 plays cinque_coppe (void!),
    # 2 plays sei_spade, 3 plays sette_bastoni.
    led = Card(Suit.DENARA, Value.QUATTRO)
    p1 = Card(Suit.COPPE, Value.CINQUE)
    p2 = Card(Suit.SPADE, Value.SEI)
    p3 = Card(Suit.BASTONI, Value.SETTE)

    # We don't actually need to fully validate hands; just inject the trick
    # into hands_played so encode_observation reads it as completed history.
    from becca_env.game import TrickRecord
    g.round.hands_played.append(TrickRecord(
        winner=0, cards=[(0, led), (1, p1), (2, p2), (3, p3)],
        signal=None, signal_seat=None,
    ))
    # And ensure my_hand doesn't accidentally contain the played cards
    for c in (led, p1, p2, p3):
        if c in g.round.player_hands[0]:
            g.round.player_hands[0].remove(c)

    obs = encode_observation(g, seat=0)
    block = _status_block(obs)

    # My led card → MINE
    assert block[CARD_INDEX[led], STATUS_MINE] == 1.0
    # Seat 1 = left opp
    assert block[CARD_INDEX[p1], STATUS_LEFT_OPP] == 1.0
    # Seat 2 = partner
    assert block[CARD_INDEX[p2], STATUS_PARTNER] == 1.0
    # Seat 3 = right opp
    assert block[CARD_INDEX[p3], STATUS_RIGHT_OPP] == 1.0


def test_status_relativity_to_seat_3():
    """From seat 3's POV: seat 1 = partner, seat 2 = left, seat 0 = right."""
    g = _make_game_in_play(briscola=Suit.DENARA)
    g.round.trick_starter = 0
    led = Card(Suit.DENARA, Value.QUATTRO)
    p1 = Card(Suit.COPPE, Value.CINQUE)
    p2 = Card(Suit.SPADE, Value.SEI)
    p3 = Card(Suit.BASTONI, Value.SETTE)
    from becca_env.game import TrickRecord
    g.round.hands_played.append(TrickRecord(
        winner=0, cards=[(0, led), (1, p1), (2, p2), (3, p3)],
        signal=None, signal_seat=None,
    ))
    for c in (led, p1, p2, p3):
        if c in g.round.player_hands[3]:
            g.round.player_hands[3].remove(c)

    obs = encode_observation(g, seat=3)
    block = _status_block(obs)
    # From seat 3: rel(0,3)=1 → LEFT? Let's compute. (player_seat - viewer)%4
    #   seat 0 vs 3: (0-3)%4 = 1 → LEFT_OPP
    #   seat 1 vs 3: (1-3)%4 = 2 → PARTNER
    #   seat 2 vs 3: (2-3)%4 = 3 → RIGHT_OPP
    #   seat 3 vs 3: (3-3)%4 = 0 → MINE
    assert block[CARD_INDEX[led], STATUS_LEFT_OPP] == 1.0     # seat 0
    assert block[CARD_INDEX[p1], STATUS_PARTNER] == 1.0       # seat 1
    assert block[CARD_INDEX[p2], STATUS_RIGHT_OPP] == 1.0     # seat 2
    assert block[CARD_INDEX[p3], STATUS_MINE] == 1.0          # seat 3


def test_void_mask_set_when_seat_fails_to_follow_suit():
    """If seat 1 plays off-suit on a denara-led trick, void[left_opp, denara] = 1."""
    g = _make_game_in_play(briscola=Suit.SPADE)
    g.round.trick_starter = 0
    led = Card(Suit.DENARA, Value.QUATTRO)
    off = Card(Suit.COPPE, Value.RE)  # seat 1 didn't follow → void in denara
    on = Card(Suit.DENARA, Value.SEI)
    on2 = Card(Suit.DENARA, Value.SETTE)
    from becca_env.game import TrickRecord
    g.round.hands_played.append(TrickRecord(
        winner=0, cards=[(0, led), (1, off), (2, on), (3, on2)],
        signal=None, signal_seat=None,
    ))

    obs = encode_observation(g, seat=0)
    void = _void_block(obs)
    # seat 1 vs viewer 0: rel = 1 → row 1 is left opp
    assert void[1, SUIT_INDEX[Suit.DENARA]] == 1.0
    # No false positives
    assert void[2, SUIT_INDEX[Suit.DENARA]] == 0.0
    assert void[3, SUIT_INDEX[Suit.DENARA]] == 0.0
    # Other suits not flagged for left opp
    assert void[1, SUIT_INDEX[Suit.SPADE]] == 0.0


def test_void_mask_zero_at_round_start():
    g = BeccaGame(seed=99)
    obs = encode_observation(g, seat=0)
    void = _void_block(obs)
    np.testing.assert_array_equal(void, np.zeros((4, 4)))


def test_void_mask_picks_up_in_progress_trick():
    """Void should also fire from the partial trick (not only completed history)."""
    g = _make_game_in_play(briscola=Suit.SPADE)
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.QUATTRO)),
        (1, Card(Suit.COPPE, Value.RE)),  # off-suit → void in denara
    ]
    obs = encode_observation(g, seat=0)
    void = _void_block(obs)
    assert void[1, SUIT_INDEX[Suit.DENARA]] == 1.0


def test_briscola_one_hot_when_chosen():
    g = _make_game_in_play(briscola=Suit.BASTONI)
    obs = encode_observation(g, seat=0)
    # briscola block starts after 40 + 200 + 160 = 400
    briscola_block = obs[400:404]
    expected = np.zeros(4)
    expected[SUIT_INDEX[Suit.BASTONI]] = 1.0
    np.testing.assert_array_equal(briscola_block, expected)


def test_signal_mask_zero_when_no_signals():
    g = BeccaGame(seed=5)
    obs = encode_observation(g, seat=0)
    np.testing.assert_array_equal(_signal_block(obs), np.zeros((4, NUM_SIGNALS)))


def test_signal_mask_set_from_completed_trick():
    """Seat 2 (our partner) declared BUSSO leading a completed trick.
    From seat 0's POV that lands on relative row 2, busso column."""
    from becca_env.game import Signal, TrickRecord
    g = _make_game_in_play(briscola=Suit.DENARA)
    led = Card(Suit.DENARA, Value.QUATTRO)
    g.round.hands_played.append(TrickRecord(
        winner=2,
        cards=[(2, led), (3, Card(Suit.DENARA, Value.CINQUE)),
               (0, Card(Suit.DENARA, Value.SEI)), (1, Card(Suit.DENARA, Value.SETTE))],
        signal=Signal.BUSSO, signal_seat=2,
    ))
    sig = _signal_block(encode_observation(g, seat=0))
    assert sig[2, SIGNAL_INDEX[Signal.BUSSO]] == 1.0
    assert sig.sum() == 1.0  # nothing else fires


def test_signal_mask_set_from_in_progress_trick():
    """The leader of the in-progress trick declared STRISCIO."""
    from becca_env.game import Signal
    g = _make_game_in_play(briscola=Suit.DENARA)
    g.round.current_trick = [(1, Card(Suit.DENARA, Value.QUATTRO))]
    g.round.trick_signals = [(1, Signal.STRISCIO)]
    sig = _signal_block(encode_observation(g, seat=0))
    # seat 1 vs viewer 0: rel = 1 (left opp)
    assert sig[1, SIGNAL_INDEX[Signal.STRISCIO]] == 1.0
    assert sig.sum() == 1.0


def test_signal_mask_is_viewer_relative():
    """Same declared signal appears on different relative rows for different
    viewers. Seat 0 declares VOLO; seat 0 sees row 0, seat 2 sees row 2."""
    from becca_env.game import Signal, TrickRecord
    g = _make_game_in_play(briscola=Suit.DENARA)
    g.round.hands_played.append(TrickRecord(
        winner=0,
        cards=[(0, Card(Suit.DENARA, Value.QUATTRO)), (1, Card(Suit.DENARA, Value.CINQUE)),
               (2, Card(Suit.DENARA, Value.SEI)), (3, Card(Suit.DENARA, Value.SETTE))],
        signal=Signal.VOLO, signal_seat=0,
    ))
    sig0 = _signal_block(encode_observation(g, seat=0))
    sig2 = _signal_block(encode_observation(g, seat=2))
    assert sig0[0, SIGNAL_INDEX[Signal.VOLO]] == 1.0  # my own signal, row 0
    assert sig2[2, SIGNAL_INDEX[Signal.VOLO]] == 1.0  # (0 - 2) % 4 = 2
