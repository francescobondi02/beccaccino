"""Parity: a game round-tripped through the wire format must encode identically.

This locks `serving.state_adapter` to the training-time encoder: if the DTO
drops or reorders anything `encode_observation` reads, the encoded vectors
diverge and these tests fail.

Scope, stated honestly: this covers the PYTHON adapter only. The TypeScript
serializer never enters this loop, so a backend that sends wrong scores or a
truncated round would still pass here. The committed fixture consumer in the
backend closes that cross-language gap.
"""

from __future__ import annotations

import numpy as np
import pytest

from becca_env.deck import Card, Suit, Value
from becca_env.game import BeccaGame, GamePhase, Signal
from becca_env.observation import decode_action, encode_action_mask, encode_observation
from serving.state_adapter import (
    StateAdapterError,
    game_to_state_dict,
    state_dict_to_game,
)

RANDOM_GAMES = 12
GAME_SEED_BASE = 909
MAX_STEPS_PER_GAME = 400  # safety stop; a full game is well under this


def assert_round_trip_identical(game: BeccaGame, seat: int) -> None:
    """The core invariant: rebuild from the DTO, and every encoder output matches."""
    rebuilt = state_dict_to_game(game_to_state_dict(game, seat))

    np.testing.assert_array_equal(
        encode_observation(rebuilt, seat),
        encode_observation(game, seat),
        err_msg=f"observation diverged for seat {seat}",
    )
    np.testing.assert_array_equal(
        encode_action_mask(rebuilt, seat),
        encode_action_mask(game, seat),
        err_msg=f"action mask diverged for seat {seat}",
    )
    assert rebuilt.current_seat == game.current_seat


def _play_random_game(seed: int):
    """Yield (game, acting_seat) at every decision point of one random game."""
    game = BeccaGame(seed=seed)
    rng = np.random.default_rng(seed)

    for _ in range(MAX_STEPS_PER_GAME):
        if game.phase not in (GamePhase.CHOOSE_BRISCOLA, GamePhase.PLAY_CARD):
            return
        yield game, game.current_seat
        actions = game.legal_actions()
        game.step(actions[rng.integers(len(actions))])


@pytest.mark.parametrize("seed", range(GAME_SEED_BASE, GAME_SEED_BASE + RANDOM_GAMES))
def test_round_trip_at_every_decision_point(seed):
    """Sweep real self-play positions: briscola choice, leads, follows, all seats."""
    checked = 0
    for game, seat in _play_random_game(seed):
        assert_round_trip_identical(game, seat)
        checked += 1
    assert checked > 10, f"game {seed} yielded only {checked} decision points"


def test_round_trip_preserves_every_viewer_perspective():
    """The relative-seat rows (left opp / partner / right opp) must survive.

    Encoding from all four seats at the same position catches a rotation that is
    self-consistent for one viewer but wrong for the others.
    """
    for game, _ in _play_random_game(GAME_SEED_BASE):
        for seat in range(4):
            assert_round_trip_identical(game, seat)


def _game_with_signal_and_void() -> tuple[BeccaGame, int]:
    """Build a position that exercises the signal mask AND a known void.

    Hand-built rather than random: a random game rarely produces a declared
    signal plus a provable void early enough to be a reliable fixture, and these
    two blocks (offsets 434 and 450) are exactly what a lazy DTO would drop.
    """
    game = BeccaGame(seed=GAME_SEED_BASE)
    game.step(Suit.DENARA)  # briscola

    leader = game.current_seat
    hand = game.round.player_hands[leader]
    lead_card = next(c for c in hand if c.suit != Suit.DENARA)

    game.step((lead_card, Signal.BUSSO))

    # Walk the rest of the trick; whoever cannot follow becomes provably void.
    while game.round.current_trick:
        game.step(game.legal_actions()[0])

    return game, game.current_seat


def test_signal_and_void_blocks_survive_round_trip():
    game, seat = _game_with_signal_and_void()

    obs = encode_observation(game, seat)
    signal_block = obs[450:462]
    assert signal_block.any(), "fixture is not exercising the signal mask"

    for viewer in range(4):
        assert_round_trip_identical(game, viewer)


def test_decoded_action_agrees_across_round_trip():
    """A chosen action index must mean the same move on both game objects."""
    for game, seat in _play_random_game(GAME_SEED_BASE + 1):
        rebuilt = state_dict_to_game(game_to_state_dict(game, seat))
        mask = encode_action_mask(game, seat)
        for action_idx in np.flatnonzero(mask):
            assert decode_action(int(action_idx), rebuilt) == decode_action(int(action_idx), game)
        break  # one position is enough; the mask itself is compared everywhere else


def test_scores_cross_the_wire_as_raw_points():
    """Scores must round-trip in RAW units, which is what the encoder normalizes.

    Guards the backend-facing contract: Prisma stores real points and a figures
    remainder separately, so the serializer must send points*3 + figures.
    """
    game = BeccaGame(seed=GAME_SEED_BASE)
    game.total_scores = {0: 37, 1: 14}  # raw; 37 = 12 real points + 1 figure

    state = game_to_state_dict(game, seat=0)
    assert state["total_scores"] == {"0": 37, "1": 14}
    assert state_dict_to_game(state).total_scores == {0: 37, 1: 14}


def test_dropping_figures_remainder_is_detectable():
    """A serializer that sends real points instead of raw must not go unnoticed."""
    game = BeccaGame(seed=GAME_SEED_BASE)
    game.total_scores = {0: 37, 1: 14}
    faithful = encode_observation(game, 0)

    lossy = game_to_state_dict(game, seat=0)
    lossy["total_scores"] = {"0": 37 // 3, "1": 14 // 3}  # the bug: points, not raw

    assert not np.array_equal(encode_observation(state_dict_to_game(lossy), 0), faithful)


def test_truncated_round_is_detectable():
    """Sending only the latest trick must change the observation, not pass silently."""
    game, seat = _game_with_signal_and_void()
    faithful = encode_observation(game, seat)

    truncated = game_to_state_dict(game, seat)
    truncated["completed_tricks"] = []

    assert not np.array_equal(encode_observation(state_dict_to_game(truncated), seat), faithful)


def test_rotated_signal_seat_is_detectable():
    """An off-by-one seat on the signal history must change the observation."""
    game, seat = _game_with_signal_and_void()
    faithful = encode_observation(game, seat)

    rotated = game_to_state_dict(game, seat)
    signalling = [t for t in rotated["completed_tricks"] if t["signal_seat"] is not None]
    assert signalling, "fixture has no signal to rotate"
    for trick in signalling:
        trick["signal_seat"] = (trick["signal_seat"] + 1) % 4

    assert not np.array_equal(encode_observation(state_dict_to_game(rotated), seat), faithful)


def test_suit_strings_resolve_independently_of_prisma_order():
    """The spade/coppe guard: strings must map to Python's own ordinals.

    Prisma orders suits denara, coppe, spade, bastoni; Python orders them
    denara, spade, coppe, bastoni. Resolving by string keeps them aligned.
    """
    assert Suit("spade") is Suit.SPADE
    assert Suit("coppe") is Suit.COPPE

    prisma_order = ["denara", "coppe", "spade", "bastoni"]
    python_order = [s.value for s in Suit]
    assert prisma_order != python_order, "guard is obsolete: enum orders now agree"


@pytest.mark.parametrize(
    "mutate, expected_message",
    [
        (lambda s: s.pop("hands"), "hands"),
        (lambda s: s.__setitem__("phase", "game_over"), "cannot act"),
        (lambda s: s["hands"].pop("2"), "missing hands"),
        (lambda s: s["hands"]["0"].append({"suit": "quadri", "value": "asso"}), "bad card"),
    ],
)
def test_malformed_state_is_rejected_loudly(mutate, expected_message):
    """Bad input must raise, never silently produce a plausible-but-wrong board."""
    game = BeccaGame(seed=GAME_SEED_BASE)
    state = game_to_state_dict(game, seat=game.current_seat)
    mutate(state)

    with pytest.raises((StateAdapterError, KeyError), match=expected_message):
        state_dict_to_game(state)


def test_completed_trick_winner_is_recomputed_not_trusted():
    """We derive trick winners from cards, so a wrong claimed winner cannot poison us."""
    game, seat = _game_with_signal_and_void()
    state = game_to_state_dict(game, seat)

    # The DTO carries no winner field at all — that is the point.
    assert "winner" not in state["completed_tricks"][0]

    rebuilt = state_dict_to_game(state)
    assert rebuilt.round.tricks_played[0].winner == game.round.tricks_played[0].winner


def test_unfinished_trick_cannot_be_sent_as_completed():
    game = BeccaGame(seed=GAME_SEED_BASE)
    game.step(Suit.DENARA)
    state = game_to_state_dict(game, seat=game.current_seat)
    state["completed_tricks"] = [{"cards": [{"seat": 0, "suit": "denara", "value": "asso"}]}]

    with pytest.raises(StateAdapterError, match="expected 4"):
        state_dict_to_game(state)


def test_card_dto_uses_lowercase_enum_strings():
    """Matches Prisma's lowercase enums, so the backend needs no case mapping."""
    game = BeccaGame(seed=GAME_SEED_BASE)
    card = Card(Suit.SPADE, Value.CAVALLO)
    game.round.player_hands[0] = [card]

    dto = game_to_state_dict(game, seat=0)["hands"]["0"][0]
    assert dto == {"suit": "spade", "value": "cavallo"}
