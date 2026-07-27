"""Vectorized environment utilities for parallel self-play."""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium.vector import AutoresetMode

from becca_env.env import BeccaEnv


def learner_team_per_env(num_envs: int) -> np.ndarray:
    """Alternate the learner team by env so both teams get equal experience."""
    return np.array([index % 2 for index in range(num_envs)], dtype=np.int64)


def win_points_per_env(num_envs: int, win_points: int | list[int]) -> list[int]:
    """Assign game lengths in team-balanced env pairs.

    The `index // 2` stride is deliberately paired with the `index % 2` team
    split in `learner_team_per_env`: it holds the win-point value constant across
    each consecutive (team-0, team-1) env pair, so every (learner_team, win_points)
    combination is covered equally. A naive `index % len` would alias with the team
    split and, for a 2-value mix, train each team on only one game length.
    """
    if isinstance(win_points, int):
        values = [win_points]
    else:
        values = list(win_points)
    if not values or any(value <= 0 for value in values):
        raise ValueError("win_points must contain positive values")
    return [values[(index // 2) % len(values)] for index in range(num_envs)]


def make_env(
    seed: int,
    win_points: int = 41,
    trick_shaping_coef: float = 0.0,
    signal_honesty_coef: float = 0.0,
    include_full_obs: bool = True,
):
    """Factory function for creating BeccaEnv instances (required by VectorEnv)."""

    def _init():
        return BeccaEnv(
            seed=seed,
            win_points=win_points,
            trick_shaping_coef=trick_shaping_coef,
            signal_honesty_coef=signal_honesty_coef,
            include_full_obs=include_full_obs,
        )

    return _init


def create_vec_env(
    num_envs: int = 64,
    seed: int = 0,
    win_points: int | list[int] = 41,
    sync: bool = False,
    trick_shaping_coef: float = 0.0,
    signal_honesty_coef: float = 0.0,
    include_full_obs: bool = True,
) -> gym.vector.VectorEnv:
    """Create a vectorized environment with num_envs parallel games.

    Defaults to AsyncVectorEnv (subprocess-based) for actual parallelism.
    Use sync=True only for debugging.
    """
    assigned_win_points = win_points_per_env(num_envs, win_points)
    env_fns = [
        make_env(
            seed=seed + i,
            win_points=assigned_win_points[i],
            trick_shaping_coef=trick_shaping_coef,
            signal_honesty_coef=signal_honesty_coef,
            include_full_obs=include_full_obs,
        )
        for i in range(num_envs)
    ]

    if sync:
        return gym.vector.SyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)
    else:
        return gym.vector.AsyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)
