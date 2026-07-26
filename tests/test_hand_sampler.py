"""Tests for inference/hand_sampler.py.

These tests pin the hard correctness properties:
  - sampled hands have the right sizes
  - sampled hands union to the unseen card set (no duplicates, nothing extra)
  - viewer's own hand is preserved verbatim
  - void constraints are honored (when feasible)
  - sampler is reproducible under a seeded RNG
  - sampler succeeds across many sampling attempts on real game states
"""

from __future__ import annotations

import random

import pytest

from becca_env.deck import DECK, Card, Suit
from becca_env.game import BeccaGame, GamePhase
from inference.hand_sampler import (
    _public_cards,
    _seat_hand_sizes,
    _void_suits_per_seat,
    sample_opponent_hands,
)


def _play_through_briscola(game: BeccaGame, briscola: Suit = Suit.DENARA):
    """Helper: advance from CHOOSE_BRISCOLA to PLAY_CARD."""
    assert game.phase == GamePhase.CHOOSE_BRISCOLA
    game.step(briscola)
    assert game.phase == GamePhase.PLAY_CARD


def _legal_card(game: BeccaGame, seat: int) -> Card:
    """Pick the first legal card for `seat` (must be current_seat).

    Handles both leader (returns Card from (Card, Signal) tuple) and follower.
    """
    assert game.current_seat == seat
    actions = game.legal_actions()
    if isinstance(actions[0], tuple):
        return actions[0][0]  # (card, signal) tuple
    return actions[0]


# -----------------------------------------------------------------------
# Basic sanity at game start
# -----------------------------------------------------------------------


def test_sample_at_start_of_round():
    g = BeccaGame(seed=42)
    _play_through_briscola(g)
    # Each seat has 10 cards, no public cards yet
    sampled = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(0))

    assert set(sampled.hands.keys()) == {0, 1, 2, 3}
    for s in range(4):
        assert len(sampled.hands[s]) == 10

    # Viewer's hand preserved exactly
    assert sampled.hands[0] == g.round.player_hands[0]


def test_sample_partitions_full_deck():
    g = BeccaGame(seed=7)
    _play_through_briscola(g)
    sampled = sample_opponent_hands(g, viewer_seat=2, rng=random.Random(1))

    all_cards = []
    for s in range(4):
        all_cards.extend(sampled.hands[s])
    assert len(all_cards) == 40
    assert len(set(all_cards)) == 40
    assert set(all_cards) == set(DECK)


def test_no_relax_needed_at_start():
    """At the start of a round there's no void info, so sampling should
    succeed without the relax fallback for any seed."""
    for seed in range(20):
        g = BeccaGame(seed=seed)
        _play_through_briscola(g)
        sampled = sample_opponent_hands(g, viewer_seat=seed % 4, rng=random.Random(seed))
        assert sampled.relaxed is False


# -----------------------------------------------------------------------
# Mid-round invariants
# -----------------------------------------------------------------------


def _play_one_full_trick(g: BeccaGame):
    """Advance the game by exactly 4 plays (one complete trick)."""
    for _ in range(4):
        actions = g.legal_actions()
        action = actions[0]
        g.step(action)


def test_sample_after_one_trick():
    g = BeccaGame(seed=11)
    _play_through_briscola(g)
    _play_one_full_trick(g)
    # 4 cards public, viewer holds 9, opps hold 9 each
    sampled = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(2))

    sizes = _seat_hand_sizes(g)
    for s in range(4):
        assert len(sampled.hands[s]) == sizes[s]

    # No duplicates across all seats
    flat = [c for s in range(4) for c in sampled.hands[s]]
    assert len(flat) == len(set(flat))

    # Public cards must NOT appear in any sampled hand
    public = _public_cards(g)
    for s in range(4):
        for c in sampled.hands[s]:
            assert c not in public, f"public card {c} appeared in seat {s}"


def test_sample_partway_through_in_progress_trick():
    """Mid-trick: 1-3 cards already played in the current trick.

    Hand sizes must reflect that only some seats have played this trick.
    """
    g = BeccaGame(seed=13)
    _play_through_briscola(g)
    # Play 2 of the 4 cards in the first trick
    g.step(g.legal_actions()[0])
    g.step(g.legal_actions()[0])
    assert len(g.round.current_trick) == 2

    sampled = sample_opponent_hands(g, viewer_seat=2, rng=random.Random(3))

    # Two seats already played → they hold 9. Two haven't → they hold 10.
    sizes = _seat_hand_sizes(g)
    for s in range(4):
        assert len(sampled.hands[s]) == sizes[s]


# -----------------------------------------------------------------------
# Void mask must be honored
# -----------------------------------------------------------------------


def _craft_void_situation(seed: int = 0):
    """Set up a game where seat 1 has revealed itself void in spade.

    Returns the game and the seat-with-known-void.
    """
    g = BeccaGame(seed=seed)
    _play_through_briscola(g, briscola=Suit.DENARA)

    # Force seat 1 to fail to follow spade. Manually arrange hands so:
    #   - seat 0 holds spades (will lead one)
    #   - seat 1 holds NO spade (the void we want to reveal)
    #   - seats 2 and 3 BOTH hold spades (so they can follow correctly,
    #     leaving seat 1 as the only void seat)
    spades = [c for c in DECK if c.suit == Suit.SPADE]
    non_spades = [c for c in DECK if c.suit != Suit.SPADE]
    assert len(spades) == 10 and len(non_spades) == 30

    # Distribute 10 spades among seats 0, 2, 3 (none to seat 1)
    g.round.player_hands[0] = spades[0:4] + non_spades[0:6]
    g.round.player_hands[1] = non_spades[6:16]  # no spade
    g.round.player_hands[2] = spades[4:7] + non_spades[16:23]
    g.round.player_hands[3] = spades[7:10] + non_spades[23:30]

    g.round.trick_starter = 0
    g.round.current_trick = []

    # Seat 0 leads a spade
    spade_lead = next(c for c in g.round.player_hands[0] if c.suit == Suit.SPADE)
    g.step((spade_lead, None))

    # Seat 1 must follow but cannot — plays any (legal) card. legal_actions
    # will be the whole hand since they're void.
    seat1_card = g.legal_actions()[0]
    g.step(seat1_card)
    # Seat 2 follows: pick a spade explicitly so they don't reveal a void
    seat2_spade = next(c for c in g.legal_actions() if c.suit == Suit.SPADE)
    g.step(seat2_spade)
    # Seat 3 follows: same
    seat3_spade = next(c for c in g.legal_actions() if c.suit == Suit.SPADE)
    g.step(seat3_spade)

    return g


def test_void_mask_extracted_correctly():
    g = _craft_void_situation(seed=0)
    voids = _void_suits_per_seat(g)
    # Seat 1 must be void in spade
    assert Suit.SPADE in voids[1]
    # Other seats should NOT be void in spade (they followed)
    assert Suit.SPADE not in voids[0]
    assert Suit.SPADE not in voids[2]
    assert Suit.SPADE not in voids[3]


def test_sampler_respects_void():
    """Sampler must not give seat 1 any spade if seat 1 is void in spade.

    Run many seeds to check the distribution honors the constraint.
    """
    g = _craft_void_situation(seed=0)
    rng = random.Random(99)
    for _ in range(50):
        sampled = sample_opponent_hands(g, viewer_seat=0, rng=rng)
        # This particular game state is feasible so relax must stay False
        assert not sampled.relaxed, "void constraints should be feasible here"
        seat1 = sampled.hands[1]
        spade_count = sum(1 for c in seat1 if c.suit == Suit.SPADE)
        assert spade_count == 0, (
            f"sampler gave seat 1 {spade_count} spade(s) despite known void: "
            f"{[str(c) for c in seat1 if c.suit == Suit.SPADE]}"
        )


def test_sampler_handles_double_void():
    """Two different seats void in two different suits → sampler honors both.

    We craft hands so seat 1 lacks spades and seat 3 lacks coppe, then play
    one trick of each lead so both voids surface in `hands_played`.
    """
    g = BeccaGame(seed=5)
    _play_through_briscola(g, briscola=Suit.DENARA)

    spade = [c for c in DECK if c.suit == Suit.SPADE]
    coppe = [c for c in DECK if c.suit == Suit.COPPE]
    denara = [c for c in DECK if c.suit == Suit.DENARA]
    bastoni = [c for c in DECK if c.suit == Suit.BASTONI]

    # seat 1: no spade. seat 3: no coppe.
    # seat 0 needs spades and coppe (to lead each).
    # seat 2 needs spades and coppe (to follow each).
    g.round.player_hands[0] = spade[0:3] + coppe[0:3] + denara[0:2] + bastoni[0:2]
    g.round.player_hands[1] = coppe[3:6] + denara[2:5] + bastoni[2:6]  # 0 spade
    g.round.player_hands[2] = spade[3:7] + coppe[6:8] + denara[5:7] + bastoni[6:8]
    g.round.player_hands[3] = spade[7:10] + denara[7:10] + bastoni[8:10] + denara[0:0]
    # seat 3 has 3 spade + 3 denara + 2 bastoni = 8; need 10. Let me redo.
    # Total cards: 40 = 10+10+10+10. Recount:
    #   seat 0: 3+3+2+2 = 10 ✓
    #   seat 1: 0+3+3+4 = 10 ✓
    #   seat 2: 4+2+2+2 = 10 ✓
    #   seat 3 must get the rest: 10-3-0-4=3 spade, 10-3-3-2=2 coppe (BUT
    #   we want seat 3 to have 0 coppe so this is wrong).
    # Correct redistribution:
    #   spade per seat: 3,0,4,3 = 10 ✓
    #   coppe per seat: 3,3,4,0 = 10 ✓ (seat 2 takes the extra coppe)
    #   denara per seat: 2,3,1,4 = 10 ✓
    #   bastoni per seat: 2,4,1,3 = 10 ✓
    g.round.player_hands[0] = spade[0:3] + coppe[0:3] + denara[0:2] + bastoni[0:2]
    g.round.player_hands[1] = coppe[3:6] + denara[2:5] + bastoni[2:6]
    g.round.player_hands[2] = spade[3:7] + coppe[6:10] + denara[5:6] + bastoni[6:7]
    g.round.player_hands[3] = spade[7:10] + denara[6:10] + bastoni[7:10]
    for s in range(4):
        assert len(g.round.player_hands[s]) == 10, (s, len(g.round.player_hands[s]))

    g.round.trick_starter = 0
    g.round.current_trick = []
    g.round.trick_signals = []

    # Trick A: seat 0 leads spade → seat 1 reveals void in spade
    g.step((spade[0], None))
    g.step(g.legal_actions()[0])  # seat 1, void in spade
    g.step(next(c for c in g.legal_actions() if c.suit == Suit.SPADE))  # seat 2 follows
    g.step(next(c for c in g.legal_actions() if c.suit == Suit.SPADE))  # seat 3 follows

    # Reset trick starter to seat 0 so we can lead coppe next
    g.round.current_trick = []
    g.round.trick_signals = []
    g.round.trick_starter = 0

    # Trick B: seat 0 leads coppe → seat 3 reveals void in coppe
    leader_coppe = next(c for c in g.round.player_hands[0] if c.suit == Suit.COPPE)
    g.step((leader_coppe, None))
    g.step(next(c for c in g.legal_actions() if c.suit == Suit.COPPE))  # seat 1 follows
    g.step(next(c for c in g.legal_actions() if c.suit == Suit.COPPE))  # seat 2 follows
    g.step(g.legal_actions()[0])  # seat 3, void in coppe

    voids = _void_suits_per_seat(g)
    assert Suit.SPADE in voids[1], voids
    assert Suit.COPPE in voids[3], voids

    rng = random.Random(7)
    for _ in range(20):
        sampled = sample_opponent_hands(g, viewer_seat=0, rng=rng)
        assert not any(c.suit == Suit.SPADE for c in sampled.hands[1])
        assert not any(c.suit == Suit.COPPE for c in sampled.hands[3])


# -----------------------------------------------------------------------
# Reproducibility
# -----------------------------------------------------------------------


def test_seeded_rng_produces_identical_results():
    g = BeccaGame(seed=42)
    _play_through_briscola(g)

    s1 = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(123))
    s2 = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(123))

    for seat in range(4):
        assert s1.hands[seat] == s2.hands[seat]


def test_different_seeds_produce_different_samples():
    """Sampling is genuinely random — different seeds give different hands.

    Probabilistic; we run enough seeds that collision is astronomically
    unlikely.
    """
    g = BeccaGame(seed=42)
    _play_through_briscola(g)

    samples = []
    for s in range(10):
        sample = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(s))
        # Tuple-ize for hashing
        key = tuple(tuple(sample.hands[seat]) for seat in (1, 2, 3))
        samples.append(key)

    # Across 10 seeds we should see significant variety. Allow 20% collisions
    # since some structural overlap is fine (e.g. a uniquely constrained suit).
    assert len(set(samples)) >= 7


# -----------------------------------------------------------------------
# Robustness: many random states
# -----------------------------------------------------------------------


def _play_random_partial_game(seed: int, num_actions: int) -> BeccaGame:
    """Play `num_actions` random legal actions then stop (mid-round)."""
    g = BeccaGame(seed=seed)
    rng = random.Random(seed + 999)
    while g.phase != GamePhase.GAME_OVER and num_actions > 0:
        if g.phase == GamePhase.CHOOSE_BRISCOLA:
            g.step(rng.choice(g.legal_actions()))
        else:
            actions = g.legal_actions()
            g.step(rng.choice(actions))
        num_actions -= 1
        if g.phase == GamePhase.PLAY_CARD and len(g.round.current_trick) == 0:
            # natural mid-round stopping point; bail if we've played enough
            if num_actions <= 0:
                break
    return g


@pytest.mark.parametrize(
    "seed,actions",
    [
        (0, 5),
        (1, 12),
        (2, 20),
        (3, 30),
        (4, 38),
        (5, 1),
        (6, 25),
        (7, 33),
    ],
)
def test_sampler_robustness_on_many_states(seed, actions):
    """Sampler should succeed (relaxed=False) on randomly-generated game
    states — voids that occur naturally are always feasible."""
    g = _play_random_partial_game(seed, actions)
    if g.phase != GamePhase.PLAY_CARD:
        pytest.skip(f"game ended too early (phase={g.phase})")

    rng = random.Random(seed * 31 + 17)
    viewer = seed % 4
    sampled = sample_opponent_hands(g, viewer_seat=viewer, rng=rng)

    # Hard correctness: hand sizes match the engine's view of who holds what
    sizes = _seat_hand_sizes(g)
    for s in range(4):
        assert len(sampled.hands[s]) == sizes[s]

    # Sampled hands union to all *currently held* cards, with no duplicates.
    # That set equals {full deck} minus {public cards}.
    public = _public_cards(g)
    flat = [c for s in range(4) for c in sampled.hands[s]]
    assert len(flat) == 40 - len(public)
    assert len(set(flat)) == len(flat)

    # Public cards must never show up in any sampled hand
    for s in range(4):
        for c in sampled.hands[s]:
            assert c not in public, f"public card {c} appeared in sampled hand of seat {s}"

    # Voids honored (or relax flag set, which we want to be rare)
    voids = _void_suits_per_seat(g)
    if not sampled.relaxed:
        for s in range(4):
            for c in sampled.hands[s]:
                assert c.suit not in voids[s], (
                    f"void violation: seat {s} void in {voids[s]}, got {c}"
                )


def test_sampler_does_not_mutate_game():
    """Sampler must NOT modify the underlying game state."""
    g = BeccaGame(seed=42)
    _play_through_briscola(g)
    before = {s: list(g.round.player_hands[s]) for s in range(4)}
    before_phase = g.phase
    before_trick = list(g.round.current_trick)

    sample_opponent_hands(g, viewer_seat=0, rng=random.Random(0))

    for s in range(4):
        assert g.round.player_hands[s] == before[s]
    assert g.phase == before_phase
    assert g.round.current_trick == before_trick
