"""Vectorized environment utilities for parallel self-play."""

from __future__ import annotations

import gymnasium as gym
from gymnasium.vector import AutoresetMode

from becca_env.env import BeccaEnv


def make_env(seed: int, win_points: int = 41, trick_shaping_coef: float = 0.0):
    """Factory function for creating BeccaEnv instances (required by VectorEnv)."""
    def _init():
        return BeccaEnv(seed=seed, win_points=win_points,
                        trick_shaping_coef=trick_shaping_coef)
    return _init


def create_vec_env(
    num_envs: int = 64,
    seed: int = 0,
    win_points: int = 41,
    sync: bool = False,
    trick_shaping_coef: float = 0.0,
) -> gym.vector.VectorEnv:
    """Create a vectorized environment with num_envs parallel games.

    Defaults to AsyncVectorEnv (subprocess-based) for actual parallelism.
    Use sync=True only for debugging.
    """
    env_fns = [make_env(seed + i, win_points, trick_shaping_coef) for i in range(num_envs)]

    if sync:
        return gym.vector.SyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)
    else:
        return gym.vector.AsyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)
