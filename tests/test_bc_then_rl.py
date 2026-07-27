"""Smoke tests for the bc_then_rl RL phase parity features.

Kept tiny (few updates, tiny V4, CPU). They verify the plumbing the overnight
Kaggle run depends on — critic, anchors, resumable last.pt, --max-hours,
already-complete resume — not learning.
"""

from __future__ import annotations

import argparse

import pytest
import torch

from becca_env.observation import FULL_STATE_SIZE
from scripts import bc_then_rl
from scripts.bc_then_rl import _load_resume_components, parse_args, phase2_rl
from training.checkpoint import load_checkpoint, rng_state, save_checkpoint
from training.config import TrainConfig
from training.network import CentralizedCritic, create_network


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
    import torch

    a = _args(tmp_path, centralized_critic=True)
    phase2_rl(a, torch.device("cpu"), _fresh_net(a))
    last = tmp_path / "last.pt"
    assert last.exists() and (tmp_path / "final.pt").exists()
    ck = load_checkpoint(last)
    assert ck["format"] == 2
    assert ck.get("critic") is not None  # critic persisted
    assert ck["normalizer"] is not None


def test_rl_phase_resume_continues(tmp_path):
    import torch

    a = _args(tmp_path, centralized_critic=True)
    phase2_rl(a, torch.device("cpu"), _fresh_net(a))
    first = load_checkpoint(tmp_path / "last.pt")["update"]

    a2 = _args(
        tmp_path, centralized_critic=True, total_rl_steps=4096, resume=str(tmp_path / "last.pt")
    )
    phase2_rl(a2, torch.device("cpu"), _fresh_net(a2))
    second = load_checkpoint(tmp_path / "last.pt")["update"]
    assert second > first, "resume did not advance the update count"

    with pytest.raises(SystemExit, match=r"already at update .* this run is complete"):
        phase2_rl(a2, torch.device("cpu"), _fresh_net(a2))


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
        ),
        step=10,
        update=2,
        extra={"critic": critic.state_dict()},
    )
    return path, net, critic


def test_resume_rebuilds_policy_and_critic_from_checkpoint(tmp_path):
    path, expected_net, expected_critic = _write_resume_checkpoint(tmp_path)
    args = _args(tmp_path, resume=str(path), centralized_critic=True)
    args._explicit_options = {"--resume", "--centralized-critic"}

    _, net, critic = _load_resume_components(args, torch.device("cpu"))

    assert net.config == expected_net.config
    assert critic is not None
    assert critic.value_head[0].in_features == expected_critic.value_head[0].in_features
    assert all(
        torch.equal(actual, expected)
        for actual, expected in zip(
            critic.state_dict().values(), expected_critic.state_dict().values()
        )
    )


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


def test_resume_rejects_critic_flag_mismatch(tmp_path):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    args = _args(tmp_path, resume=str(path), centralized_critic=False)
    args._explicit_options = {"--resume"}

    with pytest.raises(SystemExit, match="checkpoint has a critic"):
        _load_resume_components(args, torch.device("cpu"))


def test_rl_resume_restores_checkpoint_rng(tmp_path, monkeypatch):
    path, _, _ = _write_resume_checkpoint(tmp_path)
    checkpoint = load_checkpoint(path)
    checkpoint["update"] = 99
    checkpoint["rng"] = rng_state()
    torch.save(checkpoint, path)
    restored = []
    monkeypatch.setattr(bc_then_rl, "restore_rng", restored.append)

    args = _args(
        tmp_path,
        resume=str(path),
        centralized_critic=True,
        total_rl_steps=2048,
    )
    args._explicit_options = {"--resume", "--centralized-critic"}
    with pytest.raises(SystemExit, match="this run is complete"):
        phase2_rl(args, torch.device("cpu"), _fresh_net(args))

    assert len(restored) == 1
    assert restored[0]["python"] == checkpoint["rng"]["python"]
    assert torch.equal(restored[0]["torch"], checkpoint["rng"]["torch"])
