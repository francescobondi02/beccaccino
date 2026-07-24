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

    def test_anchor_sampled_with_empty_fifo(self):
        """With no FIFO snapshots yet, sampling from the pool (p_latest=0) must
        still return the anchor — that's the anti-collapse property."""
        pool = OpponentPool(max_size=5, anchors=[{"anchor": True}])
        assert len(pool) == 0  # anchors aren't counted as FIFO entries
        for _ in range(10):
            assert pool.sample(p_latest=0.0) == {"anchor": True}

    def test_anchor_survives_fifo_overflow(self):
        """Anchors are permanent: they remain sampleable after the FIFO churns
        past max_size."""
        pool = OpponentPool(max_size=2, anchors=[{"anchor": 0}])
        for i in range(5):
            pool.add_policy({"step": i})
        assert len(pool) == 2  # FIFO evicted down to max_size
        seen = {tuple(sorted(pool.sample(p_latest=0.0).items())) for _ in range(200)}
        assert (("anchor", 0),) in seen, "anchor no longer reachable after overflow"

    def test_serialize_excludes_anchors(self):
        """serialize() is FIFO-only; anchors are re-seeded at construction."""
        pool = OpponentPool(max_size=5, anchors=[{"anchor": 1}])
        pool.add_policy({"a": 1})
        data = pool.serialize()
        assert data == [{"a": 1}]  # no anchor in the serialized FIFO
        pool2 = OpponentPool.from_serialized(data, max_size=5, anchors=[{"anchor": 1}])
        assert len(pool2) == 1
        assert pool2.anchors == [{"anchor": 1}]


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
