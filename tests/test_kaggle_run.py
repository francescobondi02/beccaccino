"""Tests for the Kaggle orchestration CLI. Pure logic — no network calls."""

from __future__ import annotations

import sys

import pytest

from scripts import kaggle_run
from scripts.kaggle_run import (
    MEASURED_SPS,
    SECONDS_PER_HOUR,
    SMOKE_MAX_STEPS,
    SMOKE_SPEC,
    RunSpec,
    est_hours,
    launch,
    render_kernel_script,
)


def test_runspec_cli_args_parse_through_bc_then_rl(monkeypatch):
    """Drift guard: every flag RunSpec emits must be accepted by bc_then_rl's
    parser, so the tool can't silently desync from the training script."""
    from scripts import bc_then_rl

    argv = ["prog", *RunSpec().to_cli_args()]
    monkeypatch.setattr(sys, "argv", argv)
    args = bc_then_rl.parse_args()  # raises SystemExit on any unknown flag
    assert args.network_version == 4
    assert args.total_rl_steps == RunSpec().total_rl_steps


def test_est_hours_matches_throughput_model():
    steps = MEASURED_SPS * SECONDS_PER_HOUR  # exactly one GPU-hour of steps
    assert est_hours(steps) == pytest.approx(1.0)


def test_launch_refuses_large_run_without_confirm(monkeypatch):
    """A run above the smoke threshold must be REFUSED unless --confirm-cost."""
    # Guard against any accidental network call: fail loudly if _run is reached.
    monkeypatch.setattr(kaggle_run, "_run", lambda cmd: pytest.fail("must not push"))
    big = RunSpec(total_rl_steps=SMOKE_MAX_STEPS + 1)
    with pytest.raises(SystemExit, match="REFUSED"):
        launch(big, confirm_cost=False)


def test_launch_allows_smoke_sized_run(monkeypatch):
    """A smoke-sized run pushes without --confirm-cost (records the push)."""
    pushed = []
    monkeypatch.setattr(kaggle_run, "_run", lambda cmd: pushed.append(cmd))
    launch(RunSpec(total_rl_steps=SMOKE_MAX_STEPS), confirm_cost=False)
    assert pushed and pushed[0][:3] == ["kaggle", "kernels", "push"]


def test_stage_ignore_excludes_junk():
    ignored = kaggle_run.STAGE_IGNORE("somedir", [
        "game.py", "__pycache__", ".venv", "runs", "checkpoints", "x.log", ".DS_Store",
    ])
    assert {"__pycache__", ".venv", "runs", "checkpoints", "x.log", ".DS_Store"} <= set(ignored)
    assert "game.py" not in ignored


def test_rendered_kernel_script_compiles():
    """The generated kernel body must be valid Python."""
    compile(render_kernel_script(SMOKE_SPEC), "<kernel>", "exec")
