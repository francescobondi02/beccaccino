"""Tests for self-play rollout with separate learner / opponent policies."""

from __future__ import annotations

import numpy as np
import pytest
import torch

from becca_env.game import TEAM_OF_SEAT
from becca_env.observation import FULL_STATE_SIZE
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import CentralizedCritic, create_network
from training.vec_env import create_vec_env, learner_team_per_env, win_points_per_env


def _make_nets():
    learner = create_network(version=2, hidden_size=64, num_layers=2)
    opponent = create_network(version=2, hidden_size=64, num_layers=2)
    return learner, opponent


def test_mixed_win_points_are_balanced_across_learner_teams():
    assert win_points_per_env(4, 5) == [5, 5, 5, 5]
    # Pair the two REAL production assignments (team split and win-point stride)
    # so the guard breaks if either side drifts — a confound between them is
    # exactly the failure this test exists to catch.
    assigned = win_points_per_env(64, [5, 41])
    teams = learner_team_per_env(64)
    pairs = [(int(team), win_points) for team, win_points in zip(teams, assigned)]
    assert set(pairs) == {(0, 5), (1, 5), (0, 41), (1, 41)}
    assert {pair: pairs.count(pair) for pair in set(pairs)} == {
        (0, 5): 16,
        (1, 5): 16,
        (0, 41): 16,
        (1, 41): 16,
    }


def test_only_learner_team_transitions_stored():
    """Buffer must contain only seats belonging to that env's learner team."""
    num_envs = 4
    learner_team = np.array([0, 1, 0, 1], dtype=np.int64)

    learner, opponent = _make_nets()
    vec = create_vec_env(num_envs=num_envs, seed=7, win_points=5, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=200,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()

    n = buf.ptr
    assert n > 0, "no transitions stored"
    for t in range(n):
        env = int(buf.env_idx[t])
        seat = int(buf.seats[t])
        expected_team = int(learner_team[env])
        assert TEAM_OF_SEAT[seat] == expected_team, (
            f"transition {t}: env={env} seat={seat} (team {TEAM_OF_SEAT[seat]}) "
            f"but env's learner_team={expected_team}"
        )


def test_buffer_size_roughly_half_of_worst_case():
    """Since opponent plays ~half the turns, buffer should fill ~half."""
    num_envs = 4
    learner_team = np.zeros(num_envs, dtype=np.int64)
    learner, opponent = _make_nets()
    vec = create_vec_env(num_envs=num_envs, seed=2, win_points=5, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=400,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()

    n = buf.ptr
    worst = 400 * num_envs
    # Expect roughly half (between 30% and 70%)
    assert 0.3 * worst < n < 0.7 * worst, f"got {n}/{worst} learner transitions"


def test_works_with_none_opponent():
    """opponent_net=None → use learner for opponent (vanilla self-play)."""
    num_envs = 2
    learner_team = np.zeros(num_envs, dtype=np.int64)
    learner, _ = _make_nets()
    vec = create_vec_env(num_envs=num_envs, seed=3, win_points=5, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            None,
            learner_team,
            steps_per_env=100,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()
    assert buf.ptr > 0


def test_critic_requires_full_observation_key():
    learner, opponent = _make_nets()
    vec = create_vec_env(
        num_envs=2,
        seed=3,
        win_points=5,
        sync=True,
        include_full_obs=False,
    )
    try:
        with pytest.raises(AssertionError, match="include_full_obs=True"):
            collect_self_play_rollout_vec(
                vec,
                learner,
                opponent,
                np.zeros(2, dtype=np.int64),
                steps_per_env=1,
                device=torch.device("cpu"),
                critic=object(),
            )
    finally:
        vec.close()


def test_centralized_critic_batch_trims_each_live_learner_chain_tail():
    num_envs = 4
    learner_team = np.array([0, 1, 0, 1], dtype=np.int64)
    learner, opponent = _make_nets()
    critic = CentralizedCritic(FULL_STATE_SIZE, hidden_size=64, num_layers=2)
    vec = create_vec_env(
        num_envs=num_envs,
        seed=3,
        win_points=41,
        sync=True,
        include_full_obs=True,
    )
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=16,
            device=torch.device("cpu"),
            critic=critic,
        )
    finally:
        vec.close()

    stored = buf.ptr
    batch = buf.get_batch()

    assert buf.ptr == stored
    assert batch["obs"].shape[0] == stored - (num_envs * 2)
    assert batch["full_obs"].shape[0] == batch["obs"].shape[0]


def test_terminal_residuals_credited_to_learner_only():
    """When a game ends, learner-team residuals must reach the buffer; opponent
    shares must NOT be silently mixed in.

    Invariant: average per-game total reward across the buffer should be small
    (within a couple of multiples of 1.0 per game) — if opponent rewards leaked
    in, we'd see big sign-error blowups."""
    num_envs = 4
    learner_team = np.array([0, 0, 1, 1], dtype=np.int64)
    learner, opponent = _make_nets()
    vec = create_vec_env(num_envs=num_envs, seed=42, win_points=5, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=400,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()

    n = buf.ptr
    games = int(buf.dones[:n].sum())
    if games == 0:
        return
    total = float(buf.rewards[:n].sum())
    avg = total / games
    # Each game contributes one terminal ±1.0 to each of the 2 learner seats
    # plus round-end shaping. |avg| should comfortably stay under ~3.
    assert abs(avg) < 3.0, f"avg per-game learner reward suspicious: {avg}"


def test_buffer_env_idx_seat_matches_per_env_team():
    """All env_idx entries should be in [0, num_envs); seats consistent."""
    num_envs = 6
    learner_team = np.array([0, 1, 0, 1, 0, 1], dtype=np.int64)
    learner, opponent = _make_nets()
    vec = create_vec_env(num_envs=num_envs, seed=11, win_points=5, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=150,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()

    n = buf.ptr
    assert n > 0
    assert buf.env_idx[:n].min() >= 0
    assert buf.env_idx[:n].max() < num_envs
    # All seats valid {0..3}
    assert buf.seats[:n].min() >= 0
    assert buf.seats[:n].max() < 4


def test_round_rewards_stay_on_card_actions_for_both_learner_teams():
    learner_team = np.array([0, 1], dtype=np.int64)
    learner, opponent = _make_nets()
    vec = create_vec_env(num_envs=2, seed=19, win_points=99, sync=True)
    try:
        buf = collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_team,
            steps_per_env=120,
            device=torch.device("cpu"),
        )
    finally:
        vec.close()

    rewarded = np.flatnonzero(np.abs(buf.rewards[: buf.ptr]) > 1e-9)
    assert rewarded.size > 0
    assert {int(buf.env_idx[index]) for index in rewarded} == {0, 1}
    for index in rewarded:
        mask = buf.masks[index]
        is_briscola_choice = mask[:4].sum() == 4 and mask[4:].sum() == 0
        assert not is_briscola_choice
