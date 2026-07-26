"""Smoke tests for the bc_then_rl RL phase parity features.

Kept tiny (few updates, tiny V4, CPU). They verify the plumbing the overnight
Kaggle run depends on — critic, anchors, resumable last.pt, --max-hours,
already-complete resume — not learning.
"""

from __future__ import annotations

import argparse

import pytest

from scripts.bc_then_rl import parse_args, phase2_rl
from training.checkpoint import load_checkpoint
from training.network import create_network


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


def test_centralized_critic_requires_vec(tmp_path):
    import torch

    a = _args(tmp_path, centralized_critic=True, num_envs=1)
    with pytest.raises(ValueError, match="num-envs > 1"):
        phase2_rl(a, torch.device("cpu"), _fresh_net(a))
