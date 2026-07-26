"""Tests for the Kaggle orchestration CLI. Pure logic — no network calls."""

from __future__ import annotations

import sys

import pytest

from scripts import kaggle_run
from scripts.kaggle_run import (
    MEASURED_SPS,
    RUN_B_SPEC,
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
    parser, so the tool can't silently desync from the training script. Uses the
    full-featured RUN_B_SPEC so critic/anchor/max-hours flags are covered too."""
    from scripts import bc_then_rl

    argv = ["prog", *RUN_B_SPEC.to_cli_args()]
    monkeypatch.setattr(sys, "argv", argv)
    args = bc_then_rl.parse_args()  # raises SystemExit on any unknown flag
    assert args.network_version == 4
    assert args.centralized_critic is True
    assert args.anchor_bc is True
    assert args.max_hours == RUN_B_SPEC.max_hours


def test_strengthener_flags_render_only_when_set():
    """store_true flags appear only when enabled; max_hours/resume only when set."""
    off = RunSpec().to_cli_args()
    assert "--centralized-critic" not in off
    assert "--anchor-bc" not in off
    assert "--max-hours" not in off
    on = RunSpec(centralized_critic=True, anchor_bc=True, max_hours=11.0).to_cli_args()
    assert "--centralized-critic" in on and "--anchor-bc" in on
    assert on[on.index("--max-hours") + 1] == "11.0"


def test_runb_preset_exceeds_smoke_threshold():
    """The overnight preset must trip the safety gate (needs --confirm-cost)."""
    assert RUN_B_SPEC.total_rl_steps > SMOKE_MAX_STEPS


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
    ignored = kaggle_run.STAGE_IGNORE(
        "somedir",
        [
            "game.py",
            "__pycache__",
            ".venv",
            "runs",
            "checkpoints",
            "x.log",
            ".DS_Store",
        ],
    )
    assert {"__pycache__", ".venv", "runs", "checkpoints", "x.log", ".DS_Store"} <= set(ignored)
    assert "game.py" not in ignored


def test_rendered_kernel_script_compiles():
    """The generated kernel body must be valid Python."""
    compile(render_kernel_script(SMOKE_SPEC), "<kernel>", "exec")
