"""Tests for the Gymnasium environment wrapper."""

import numpy as np

from becca_env.env import BeccaEnv
from becca_env.observation import OBS_SIZE


class TestBeccaEnv:
    def test_reset_returns_valid_obs(self):
        env = BeccaEnv(seed=1)
        obs, info = env.reset()
        assert obs["obs"].shape == (OBS_SIZE,)
        assert obs["action_mask"].shape == (160,)
        assert obs["action_mask"].sum() > 0  # at least one legal action

    def test_step_returns_correct_shapes(self):
        env = BeccaEnv(seed=1)
        obs, info = env.reset()

        # Find a legal action
        mask = obs["action_mask"]
        action = int(np.where(mask > 0)[0][0])

        obs2, reward, terminated, truncated, info2 = env.step(action)
        assert obs2["obs"].shape == (OBS_SIZE,)
        assert isinstance(reward, float)
        assert isinstance(terminated, bool)
        assert not truncated

    def test_full_game_terminates(self):
        env = BeccaEnv(seed=42, win_points=5)
        obs, _ = env.reset()
        steps = 0
        max_steps = 10000

        while steps < max_steps:
            mask = obs["action_mask"]
            legal = np.where(mask > 0)[0]
            action = int(legal[0])
            obs, reward, terminated, truncated, info = env.step(action)
            steps += 1
            if terminated:
                break

        assert terminated, f"Game didn't terminate after {max_steps} steps"
        assert steps > 10  # A game has at least 10 tricks + 1 briscola choice

    def test_illegal_action_raises(self):
        env = BeccaEnv(seed=1)
        obs, _ = env.reset()
        mask = obs["action_mask"]
        illegal = np.where(mask == 0)[0]
        if len(illegal) > 0:
            try:
                env.step(int(illegal[0]))
                assert False, "Should have raised"
            except (ValueError, IndexError):
                pass

    def test_reward_at_game_end(self):
        env = BeccaEnv(seed=42, win_points=5)
        obs, _ = env.reset()
        total_reward = 0.0

        while True:
            mask = obs["action_mask"]
            action = int(np.where(mask > 0)[0][0])
            obs, reward, terminated, _, info = env.step(action)
            total_reward += reward
            if terminated:
                break

        # There should be non-zero rewards during the game
        assert total_reward != 0.0
