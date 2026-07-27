"""Tests for the Kaggle orchestration CLI. Pure logic — no network calls."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import torch

from scripts import kaggle_run
from scripts.kaggle_run import (
    AUTO_RESUME,
    DATASET_SLUG,
    MEASURED_SPS,
    RUN_B_SPEC,
    SECONDS_PER_HOUR,
    SMOKE_MAX_STEPS,
    SMOKE_SPEC,
    STATE_ALLOWLIST,
    STATE_DATASET_SLUG,
    STATE_MANIFEST,
    RunSpec,
    est_hours,
    launch,
    push_state,
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
    assert args.save_last_every == RUN_B_SPEC.save_last_every
    assert args.run_id == RUN_B_SPEC.run_id


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


def _write_state_source(root: Path, run_id: str = "smoke") -> None:
    contract = {"format": 1, "run_id": run_id}
    checkpoint = {
        "resume_contract": contract,
        "run_id": run_id,
        "update": 3,
        "step": 123,
    }
    (root / "checkpoints").mkdir(parents=True)
    torch.save(checkpoint, root / "checkpoints" / "last.pt")
    torch.save({"best": True}, root / "checkpoints" / "best.pt")
    (root / "runs" / run_id).mkdir(parents=True)
    (root / "runs" / run_id / "metrics.csv").write_text("phase,update\nrl,1\n")
    (root / STATE_MANIFEST).write_text(json.dumps({"format": 1, "run_id": run_id}))


def test_push_state_stages_only_allowlisted_state(tmp_path, monkeypatch):
    _write_state_source(tmp_path)
    (tmp_path / "ai" / "scripts").mkdir(parents=True)
    (tmp_path / "ai" / "scripts" / "bc_then_rl.py").write_text("decoy")
    (tmp_path / "runs" / "plot.png").write_text("decoy")
    staged = {}

    def inspect_stage(cmd):
        root = Path(cmd[cmd.index("-p") + 1])
        staged["files"] = {
            path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()
        }
        staged["manifest"] = json.loads((root / STATE_MANIFEST).read_text())

    monkeypatch.setattr(kaggle_run, "_run", inspect_stage)
    push_state(str(tmp_path), create=True, message="test")

    assert staged["files"] == {
        *STATE_ALLOWLIST,
        "runs/smoke/metrics.csv",
        STATE_MANIFEST,
        "dataset-metadata.json",
    }
    assert staged["manifest"]["run_id"] == "smoke"
    assert staged["manifest"]["files"] == [
        "checkpoints/best.pt",
        "checkpoints/last.pt",
        "runs/smoke/metrics.csv",
    ]


def test_push_state_requires_last_checkpoint(tmp_path):
    with pytest.raises(SystemExit, match="missing resumable checkpoint"):
        push_state(str(tmp_path), create=False, message="test")


def test_resume_state_launch_attaches_both_datasets(monkeypatch):
    captured = {}

    def inspect_kernel(cmd):
        root = Path(cmd[cmd.index("-p") + 1])
        captured["metadata"] = json.loads((root / "kernel-metadata.json").read_text())
        captured["kernel"] = (root / "kernel.py").read_text()

    monkeypatch.setattr(kaggle_run, "_run", inspect_kernel)
    launch(
        RunSpec(total_rl_steps=SMOKE_MAX_STEPS, run_id="smoke", resume=AUTO_RESUME),
        confirm_cost=False,
    )

    assert captured["metadata"]["dataset_sources"] == [DATASET_SLUG, STATE_DATASET_SLUG]
    assert repr(AUTO_RESUME) in captured["kernel"]
    assert "expected exactly one last.pt" in captured["kernel"]
    assert "best.pt" in captured["kernel"]


def test_rendered_kernel_resolves_state_and_carries_history(tmp_path, monkeypatch):
    input_root = tmp_path / "input"
    code_root = input_root / "code"
    marker = code_root / kaggle_run.CODE_MARKER
    marker.parent.mkdir(parents=True)
    marker.write_text("")
    state_root = input_root / "state"
    _write_state_source(state_root)

    work = tmp_path / "work"
    out_dir = tmp_path / "output" / "runs" / "smoke"
    final_ckpt = tmp_path / "output" / "checkpoints" / "smoke_rl.pt"
    monkeypatch.setattr(kaggle_run, "KAGGLE_INPUT_ROOT", str(input_root))
    monkeypatch.setattr(kaggle_run, "WORK_DIR_ON_KAGGLE", str(work))
    calls = []
    monkeypatch.setattr("subprocess.check_call", calls.append)
    spec = RunSpec(
        total_rl_steps=100,
        device="cpu",
        run_id="smoke",
        out_dir=str(out_dir),
        final_ckpt=str(final_ckpt),
        resume=AUTO_RESUME,
    )

    exec(render_kernel_script(spec), {})

    training_call = calls[-1]
    resume_index = training_call.index("--resume")
    assert training_call[resume_index + 1] == str(state_root / "checkpoints" / "last.pt")
    assert (out_dir / "metrics.csv").read_text() == "phase,update\nrl,1\n"
    assert (final_ckpt.parent / "best.pt").is_file()


@pytest.mark.parametrize("state_count", [0, 2])
def test_rendered_kernel_rejects_missing_or_duplicate_state(tmp_path, monkeypatch, state_count):
    input_root = tmp_path / "input"
    marker = input_root / "code" / kaggle_run.CODE_MARKER
    marker.parent.mkdir(parents=True)
    marker.write_text("")
    for index in range(state_count):
        _write_state_source(input_root / f"state-{index}")

    monkeypatch.setattr(kaggle_run, "KAGGLE_INPUT_ROOT", str(input_root))
    monkeypatch.setattr(kaggle_run, "WORK_DIR_ON_KAGGLE", str(tmp_path / "work"))
    monkeypatch.setattr("subprocess.check_call", lambda cmd: None)
    spec = RunSpec(
        total_rl_steps=100,
        device="cpu",
        run_id="smoke",
        out_dir=str(tmp_path / "out" / "runs" / "smoke"),
        final_ckpt=str(tmp_path / "out" / "checkpoints" / "smoke_rl.pt"),
        resume=AUTO_RESUME,
    )

    with pytest.raises(AssertionError, match="expected exactly one last.pt"):
        exec(render_kernel_script(spec), {})
