"""Vectorized environment utilities for parallel self-play."""

from __future__ import annotations

import gymnasium as gym

from becca_env.env import BeccaEnv


def make_env(seed: int, win_points: int = 41):
    """Factory function for creating BeccaEnv instances (required by VectorEnv)."""
    def _init():
        return BeccaEnv(seed=seed, win_points=win_points)
    return _init


def create_vec_env(
    num_envs: int = 8,
    seed: int = 0,
    win_points: int = 41,
    sync: bool = False,
) -> gym.vector.VectorEnv:
    """Create a vectorized environment with num_envs parallel games.

    Args:
        num_envs: number of parallel environments
        seed: base seed (each env gets seed + i)
        win_points: game win threshold
        sync: if True, use SyncVectorEnv (no subprocess overhead, good for debugging)

    Returns:
        Gymnasium VectorEnv running num_envs games in parallel
    """
    env_fns = [make_env(seed + i, win_points) for i in range(num_envs)]

    if sync:
        return gym.vector.SyncVectorEnv(env_fns)
    else:
        return gym.vector.AsyncVectorEnv(env_fns)
