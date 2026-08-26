"""Tests for the signalling convention and its reward shaping.

The property that matters is the ASYMMETRY: a declared signal is rewarded or
punished by its honesty, but silence is always free. If silence ever became
costly, the shaping would be dictating *whether* to signal instead of only what a
signal means — which is the strategy question we want the round score to answer.
"""

from __future__ import annotations

import numpy as np

from becca_env.deck import Card, Suit, Value
from becca_env.env import BeccaEnv
from becca_env.game import BeccaGame, GamePhase, Signal
from becca_env.observation import CARD_INDEX
from becca_env.signals import honest_signal_for, signal_is_honest

SIGNAL_COEF = 0.05


def _card(value: Value, suit: Suit) -> Card:
    return Card(suit=suit, value=value)


# --------------------------- the convention ---------------------------


def test_volo_is_honest_only_when_void():
    assert signal_is_honest(Signal.VOLO, [], Suit.DENARA)
    assert signal_is_honest(Signal.VOLO, [_card(Value.ASSO, Suit.COPPE)], Suit.DENARA)
    assert not signal_is_honest(Signal.VOLO, [_card(Value.QUATTRO, Suit.DENARA)], Suit.DENARA)


def test_busso_needs_a_card_that_can_win_the_suit():
    """Asso is the floor: re/cavallo/fante carry points but lose to asso/due/tre."""
    for value in (Value.ASSO, Value.DUE, Value.TRE):
        assert signal_is_honest(Signal.BUSSO, [_card(value, Suit.SPADE)], Suit.SPADE)
    for value in (Value.RE, Value.CAVALLO, Value.FANTE, Value.QUATTRO):
        assert not signal_is_honest(Signal.BUSSO, [_card(value, Suit.SPADE)], Suit.SPADE)


def test_busso_ignores_strength_in_other_suits():
    assert not signal_is_honest(Signal.BUSSO, [_card(Value.TRE, Suit.COPPE)], Suit.SPADE)


def test_striscio_requires_three_cards_in_suit_without_strength():
    played = _card(Value.QUATTRO, Suit.BASTONI)
    two_card_suit = [played, _card(Value.CINQUE, Suit.BASTONI)]
    assert not signal_is_honest(Signal.STRISCIO, two_card_suit[1:], played.suit)

    three_card_suit = [*two_card_suit, _card(Value.SEI, Suit.BASTONI)]
    assert signal_is_honest(Signal.STRISCIO, three_card_suit[1:], played.suit)


def test_honest_signal_for_never_contradicts_the_audit():
    """Whatever the teacher declares must pass the same check that grades it."""
    hands = [
        [],
        [_card(Value.ASSO, Suit.DENARA)],
        [_card(Value.QUATTRO, Suit.DENARA)],
        [_card(Value.QUATTRO, Suit.DENARA), _card(Value.CINQUE, Suit.DENARA)],
        [_card(Value.TRE, Suit.DENARA), _card(Value.SEI, Suit.DENARA)],
        [_card(Value.ASSO, Suit.COPPE)],
    ]
    for hand in hands:
        signal = honest_signal_for(hand, Suit.DENARA)
        if signal is not None:
            assert signal_is_honest(signal, hand, Suit.DENARA), (hand, signal)


def test_honest_signal_prefers_void_then_strength_then_length():
    assert honest_signal_for([], Suit.DENARA) is Signal.VOLO
    strong_and_long = [_card(Value.ASSO, Suit.DENARA), _card(Value.SEI, Suit.DENARA)]
    assert honest_signal_for(strong_and_long, Suit.DENARA) is Signal.BUSSO
    only_long = [_card(Value.QUATTRO, Suit.DENARA), _card(Value.SEI, Suit.DENARA)]
    assert honest_signal_for(only_long, Suit.DENARA) is Signal.STRISCIO


def test_honest_signal_is_none_when_no_claim_holds():
    """One weak card left: not void, not strong, not long — nothing truthful to say."""
    assert honest_signal_for([_card(Value.QUATTRO, Suit.DENARA)], Suit.DENARA) is None


# --------------------------- reward shaping ---------------------------


def _lead_with(env: BeccaEnv, signal: Signal | None) -> float:
    """Drive `env` to a fresh trick lead and play its first legal card with
    `signal`. Returns the reward for that step.

    Leads are forced from a deterministic position rather than a lucky seed: the
    first card play of a round IS a lead, so reset + choose briscola gets us there.
    """
    obs, _ = env.reset()
    assert env.game.phase == GamePhase.CHOOSE_BRISCOLA
    briscola_action = int(np.where(obs["action_mask"] > 0)[0][0])
    obs, _, _, _, _ = env.step(briscola_action)

    seat = env.game.current_seat
    assert not env.game.round.current_trick, "expected to be on a trick lead"
    card = env.game.get_hand(seat)[0]
    signal_idx = 0 if signal is None else list(Signal).index(signal) + 1
    action = CARD_INDEX[card] * 4 + signal_idx
    assert obs["action_mask"][action] > 0, "constructed action must be legal"
    _, reward, _, _, _ = env.step(action)
    return reward


def _honest_and_dishonest_for(env: BeccaEnv) -> tuple[Signal, Signal]:
    """Pick a signal that IS honest for this env's first lead and one that isn't."""
    probe = BeccaEnv(seed=env._base_seed, win_points=5)
    obs, _ = probe.reset()
    probe.step(int(np.where(obs["action_mask"] > 0)[0][0]))
    seat = probe.game.current_seat
    card = probe.game.get_hand(seat)[0]
    after = [c for c in probe.game.get_hand(seat) if c != card]
    honest = next(s for s in Signal if signal_is_honest(s, after, card.suit))
    dishonest = next(s for s in Signal if not signal_is_honest(s, after, card.suit))
    return honest, dishonest


def test_honest_signal_earns_the_coefficient():
    seed = 5
    honest, _ = _honest_and_dishonest_for(BeccaEnv(seed=seed, win_points=5))
    shaped = _lead_with(BeccaEnv(seed=seed, win_points=5, signal_honesty_coef=SIGNAL_COEF), honest)
    baseline = _lead_with(BeccaEnv(seed=seed, win_points=5), honest)
    assert shaped - baseline == SIGNAL_COEF


def test_dishonest_signal_is_penalised_by_the_coefficient():
    seed = 5
    _, dishonest = _honest_and_dishonest_for(BeccaEnv(seed=seed, win_points=5))
    shaped = _lead_with(
        BeccaEnv(seed=seed, win_points=5, signal_honesty_coef=SIGNAL_COEF), dishonest
    )
    baseline = _lead_with(BeccaEnv(seed=seed, win_points=5), dishonest)
    assert shaped - baseline == -SIGNAL_COEF


def test_silence_is_never_shaped():
    """The asymmetry: not signalling must cost exactly nothing, or the shaping
    would be deciding whether to signal instead of what a signal means."""
    seed = 5
    shaped = _lead_with(BeccaEnv(seed=seed, win_points=5, signal_honesty_coef=SIGNAL_COEF), None)
    baseline = _lead_with(BeccaEnv(seed=seed, win_points=5), None)
    assert shaped == baseline


def test_coefficient_zero_disables_shaping_entirely():
    seed = 5
    honest, dishonest = _honest_and_dishonest_for(BeccaEnv(seed=seed, win_points=5))
    for signal in (honest, dishonest, None):
        off = _lead_with(BeccaEnv(seed=seed, win_points=5, signal_honesty_coef=0.0), signal)
        baseline = _lead_with(BeccaEnv(seed=seed, win_points=5), signal)
        assert off == baseline, signal


def test_followers_are_never_shaped():
    """Only the leader may signal; a follower's action carries signal=None, so no
    follower can ever be credited or debited."""
    env = BeccaEnv(seed=3, win_points=5, signal_honesty_coef=SIGNAL_COEF)
    obs, _ = env.reset()
    env.step(int(np.where(obs["action_mask"] > 0)[0][0]))
    obs = env._get_obs()
    for _ in range(60):
        was_lead = not env.game.round.current_trick
        legal = np.where(obs["action_mask"] > 0)[0]
        obs, _, term, _, info = env.step(int(legal[0]))
        if not was_lead:
            assert info.get("signal") is None
        if term:
            break


def test_set_signal_honesty_coef_runtime():
    """The coef is annealed mid-run, so it must be settable after construction."""
    env = BeccaEnv(seed=1, win_points=5)
    assert env.signal_honesty_coef == 0.0
    env.set_signal_honesty_coef(0.05)
    assert env.signal_honesty_coef == 0.05


# --------------------------- the BC teacher ---------------------------


def test_heuristic_is_silent_by_default_so_the_yardstick_is_unchanged():
    """evaluate_against_heuristic must keep comparing against the same opponent
    it always did, or every historical win-rate number becomes incomparable."""
    from evaluation.heuristic import HeuristicAgent

    agent = HeuristicAgent(seed=0)
    game = BeccaGame(seed=1)
    leads = 0
    while game.phase != GamePhase.GAME_OVER:
        seat = game.current_seat
        is_lead = game.phase == GamePhase.PLAY_CARD and not game.round.current_trick
        action = agent.select_action(game, seat)
        if is_lead:
            leads += 1
            assert action[1] is None
        game.step(action)
    assert leads > 0, "test played no leads; it would pass vacuously"


def test_heuristic_signals_honestly_when_enabled():
    from evaluation.heuristic import HeuristicAgent

    agent = HeuristicAgent(seed=0, declare_signals=True)
    game = BeccaGame(seed=1)
    declared = 0
    while game.phase != GamePhase.GAME_OVER:
        seat = game.current_seat
        is_lead = game.phase == GamePhase.PLAY_CARD and not game.round.current_trick
        action = agent.select_action(game, seat)
        if not is_lead:
            game.step(action)
            continue
        card, signal = action
        game.step(action)
        if signal is not None:
            declared += 1
            assert signal_is_honest(signal, game.get_hand(seat), card.suit), (
                f"teacher declared {signal} dishonestly"
            )
    assert declared > 0, "teacher declared nothing; the test would pass vacuously"
