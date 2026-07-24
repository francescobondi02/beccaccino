"""Drive Kaggle GPU training runs from the CLI without hand-editing the notebook.

The loop: ship ai/ as the dataset DATASET_SLUG -> a script kernel KERNEL_SLUG
copies it and runs scripts.bc_then_rl with a generated flag set -> pull outputs.
Shells out to the authenticated `kaggle` CLI (2.2.x) via subprocess.

Safety (binding): a SMOKE preset launches without confirmation; anything above
SMOKE_MAX_STEPS is REFUSED unless --confirm-cost is passed. This tool must never
autonomously launch a multi-hour run.

Verbs:
  push-code [--create] [-m MSG]   sync ai/ -> new dataset version (or create)
  configure                       write+push kernel metadata (GPU + internet on)
  launch [--preset smoke] [flags] render a script kernel from a RunSpec and push
  status                          poll kernel run state
  pull [-p DIR]                   fetch kernel outputs
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# --- Single source of truth for slugs/paths (edit KAGGLE_USER for your account) ---
KAGGLE_USER = "fbondi"
DATASET_SLUG = f"{KAGGLE_USER}/becca-ai"
KERNEL_SLUG = f"{KAGGLE_USER}/becca-training"
AI_DIR_ON_KAGGLE = "/kaggle/input/becca-ai/ai"
WORK_DIR_ON_KAGGLE = "/kaggle/working/ai"
PULL_DIR = "checkpoints/kaggle"

# Throughput / cost model (observed T4 transformer throughput).
MEASURED_SPS = 1150
KAGGLE_SESSION_CAP_HOURS = 12
SECONDS_PER_HOUR = 3600
SMOKE_MAX_STEPS = 1_000_000  # anything above this needs --confirm-cost

# Dirs/patterns stripped from the ai/ upload (bloat / secrets / local state).
STAGE_IGNORE = shutil.ignore_patterns(
    "__pycache__", ".venv", "runs", "wandb", "checkpoints", ".git",
    ".pytest_cache", ".ruff_cache", "*.log", ".DS_Store",
)

AI_ROOT = Path(__file__).resolve().parent.parent  # the ai/ package root


@dataclass
class RunSpec:
    """A training run's hyperparameters. Mirrors scripts/bc_then_rl.py flags 1:1
    so a spec renders directly to that CLI (a test guards the mapping)."""

    network_version: int = 4
    d_model: int = 128
    nhead: int = 4
    layers: int = 3
    dim_feedforward: int = 256
    bc_games: int = 3000
    bc_epochs: int = 5
    bc_batch_size: int = 1024
    bc_lr: float = 3e-4
    bc_win_points: int = 5
    total_rl_steps: int = 5_000_000
    num_envs: int = 32
    steps_per_env: int = 512
    win_points: int = 5
    eval_win_points: int = 41
    eval_every: int = 25
    eval_games: int = 100
    pool_save_every: int = 30
    p_latest_opponent: float = 0.5
    device: str = "cuda"
    out_dir: str = "/kaggle/working/runs/run"
    bc_ckpt: str = "/kaggle/working/checkpoints/run_bc.pt"
    final_ckpt: str = "/kaggle/working/checkpoints/run_rl.pt"
    extra_flags: list[str] = field(default_factory=list)

    def to_cli_args(self) -> list[str]:
        """Render to the scripts.bc_then_rl flag list."""
        return [
            "--network-version", str(self.network_version),
            "--d-model", str(self.d_model),
            "--nhead", str(self.nhead),
            "--layers", str(self.layers),
            "--dim-feedforward", str(self.dim_feedforward),
            "--bc-games", str(self.bc_games),
            "--bc-epochs", str(self.bc_epochs),
            "--bc-batch-size", str(self.bc_batch_size),
            "--bc-lr", str(self.bc_lr),
            "--bc-win-points", str(self.bc_win_points),
            "--total-rl-steps", str(self.total_rl_steps),
            "--num-envs", str(self.num_envs),
            "--steps-per-env", str(self.steps_per_env),
            "--win-points", str(self.win_points),
            "--eval-win-points", str(self.eval_win_points),
            "--eval-every", str(self.eval_every),
            "--eval-games", str(self.eval_games),
            "--pool-save-every", str(self.pool_save_every),
            "--p-latest-opponent", str(self.p_latest_opponent),
            "--device", self.device,
            "--out-dir", self.out_dir,
            "--bc-ckpt", self.bc_ckpt,
            "--final-ckpt", self.final_ckpt,
            *self.extra_flags,
        ]


# A cheap end-to-end validation run (~3 min on a T4): exercises BC + a short RL
# phase without burning quota.
SMOKE_SPEC = RunSpec(
    bc_games=200, bc_epochs=1, total_rl_steps=200_000,
    num_envs=16, eval_every=50, eval_games=20,
    out_dir="/kaggle/working/runs/smoke",
    bc_ckpt="/kaggle/working/checkpoints/smoke_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/smoke_rl.pt",
)


def est_hours(total_rl_steps: int) -> float:
    """Rough GPU-hours for the RL phase at the measured T4 throughput."""
    return total_rl_steps / MEASURED_SPS / SECONDS_PER_HOUR


def render_kernel_script(spec: RunSpec) -> str:
    """Generate the Python script-kernel body that runs this spec on Kaggle."""
    return (
        "import os, sys, shutil, subprocess\n"
        f"AI_DIR = {AI_DIR_ON_KAGGLE!r}\n"
        f"WORK = {WORK_DIR_ON_KAGGLE!r}\n"
        "if not os.path.exists(WORK):\n"
        "    shutil.copytree(AI_DIR, WORK)\n"
        "os.chdir(WORK)\n"
        "sys.path.insert(0, WORK)\n"
        "subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'gymnasium>=1.0'])\n"
        "os.makedirs('/kaggle/working/checkpoints', exist_ok=True)\n"
        f"FLAGS = {spec.to_cli_args()!r}\n"
        "subprocess.check_call([sys.executable, '-m', 'scripts.bc_then_rl'] + FLAGS)\n"
    )


def _run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)


def push_code(create: bool, message: str) -> None:
    """Stage ai/ (junk stripped) and create/version the Kaggle dataset."""
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / "ai"
        shutil.copytree(AI_ROOT, staged, ignore=STAGE_IGNORE)
        meta = {"title": "becca-ai", "id": DATASET_SLUG, "licenses": [{"name": "CC0-1.0"}]}
        (Path(tmp) / "dataset-metadata.json").write_text(json.dumps(meta, indent=2))
        if create:
            _run(["kaggle", "datasets", "create", "-p", tmp, "-r", "zip"])
        else:
            _run(["kaggle", "datasets", "version", "-p", tmp, "-m", message, "-r", "zip"])


def configure() -> None:
    """Write kernel-metadata.json (GPU + internet on, dataset attached) and push
    the current kernel so the settings take effect."""
    with tempfile.TemporaryDirectory() as tmp:
        meta = {
            "id": KERNEL_SLUG,
            "title": "becca-training",
            "code_file": "kernel.py",
            "language": "python",
            "kernel_type": "script",
            "enable_gpu": True,
            "enable_internet": True,
            "dataset_sources": [DATASET_SLUG],
            "is_private": True,
        }
        (Path(tmp) / "kernel-metadata.json").write_text(json.dumps(meta, indent=2))
        (Path(tmp) / "kernel.py").write_text(render_kernel_script(SMOKE_SPEC))
        _run(["kaggle", "kernels", "push", "-p", tmp])


def launch(spec: RunSpec, confirm_cost: bool) -> None:
    """Render a script kernel from spec and push it (triggers a run).

    Safety gate: SMOKE-sized runs launch freely; larger runs are REFUSED unless
    --confirm-cost is passed."""
    hours = est_hours(spec.total_rl_steps)
    print(f"Estimated RL GPU time: {hours:.2f}h for {spec.total_rl_steps:,} steps "
          f"(~{MEASURED_SPS} SPS on T4).")
    if spec.total_rl_steps > SMOKE_MAX_STEPS and not confirm_cost:
        raise SystemExit(
            f"REFUSED: {spec.total_rl_steps:,} steps exceeds the smoke threshold "
            f"({SMOKE_MAX_STEPS:,}). Re-run with --confirm-cost to launch a real run."
        )
    if hours > KAGGLE_SESSION_CAP_HOURS:
        print(f"WARNING: estimate exceeds the {KAGGLE_SESSION_CAP_HOURS}h session cap; "
              "the run will be killed. Use --max-hours in the spec so it saves last.pt.")
    with tempfile.TemporaryDirectory() as tmp:
        meta = {
            "id": KERNEL_SLUG,
            "title": "becca-training",
            "code_file": "kernel.py",
            "language": "python",
            "kernel_type": "script",
            "enable_gpu": True,
            "enable_internet": True,
            "dataset_sources": [DATASET_SLUG],
            "is_private": True,
        }
        (Path(tmp) / "kernel-metadata.json").write_text(json.dumps(meta, indent=2))
        (Path(tmp) / "kernel.py").write_text(render_kernel_script(spec))
        _run(["kaggle", "kernels", "push", "-p", tmp])


def status() -> None:
    _run(["kaggle", "kernels", "status", KERNEL_SLUG])


def pull(dest: str) -> None:
    Path(dest).mkdir(parents=True, exist_ok=True)
    _run(["kaggle", "kernels", "output", KERNEL_SLUG, "-p", dest])


def _spec_from_args(a: argparse.Namespace) -> RunSpec:
    if a.preset == "smoke":
        return dataclasses.replace(SMOKE_SPEC)
    spec = RunSpec()
    # Only override fields the user explicitly set on the CLI.
    for f in dataclasses.fields(RunSpec):
        val = getattr(a, f.name, None)
        if val is not None and f.name != "extra_flags":
            setattr(spec, f.name, val)
    return spec


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Drive Kaggle GPU runs for BECCA")
    sub = p.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("push-code", help="sync ai/ to the dataset")
    pc.add_argument("--create", action="store_true", help="create the dataset (first time)")
    pc.add_argument("-m", "--message", default="update", help="version message")

    sub.add_parser("configure", help="enable GPU+internet and attach the dataset")

    ln = sub.add_parser("launch", help="render + push a run kernel")
    ln.add_argument("--preset", choices=["smoke"], default=None)
    ln.add_argument("--confirm-cost", action="store_true",
                    help="required to launch a run above the smoke threshold")
    # A curated subset of the most-tuned RunSpec fields; the rest keep defaults.
    ln.add_argument("--total-rl-steps", type=int)
    ln.add_argument("--num-envs", type=int)
    ln.add_argument("--d-model", dest="d_model", type=int)
    ln.add_argument("--layers", type=int)

    sub.add_parser("status", help="poll the kernel run state")

    pl = sub.add_parser("pull", help="fetch kernel outputs")
    pl.add_argument("-p", "--path", default=PULL_DIR)
    return p


def main() -> None:
    a = build_parser().parse_args()
    if a.cmd == "push-code":
        push_code(create=a.create, message=a.message)
    elif a.cmd == "configure":
        configure()
    elif a.cmd == "launch":
        launch(_spec_from_args(a), confirm_cost=a.confirm_cost)
    elif a.cmd == "status":
        status()
    elif a.cmd == "pull":
        pull(a.path)


if __name__ == "__main__":
    main()
