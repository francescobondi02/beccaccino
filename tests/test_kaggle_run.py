"""Tests for the Kaggle orchestration CLI. Pure logic — no network calls."""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

import pytest

from scripts import kaggle_run
from scripts.kaggle_run import (
    AUTO_RESUME,
    DATASET_SLUG,
    MEASURED_SPS,
    RUN_B_SPEC,
    RUN_D2_SPEC,
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
from training.checkpoint import checkpoint_sha256, save_checkpoint_payload
from training.config import TrainConfig
from training.provenance import SOURCE_MANIFEST_FILENAME


def _spec(**training_overrides) -> RunSpec:
    return RunSpec(
        training=dataclasses.replace(RunSpec().training, **training_overrides),
    )


def test_runspec_cli_args_parse_through_bc_then_rl(monkeypatch):
    """Drift guard: every flag RunSpec emits must be accepted by bc_then_rl's
    parser, so the tool can't silently desync from the training script. Uses the
    full-featured RUN_B_SPEC so critic/anchor/max-hours flags are covered too."""
    from scripts import bc_then_rl

    argv = ["prog", *RUN_B_SPEC.to_cli_args()]
    monkeypatch.setattr(sys, "argv", argv)
    args = bc_then_rl.parse_args()  # raises SystemExit on any unknown flag
    config = bc_then_rl.train_config_from_args(args)
    assert args.network_version == 4
    assert args.centralized_critic is True
    assert args.anchor_bc is True
    assert config.max_hours == RUN_B_SPEC.training.max_hours
    assert config.save_last_every == RUN_B_SPEC.training.save_last_every
    assert args.run_id == RUN_B_SPEC.run_id


def test_strengthener_flags_render_only_when_set():
    """store_true flags appear only when enabled; max_hours/resume only when set."""
    off = RunSpec().to_cli_args()
    assert "--centralized-critic" not in off
    assert "--anchor-bc" not in off
    assert "--max-hours" not in off
    on = RunSpec(
        training=dataclasses.replace(
            RunSpec().training,
            centralized_critic=True,
            max_hours=11.0,
        ),
        anchor_bc=True,
    ).to_cli_args()
    assert "--centralized-critic" in on and "--anchor-bc" in on
    assert on[on.index("--max-hours") + 1] == "11.0"


def test_runb_preset_exceeds_smoke_threshold():
    """The overnight preset must trip the safety gate (needs --confirm-cost)."""
    assert RUN_B_SPEC.training.total_timesteps > SMOKE_MAX_STEPS


def test_rund2_uses_fresh_identity_and_fixed_batch_geometry(monkeypatch):
    from scripts import bc_then_rl

    assert RUN_D2_SPEC.run_id == "runD2"
    assert RUN_D2_SPEC.out_dir.endswith("/runD2")
    assert RUN_D2_SPEC.training.wp_mix == [5, 41]
    assert RUN_D2_SPEC.training.win_points == 5
    assert RUN_D2_SPEC.training.batch_size == 32768
    monkeypatch.setattr(sys, "argv", ["prog", *RUN_D2_SPEC.to_cli_args()])
    args = bc_then_rl.parse_args()
    assert args.wp_mix == [5, 41]
    assert args.win_points is None
    assert bc_then_rl.train_config_from_args(args) == RUN_D2_SPEC.training


def test_runspec_has_one_training_configuration_surface():
    fields = {field.name for field in dataclasses.fields(RunSpec)}

    assert "training" in fields
    assert not fields & {
        "total_rl_steps",
        "num_envs",
        "steps_per_env",
        "network_version",
        "centralized_critic",
    }
    assert isinstance(RunSpec().training, TrainConfig)


def test_cli_override_does_not_mutate_preset():
    original = RUN_D2_SPEC.training.total_timesteps
    args = argparse.Namespace(
        preset="rund2",
        total_rl_steps=1234,
        num_envs=None,
        steps_per_env=None,
        d_model=None,
        layers=None,
        max_hours=None,
        resume=None,
        resume_state=False,
    )

    overridden = kaggle_run._spec_from_args(args)

    assert overridden.training.total_timesteps == 1234
    assert RUN_D2_SPEC.training.total_timesteps == original


def test_historical_rund_preset_is_refused_before_kaggle_action(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["prog", "launch", "--preset", "rund", "--confirm-cost"])
    monkeypatch.setattr(kaggle_run, "_run", lambda command: pytest.fail("must not push"))

    with pytest.raises(SystemExit, match="Run D is historical.*rund2"):
        kaggle_run.main()


def test_rund2_preset_selects_fresh_run(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        sys,
        "argv",
        ["prog", "launch", "--preset", "rund2", "--confirm-cost"],
    )
    monkeypatch.setattr(
        kaggle_run,
        "launch",
        lambda spec, confirm_cost: captured.update(spec=spec, confirm_cost=confirm_cost),
    )

    kaggle_run.main()

    assert captured["spec"].run_id == "runD2"
    assert captured["spec"].training.resume_from is None
    assert captured["confirm_cost"] is True


def test_est_hours_matches_throughput_model():
    steps = MEASURED_SPS * SECONDS_PER_HOUR  # exactly one GPU-hour of steps
    assert est_hours(steps) == pytest.approx(1.0)


def test_run_c_empirical_cost_model():
    assert est_hours(30_000_000) == pytest.approx(11.0, abs=0.05)


def test_launch_refuses_large_run_without_confirm(monkeypatch):
    """A run above the smoke threshold must be REFUSED unless --confirm-cost."""
    # Guard against any accidental network call: fail loudly if _run is reached.
    monkeypatch.setattr(kaggle_run, "_run", lambda cmd: pytest.fail("must not push"))
    big = _spec(total_timesteps=SMOKE_MAX_STEPS + 1)
    with pytest.raises(SystemExit, match="REFUSED"):
        launch(big, confirm_cost=False)


def test_launch_allows_smoke_sized_run(monkeypatch):
    """A smoke-sized run pushes without --confirm-cost (records the push)."""
    pushed = []
    monkeypatch.setattr(kaggle_run, "_run", lambda cmd: pushed.append(cmd))
    launch(_spec(total_timesteps=SMOKE_MAX_STEPS), confirm_cost=False)
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
    assert "scripts.benchmark" in render_kernel_script(SMOKE_SPEC)


def _write_state_source(root: Path, run_id: str = "smoke") -> None:
    contract = {"format": 1, "run_id": run_id}
    checkpoint = {
        "resume_contract": contract,
        "run_id": run_id,
        "update": 3,
        "step": 123,
    }
    (root / "checkpoints").mkdir(parents=True)
    last_path = root / "checkpoints" / "last.pt"
    best_path = root / "checkpoints" / "best.pt"
    save_checkpoint_payload(last_path, {**checkpoint, "update": 2, "provenance": {}})
    save_checkpoint_payload(last_path, {**checkpoint, "provenance": {}})
    save_checkpoint_payload(best_path, {"best": False, "provenance": {}})
    save_checkpoint_payload(best_path, {"best": True, "provenance": {}})
    (root / "runs" / run_id).mkdir(parents=True)
    metrics_path = root / "runs" / run_id / "metrics.csv"
    metrics_path.write_text("phase,update\nrl,1\n")
    relative_files = [*STATE_ALLOWLIST, metrics_path.relative_to(root).as_posix()]
    artifacts = {
        relative: {
            "sha256": checkpoint_sha256(root / relative),
            "size": (root / relative).stat().st_size,
        }
        for relative in relative_files
    }
    (root / STATE_MANIFEST).write_text(
        json.dumps({"format": 1, "run_id": run_id, "artifacts": artifacts})
    )


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
    assert staged["manifest"]["files"] == sorted([*STATE_ALLOWLIST, "runs/smoke/metrics.csv"])
    assert set(staged["manifest"]["artifacts"]) == set(staged["manifest"]["files"])
    assert all(
        artifact["size"] > 0 and len(artifact["sha256"]) == 64
        for artifact in staged["manifest"]["artifacts"].values()
    )


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
        RunSpec(
            training=dataclasses.replace(
                RunSpec().training,
                total_timesteps=SMOKE_MAX_STEPS,
                resume_from=AUTO_RESUME,
            ),
            run_id="smoke",
        ),
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
        training=dataclasses.replace(
            RunSpec().training,
            total_timesteps=100,
            device="cpu",
            resume_from=AUTO_RESUME,
        ),
        run_id="smoke",
        out_dir=str(out_dir),
        final_ckpt=str(final_ckpt),
    )

    exec(render_kernel_script(spec), {})

    training_call = calls[-1]
    resume_index = training_call.index("--resume")
    assert training_call[resume_index + 1] == str(final_ckpt.parent / "last.pt")
    assert (out_dir / "metrics.csv").read_text() == "phase,update\nrl,1\n"
    assert (final_ckpt.parent / "best.pt").is_file()
    assert (final_ckpt.parent / "best.pt.sha256").is_file()
    assert (final_ckpt.parent / "last.prev.pt").is_file()


def test_rendered_kernel_rejects_tampered_state_bundle(tmp_path, monkeypatch):
    input_root = tmp_path / "input"
    marker = input_root / "code" / kaggle_run.CODE_MARKER
    marker.parent.mkdir(parents=True)
    marker.write_text("")
    state_root = input_root / "state"
    _write_state_source(state_root)
    (state_root / "checkpoints" / "last.pt").write_bytes(b"tampered")

    monkeypatch.setattr(kaggle_run, "KAGGLE_INPUT_ROOT", str(input_root))
    monkeypatch.setattr(kaggle_run, "WORK_DIR_ON_KAGGLE", str(tmp_path / "work"))
    monkeypatch.setattr("subprocess.check_call", lambda command: None)
    spec = RunSpec(
        training=dataclasses.replace(
            RunSpec().training,
            total_timesteps=100,
            device="cpu",
            resume_from=AUTO_RESUME,
        ),
        run_id="smoke",
        out_dir=str(tmp_path / "out" / "runs" / "smoke"),
        final_ckpt=str(tmp_path / "out" / "checkpoints" / "smoke_rl.pt"),
    )

    with pytest.raises(AssertionError, match="state artifact size mismatch"):
        exec(render_kernel_script(spec), {})


def test_push_code_embeds_source_manifest(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    (source / "pyproject.toml").write_text("[project]\nname='test'\nversion='0'\n")
    expected = {"commit": "abc", "tree": "def", "dirty": False, "dirty_sha256": None}
    captured = {}

    def inspect_stage(command):
        root = Path(command[command.index("-p") + 1])
        captured["manifest"] = json.loads((root / "ai" / SOURCE_MANIFEST_FILENAME).read_text())

    monkeypatch.setattr(kaggle_run, "AI_ROOT", source)
    monkeypatch.setattr(kaggle_run, "source_manifest", lambda root: expected)
    monkeypatch.setattr(kaggle_run, "_run", inspect_stage)

    kaggle_run.push_code(create=True, message="test")

    assert captured["manifest"] == expected


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
        training=dataclasses.replace(
            RunSpec().training,
            total_timesteps=100,
            device="cpu",
            resume_from=AUTO_RESUME,
        ),
        run_id="smoke",
        out_dir=str(tmp_path / "out" / "runs" / "smoke"),
        final_ckpt=str(tmp_path / "out" / "checkpoints" / "smoke_rl.pt"),
    )

    with pytest.raises(AssertionError, match="expected exactly one last.pt"):
        exec(render_kernel_script(spec), {})
