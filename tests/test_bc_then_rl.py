"""Smoke tests for the bc_then_rl RL phase parity features.

Kept tiny (few updates, tiny V4, CPU). They verify the plumbing the overnight
Kaggle run depends on — critic, anchors, resumable last.pt, --max-hours,
already-complete resume — not learning.
"""

from __future__ import annotations

import argparse
import csv

import pytest
import torch

from becca_env.observation import FULL_STATE_SIZE
from scripts import bc_then_rl
from scripts.bc_then_rl import (
    _load_resume_components,
    _reconcile_metrics_csv,
    _resolve_anchors,
    _validate_resume_contract,
    parse_args,
    phase2_rl,
)
from training.checkpoint import (
    CheckpointIntegrityError,
    load_checkpoint,
    rng_state,
    save_checkpoint,
    save_checkpoint_payload,
)
from training.config import TrainConfig
from training.network import CentralizedCritic, create_network
from training.vec_env import create_vec_env, snapshot_vec_env_state


def _args(tmp_path, **overrides) -> argparse.Namespace:
    """A parsed-args namespace for a tiny V4 RL phase."""
    import sys

    argv = [
        "prog",
        "--network-version",
        "4",
        "--d-model",
        "32",
        "--nhead",
        "2",
        "--layers",
        "2",
        "--dim-feedforward",
        "64",
        "--total-rl-steps",
        "2048",
        "--num-envs",
        "4",
        "--steps-per-env",
        "128",
        "--win-points",
        "5",
        "--eval-win-points",
        "5",
        "--eval-every",
        "1000",
        "--eval-games",
        "6",
        "--pool-save-every",
        "1",
        "--save-last-every",
        "1",
        "--device",
        "cpu",
        "--out-dir",
        str(tmp_path / "run"),
        "--bc-ckpt",
        str(tmp_path / "bc.pt"),
        "--final-ckpt",
        str(tmp_path / "final.pt"),
    ]
    old = sys.argv
    sys.argv = argv
    try:
        a = parse_args()
    finally:
        sys.argv = old
    for k, v in overrides.items():
        setattr(a, k, v)
    return a


def _fresh_net(a):
    import torch

    return create_network(
        version=4,
        d_model=a.d_model,
        nhead=a.nhead,
        num_layers=a.layers,
        dim_feedforward=a.dim_feedforward,
    ).to(torch.device("cpu"))


def test_rl_phase_with_critic_writes_resumable_last(tmp_path):
    a = _args(
        tmp_path,
        centralized_critic=True,
        anchor_bc=True,
        pool_save_every=100,
        save_last_every=1,
        win_points=None,
        wp_mix=[5, 41],
    )
    net = _fresh_net(a)
    torch.save({"model": net.state_dict(), "config": net.config}, a.bc_ckpt)
    phase2_rl(a, torch.device("cpu"), net)
    last = tmp_path / "last.pt"
    assert last.exists() and (tmp_path / "final.pt").exists()
    ck = load_checkpoint(last)
    assert ck["format"] == 3
    assert ck.get("critic") is not None  # critic persisted
    assert ck["normalizer"] is not None
    assert len(ck["anchors"]) == 1
    assert ck["pool"] == [], "pool cadence should be independent from last.pt cadence"
    assert ck["rollout_state"]["env_states"]
    metric_fields = csv.DictReader((tmp_path / "run" / "metrics.csv").open()).fieldnames
    assert metric_fields is not None
    assert {"mean_episode_return_wp_5", "mean_episode_return_wp_41"} <= set(metric_fields)

    (tmp_path / "bc.pt").unlink()
    restored = _resolve_anchors(a, ck, torch.device("cpu"))
    assert restored is not None
    assert all(
        torch.equal(actual, expected)
        for actual, expected in zip(restored[0].values(), ck["anchors"][0].values())
    )


def test_rl_phase_resume_continues(tmp_path, monkeypatch):
    seeds = []
    create_vec_env = bc_then_rl.create_vec_env

    def capture_seed(**kwargs):
        seeds.append(kwargs["seed"])
        return create_vec_env(**kwargs)

    monkeypatch.setattr(bc_then_rl, "create_vec_env", capture_seed)
    a = _args(
        tmp_path,
        centralized_critic=True,
        total_rl_steps=4096,
        max_hours=0.0,
    )
    phase2_rl(a, torch.device("cpu"), _fresh_net(a))
    first_checkpoint = load_checkpoint(tmp_path / "last.pt")
    first = first_checkpoint["update"]
    # The seed-offset assertion below is vacuous when games == 0.
    assert first_checkpoint["games"] > 0
    metrics_path = tmp_path / "run" / "metrics.csv"
    with metrics_path.open(newline="") as f:
        fieldnames = csv.DictReader(f).fieldnames
    assert fieldnames is not None
    stale_row = dict.fromkeys(fieldnames, "0")
    stale_row.update(phase="rl", update="999")
    with metrics_path.open("a", newline="") as f:
        csv.DictWriter(f, fieldnames=fieldnames).writerow(stale_row)

    a2 = _args(
        tmp_path,
        centralized_critic=True,
        total_rl_steps=4096,
        resume=str(tmp_path / "last.pt"),
    )
    phase2_rl(a2, torch.device("cpu"), _fresh_net(a2))
    second = load_checkpoint(tmp_path / "last.pt")["update"]
    assert second > first, "resume did not advance the update count"
    rows = list(csv.DictReader(metrics_path.open()))
    assert [int(row["update"]) for row in rows] == list(range(1, second + 1))
    assert metrics_path.read_text().count("phase,update,") == 1
    assert seeds[:2] == [a.seed, a.seed]

    with pytest.raises(SystemExit, match=r"already at update .* this run is complete"):
        phase2_rl(a2, torch.device("cpu"), _fresh_net(a2))
    assert len(seeds) == 2, "completed resume should fail before creating vector envs"


def test_metrics_reconciliation_truncates_ahead_rows_and_keeps_latest_duplicate(tmp_path):
    path = tmp_path / "metrics.csv"
    path.write_text("phase,update,sps\nrl,1,10\nrl,2,20\nrl,3,30\nrl,2,22\n")

    _reconcile_metrics_csv(path, checkpoint_update=2)

    rows = list(csv.DictReader(path.open()))
    assert [(int(row["update"]), row["sps"]) for row in rows] == [(1, "10"), (2, "22")]


def test_resume_contract_rejects_run_identity_or_schedule_changes():
    saved = {
        "run_id": "runD",
        "train_config": {"total_timesteps": 60_000_000},
    }
    with pytest.raises(SystemExit, match=r"run_id, train_config"):
        _validate_resume_contract(
            {"resume_contract": saved},
            {
                "run_id": "runE",
                "train_config": {"total_timesteps": 90_000_000},
            },
        )


def test_centralized_critic_requires_vec(tmp_path):
    import torch

    a = _args(tmp_path, centralized_critic=True, num_envs=1)
    with pytest.raises(ValueError, match="num-envs > 1"):
        phase2_rl(a, torch.device("cpu"), _fresh_net(a))


def _write_resume_checkpoint(tmp_path):
    net = create_network(version=4, d_model=48, nhead=2, num_layers=2, dim_feedforward=96)
    critic = CentralizedCritic(
        input_size=FULL_STATE_SIZE, hidden_size=40, num_layers=2, use_layer_norm=True
    )
    optimizer = torch.optim.Adam([*net.parameters(), *critic.parameters()])
    vec = create_vec_env(num_envs=4, seed=0, win_points=5, sync=True)
    try:
        vec.reset()
        rollout_state = snapshot_vec_env_state(vec)
    finally:
        vec.close()
    path = tmp_path / "resume.pt"
    save_checkpoint(
        path,
        net=net,
        optimizer=optimizer,
        config=TrainConfig(
            network_version=4,
            d_model=48,
            nhead=2,
            num_layers=2,
            dim_feedforward=96,
            hidden_size=40,
            centralized_critic=True,
            num_envs=4,
            steps_per_env=128,
            win_points=5,
        ),
        step=10,
        update=2,
        extra={"critic": critic.state_dict(), "rollout_state": rollout_state},
    )
    return path, net, critic


def test_resume_rebuilds_policy_and_critic_from_checkpoint(tmp_path):
    path, expected_net, expected_critic = _write_resume_checkpoint(tmp_path)
    args = _args(tmp_path, resume=str(path), centralized_critic=True)
    args._explicit_options = {"--resume", "--centralized-critic"}

    _, net, critic = _load_resume_components(args, torch.device("cpu"))

    assert net.config == expected_net.config
    assert (args.network_version, args.d_model, args.nhead) == (4, 48, 2)
    assert (args.layers, args.dim_feedforward, args.hidden) == (2, 96, 40)
    assert critic is not None
    assert critic.value_head[0].in_features == expected_critic.value_head[0].in_features
    assert all(
        torch.equal(actual, expected)
        for actual, expected in zip(
            critic.state_dict().values(), expected_critic.state_dict().values()
        )
    )


def test_resume_final_checkpoint_uses_rebuilt_network_config(tmp_path):
    path, expected_net, _ = _write_resume_checkpoint(tmp_path)
    args = _args(
        tmp_path,
        resume=str(path),
        centralized_critic=True,
        total_rl_steps=1536,
    )
    args._explicit_options = {"--resume", "--centralized-critic"}

    phase2_rl(args, torch.device("cpu"), _fresh_net(args))

    final = load_checkpoint(tmp_path / "final.pt")
    assert final["config"] == expected_net.config


def test_resume_rejects_explicit_architecture_mismatch(tmp_path):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    args = _args(
        tmp_path,
        resume=str(path),
        centralized_critic=True,
        d_model=32,
    )
    args._explicit_options = {"--resume", "--centralized-critic", "--d-model"}

    with pytest.raises(SystemExit, match=r"--d-model=32.*checkpoint d_model=48"):
        _load_resume_components(args, torch.device("cpu"))


def test_resume_rejects_legacy_v4_signal_head(tmp_path):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    checkpoint = load_checkpoint(path)
    checkpoint["net_config"]["card_conditioned_signals"] = False
    save_checkpoint_payload(path, checkpoint)
    args = _args(tmp_path, resume=str(path), centralized_critic=True)
    args._explicit_options = {"--resume", "--centralized-critic"}

    with pytest.raises(SystemExit, match="legacy V4 global signal heads are inference-only"):
        _load_resume_components(args, torch.device("cpu"))


def test_resume_rejects_critic_flag_mismatch(tmp_path):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    args = _args(tmp_path, resume=str(path), centralized_critic=False)
    args._explicit_options = {"--resume"}

    with pytest.raises(SystemExit, match="checkpoint has a critic"):
        _load_resume_components(args, torch.device("cpu"))


def test_resume_rejects_flat_checkpoint(tmp_path):
    """The shipped runB/runC files and --final-ckpt output carry no optimizer
    state; resuming one must fail with a named error, not a KeyError."""
    net = create_network(version=4, d_model=48, nhead=2, num_layers=2, dim_feedforward=96)
    flat_path = tmp_path / "flat.pt"
    torch.save({"model": net.state_dict(), "config": dict(net.config)}, flat_path)

    args = _args(tmp_path, resume=str(flat_path), centralized_critic=False)
    args._explicit_options = {"--resume"}

    with pytest.raises(CheckpointIntegrityError, match="hash is required"):
        phase2_rl(args, torch.device("cpu"), None)


def test_rl_resume_restores_checkpoint_rng(tmp_path, monkeypatch):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    checkpoint = load_checkpoint(path)
    checkpoint["update"] = 2
    checkpoint["rng"] = rng_state()
    save_checkpoint_payload(path, checkpoint)
    restored = []
    monkeypatch.setattr(bc_then_rl, "restore_rng", restored.append)

    args = _args(
        tmp_path,
        resume=str(path),
        centralized_critic=True,
        total_rl_steps=2048,
        max_hours=0.0,
    )
    args._explicit_options = {"--resume", "--centralized-critic"}
    phase2_rl(args, torch.device("cpu"), _fresh_net(args))

    assert len(restored) == 1
    assert restored[0]["python"] == checkpoint["rng"]["python"]
    assert torch.equal(restored[0]["torch"], checkpoint["rng"]["torch"])
