"""Seed-stream and exact vector-resume regression tests."""

from __future__ import annotations

import numpy as np
import torch

from training.checkpoint import restore_rng, rng_state, seed_everything
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import create_network
from training.vec_env import (
    create_vec_env,
    deal_seed,
    learner_team_per_env,
    snapshot_vec_env_state,
)


def test_one_million_worker_resets_have_unique_seeds():
    num_workers = 64
    resets_per_worker = 15_625
    seeds = np.array(
        [
            deal_seed(17, worker, game, num_workers)
            for game in range(resets_per_worker)
            for worker in range(num_workers)
        ],
        dtype=np.int64,
    )

    assert seeds.size == 1_000_000
    assert np.unique(seeds).size == seeds.size


def test_rollouts_keep_live_games_instead_of_resetting_each_window():
    learner = create_network(version=2, hidden_size=32, num_layers=2)
    vec = create_vec_env(num_envs=2, seed=9, win_points=41, sync=True)
    teams = learner_team_per_env(2)
    try:
        collect_self_play_rollout_vec(vec, learner, None, teams, 1, torch.device("cpu"))
        after_first = snapshot_vec_env_state(vec)
        collect_self_play_rollout_vec(vec, learner, None, teams, 1, torch.device("cpu"))
        after_second = snapshot_vec_env_state(vec)
    finally:
        vec.close()

    assert [s["game_count"] for s in after_first["env_states"]] == [1, 1]
    assert [s["game_count"] for s in after_second["env_states"]] == [1, 1]


def test_snapshot_restore_reproduces_rollout_and_deal_stream():
    seed_everything(31)
    learner = create_network(version=2, hidden_size=32, num_layers=2)
    opponent = create_network(**learner.config)
    opponent.load_state_dict(learner.state_dict())
    teams = learner_team_per_env(4)
    vec = create_vec_env(num_envs=4, seed=13, win_points=[5, 41], sync=True)
    try:
        collect_self_play_rollout_vec(vec, learner, opponent, teams, 96, torch.device("cpu"))
        snapshot = snapshot_vec_env_state(vec)
        saved_rng = rng_state()
        uninterrupted = collect_self_play_rollout_vec(
            vec, learner, opponent, teams, 96, torch.device("cpu")
        )
        uninterrupted_state = snapshot_vec_env_state(vec)
    finally:
        vec.close()

    restored = create_vec_env(
        num_envs=4,
        seed=13,
        win_points=[5, 41],
        sync=True,
        rollout_state=snapshot,
    )
    try:
        restore_rng(saved_rng)
        resumed = collect_self_play_rollout_vec(
            restored, learner, opponent, teams, 96, torch.device("cpu")
        )
        resumed_state = snapshot_vec_env_state(restored)
    finally:
        restored.close()

    assert resumed.ptr == uninterrupted.ptr
    assert resumed.collected_steps == uninterrupted.collected_steps
    assert resumed.games_done == uninterrupted.games_done
    for name in (
        "obs",
        "masks",
        "actions",
        "log_probs",
        "values",
        "rewards",
        "dones",
        "seats",
        "env_idx",
    ):
        np.testing.assert_array_equal(
            getattr(resumed, name)[: resumed.ptr],
            getattr(uninterrupted, name)[: uninterrupted.ptr],
            err_msg=name,
        )

    for expected, actual in zip(
        uninterrupted_state["env_states"],
        resumed_state["env_states"],
        strict=True,
    ):
        assert actual["current_seed"] == expected["current_seed"]
        assert actual["game_count"] == expected["game_count"]
        assert actual["deal_fingerprint"] == expected["deal_fingerprint"]


def test_mixed_lengths_and_learner_teams_use_disjoint_streams():
    vec = create_vec_env(num_envs=8, seed=101, win_points=[5, 41], sync=True)
    try:
        vec.reset()
        states = snapshot_vec_env_state(vec)["env_states"]
    finally:
        vec.close()

    teams = learner_team_per_env(8)
    combinations = {(int(teams[i]), states[i]["win_points"]) for i in range(len(states))}
    assert combinations == {(0, 5), (1, 5), (0, 41), (1, 41)}
    assert len({state["current_seed"] for state in states}) == len(states)
