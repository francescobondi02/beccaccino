"""Tests for opponent pool and self-play environment."""

import numpy as np

from training.network import create_network
from training.self_play import OpponentPool
from training.self_play_env import SelfPlayEnv


class TestOpponentPool:
    def test_empty_pool_returns_none(self):
        pool = OpponentPool(max_size=5)
        assert pool.sample(p_latest=0.0) is None

    def test_add_and_sample(self):
        pool = OpponentPool(max_size=3)
        net = create_network(version=1, hidden_size=64, num_layers=1)
        pool.add_policy(net.state_dict())
        assert len(pool) == 1

        # p_latest=0 forces sampling from pool
        result = pool.sample(p_latest=0.0)
        assert result is not None
        assert isinstance(result, dict)

    def test_max_size_eviction(self):
        pool = OpponentPool(max_size=3)
        for i in range(5):
            pool.add_policy({"step": i})
        assert len(pool) == 3
        # Oldest should be evicted
        assert pool.policies[0]["step"] == 2

    def test_serialize_roundtrip(self):
        pool = OpponentPool(max_size=5)
        pool.add_policy({"a": 1})
        pool.add_policy({"b": 2})

        data = pool.serialize()
        pool2 = OpponentPool.from_serialized(data, max_size=5)
        assert len(pool2) == 2
        assert pool2.policies[0] == {"a": 1}


class TestSelfPlayEnv:
    def test_basic_episode_completes(self):
        """SelfPlayEnv should run a full game without crashing."""
        env = SelfPlayEnv(seed=42, win_points=5, learner_team=0, opponent_net=None)
        obs, info = env.reset()

        steps = 0
        done = False
        while not done and steps < 500:
            mask = obs["action_mask"]
            legal = np.where(mask > 0)[0]
            action = int(np.random.choice(legal))
            obs, reward, done, _, info = env.step(action)
            steps += 1

        assert done, "Game did not finish in 500 steps"
        assert steps > 0

    def test_with_neural_opponent(self):
        """SelfPlayEnv should work with a neural network opponent."""
        net = create_network(version=1, hidden_size=64, num_layers=1)
        env = SelfPlayEnv(seed=42, win_points=5, learner_team=0, opponent_net=net)
        obs, _ = env.reset()

        steps = 0
        done = False
        while not done and steps < 500:
            mask = obs["action_mask"]
            legal = np.where(mask > 0)[0]
            action = int(np.random.choice(legal))
            obs, reward, done, _, info = env.step(action)
            steps += 1

        assert done

    def test_only_learner_turns_exposed(self):
        """All observations should be for the learner team's seats."""
        from becca_env.game import TEAM_OF_SEAT

        env = SelfPlayEnv(seed=42, win_points=5, learner_team=0, opponent_net=None)
        obs, _ = env.reset()

        for _ in range(100):
            seat = int(obs["current_seat"])
            if seat < 0:
                break
            assert TEAM_OF_SEAT[seat] == 0, f"Non-learner seat {seat} was exposed"
            mask = obs["action_mask"]
            legal = np.where(mask > 0)[0]
            action = int(np.random.choice(legal))
            obs, _, done, _, _ = env.step(action)
            if done:
                break
