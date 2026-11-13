"""Vectorized environment utilities for parallel self-play."""

from __future__ import annotations

import copy

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


def deal_seed(base_seed: int, worker_id: int, game_index: int, num_workers: int) -> int:
    """Map one worker reset to a globally unique seed within this vector run."""
    return base_seed + worker_id + game_index * num_workers


def make_env(
    seed: int,
    win_points: int = 41,
    trick_shaping_coef: float = 0.0,
    signal_honesty_coef: float = 0.0,
    include_full_obs: bool = True,
    seed_stride: int = 1,
    initial_game_count: int = 0,
):
    """Factory function for creating BeccaEnv instances (required by VectorEnv)."""

    def _init():
        return BeccaEnv(
            seed=seed,
            win_points=win_points,
            trick_shaping_coef=trick_shaping_coef,
            signal_honesty_coef=signal_honesty_coef,
            include_full_obs=include_full_obs,
            seed_stride=seed_stride,
            initial_game_count=initial_game_count,
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
    initial_game_counts: list[int] | None = None,
    rollout_state: dict | None = None,
) -> gym.vector.VectorEnv:
    """Create a vectorized environment with num_envs parallel games.

    Defaults to AsyncVectorEnv (subprocess-based) for actual parallelism.
    Use sync=True only for debugging.
    """
    assigned_win_points = win_points_per_env(num_envs, win_points)
    if initial_game_counts is None:
        initial_game_counts = [0] * num_envs
    if len(initial_game_counts) != num_envs:
        raise ValueError("initial_game_counts length must match num_envs")
    env_fns = [
        make_env(
            seed=seed + i,
            win_points=assigned_win_points[i],
            trick_shaping_coef=trick_shaping_coef,
            signal_honesty_coef=signal_honesty_coef,
            include_full_obs=include_full_obs,
            seed_stride=num_envs,
            initial_game_count=initial_game_counts[i],
        )
        for i in range(num_envs)
    ]

    if sync:
        vec_env = gym.vector.SyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)
    else:
        vec_env = gym.vector.AsyncVectorEnv(env_fns, autoreset_mode=AutoresetMode.SAME_STEP)

    if rollout_state is not None:
        restore_vec_env_state(vec_env, rollout_state)
    return vec_env


def snapshot_vec_env_state(vec_env: gym.vector.VectorEnv) -> dict:
    """Capture worker games plus unfinished rollout transitions."""
    return {
        "version": 1,
        "env_states": list(vec_env.call("export_state")),
        "carry": copy.deepcopy(getattr(vec_env, "_becca_rollout_carry", [])),
    }


def restore_vec_env_state(vec_env: gym.vector.VectorEnv, state: dict) -> None:
    """Restore workers and prime the collector without consuming a reset."""
    if state.get("version") != 1:
        raise ValueError(f"unsupported vector rollout state {state.get('version')}")
    env_states = state["env_states"]
    if len(env_states) != vec_env.num_envs:
        raise ValueError("checkpoint worker count does not match vector environment")
    vec_env.set_attr("_restore_state", env_states)
    vec_env.call("restore_state")
    observations = vec_env.call("current_observation")
    vec_env._becca_rollout_obs = {
        key: np.stack([obs[key] for obs in observations]) for key in observations[0]
    }
    vec_env._becca_rollout_carry = copy.deepcopy(state.get("carry", []))
