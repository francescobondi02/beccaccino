"""The promoted Kaggle policy keeps its training inputs and online legal moves."""

from copy import deepcopy

import numpy as np

from becca_env.deck import Suit
from becca_env.game import BeccaGame, GamePhase
from becca_env.kaggle_observation import OBS_SIZE
from becca_env.observation import encode_observation
from serving.state_adapter import game_to_state_dict, state_dict_to_game
from serving.tiers import get_agent


def test_kaggle_policy_matches_wire_state_through_a_full_match():
    agent = get_agent("forte")
    game = BeccaGame(seed=7, win_points=41)
    decisions = 0
    while game.phase != GamePhase.GAME_OVER:
        seat = game.current_seat
        online = state_dict_to_game(game_to_state_dict(game, seat))
        np.testing.assert_array_equal(
            encode_observation(game, seat, obs_size=OBS_SIZE),
            encode_observation(online, seat, obs_size=OBS_SIZE),
        )
        action = agent.select_action(online, seat)
        assert action in game.legal_actions()
        game.step(action)
        decisions += 1
    assert decisions > 40


def test_kaggle_observation_preserves_history_without_exposing_other_hands():
    game = BeccaGame(seed=3)
    game.step(Suit.DENARA)
    for _ in range(8):
        game.step(game.legal_actions()[0])
    seat = game.current_seat
    original = encode_observation(game, seat, obs_size=OBS_SIZE)
    other = deepcopy(game)
    left, right = (seat + 1) % 4, (seat + 3) % 4
    hands = other.round.player_hands
    hands[left], hands[right] = hands[right], hands[left]
    np.testing.assert_array_equal(original, encode_observation(other, seat, obs_size=OBS_SIZE))
    other.round.tricks_played.reverse()
    assert not np.array_equal(original, encode_observation(other, seat, obs_size=OBS_SIZE))


def test_kaggle_cricca_survives_backend_state_conversion():
    game = BeccaGame(seed=3)
    game.step(Suit.DENARA)
    game.round.cricca = True
    seat = game.current_seat
    online = state_dict_to_game(game_to_state_dict(game, seat))
    assert online.round.cricca is True
    np.testing.assert_array_equal(
        encode_observation(game, seat, obs_size=OBS_SIZE),
        encode_observation(online, seat, obs_size=OBS_SIZE),
    )
