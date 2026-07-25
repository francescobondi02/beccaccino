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
# Distinct from any hand-created notebook (Kaggle won't convert a notebook kernel
# to a script kernel), so this tool owns its own script kernel.
KERNEL_SLUG = f"{KAGGLE_USER}/becca-training-cli"
# Kaggle mounts attached datasets somewhere under /kaggle/input; the exact path
# and nesting depend on the dataset slug and how the zip was extracted, so the
# kernel auto-detects the code dir (the one containing scripts/bc_then_rl.py)
# rather than hardcoding a mount path.
KAGGLE_INPUT_ROOT = "/kaggle/input"
CODE_MARKER = "scripts/bc_then_rl.py"
WORK_DIR_ON_KAGGLE = "/kaggle/working/ai"
# Pin the GPU to a T4 (sm_75). Kaggle's default GPU is a P100 (sm_60), which its
# current stock PyTorch (cu128) dropped support for — every CUDA op then fails
# with "no kernel image is available" (Kaggle bug docker-python#1546). T4 is in
# the supported arch list, so this sidesteps the issue without reinstalling torch.
MACHINE_SHAPE = "NvidiaTeslaT4"
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
    # Strengtheners / long-run survival (map to bc_then_rl store_true / value flags).
    centralized_critic: bool = False
    anchor_bc: bool = False
    # Signal-honesty shaping, annealed to `_final` over `_frac` of the RL phase.
    # 0.0/0.0 = off (historical behaviour).
    signal_honesty_coef: float = 0.0
    signal_honesty_coef_final: float = 0.0
    signal_honesty_frac: float = 0.5
    max_hours: float | None = None
    resume: str | None = None
    extra_flags: list[str] = field(default_factory=list)

    def to_cli_args(self) -> list[str]:
        """Render to the scripts.bc_then_rl flag list."""
        args = [
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
            "--signal-honesty-coef", str(self.signal_honesty_coef),
            "--signal-honesty-coef-final", str(self.signal_honesty_coef_final),
            "--signal-honesty-frac", str(self.signal_honesty_frac),
            "--device", self.device,
            "--out-dir", self.out_dir,
            "--bc-ckpt", self.bc_ckpt,
            "--final-ckpt", self.final_ckpt,
        ]
        if self.centralized_critic:
            args.append("--centralized-critic")
        if self.anchor_bc:
            args.append("--anchor-bc")
        if self.max_hours is not None:
            args += ["--max-hours", str(self.max_hours)]
        if self.resume is not None:
            args += ["--resume", self.resume]
        return [*args, *self.extra_flags]


# Signal-honesty shaping for the real runs. 0.05 is ~1/20 of a round-end reward
# (which spans ±1), so an honest signal is a nudge and cannot outweigh actually
# winning points — the failure mode to avoid is a policy that farms honesty bonuses
# instead of playing well. Annealed to 0 over the first half, so the second half is
# scored purely on results and the policy decides when signalling is worth it.
SIGNAL_HONESTY_COEF = 0.05
SIGNAL_HONESTY_FRAC = 0.5

# A cheap end-to-end validation run (~3-5 min on a T4): exercises the FULL real
# recipe (critic + anchors + signal shaping) on a short RL phase so the smoke
# validates exactly what the overnight run does, without burning quota.
SMOKE_SPEC = RunSpec(
    bc_games=200, bc_epochs=1, total_rl_steps=200_000,
    num_envs=16, eval_every=50, eval_games=20,
    centralized_critic=True, anchor_bc=True,
    signal_honesty_coef=SIGNAL_HONESTY_COEF,
    signal_honesty_frac=SIGNAL_HONESTY_FRAC,
    out_dir="/kaggle/working/runs/smoke",
    bc_ckpt="/kaggle/working/checkpoints/smoke_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/smoke_rl.pt",
)

# The real overnight run: BC + long PPO self-play on the V4 transformer with the
# centralized critic and BC anchor, capped under Kaggle's 12h session limit so it
# saves last.pt and can be resumed. Above SMOKE_MAX_STEPS -> needs --confirm-cost.
RUN_B_SPEC = RunSpec(
    d_model=192, nhead=6, layers=4, dim_feedforward=384,
    bc_games=6000, bc_epochs=6, total_rl_steps=30_000_000,
    num_envs=64, steps_per_env=512,
    eval_every=50, eval_games=200, pool_save_every=50,
    centralized_critic=True, anchor_bc=True, max_hours=11.0,
    out_dir="/kaggle/working/runs/runB",
    bc_ckpt="/kaggle/working/checkpoints/runB_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/runB_rl.pt",
)


# Run C: Run B's proven architecture and budget, plus the two things Run B
# lacked — signal shaping (so the signal slots mean something) and best.pt
# tracking (Run B peaked ~update 300 of 915 and shipped update 915).
#
# Deliberately NOT changed from Run B: network size, step budget, critic, anchors.
# Run B plateaued around update 300, so more identical steps buy nothing; the
# variable under test here is the signal channel. Keeping everything else fixed
# is what makes the comparison against Run B's ~71% interpretable.
RUN_C_SPEC = dataclasses.replace(
    RUN_B_SPEC,
    signal_honesty_coef=SIGNAL_HONESTY_COEF,
    signal_honesty_frac=SIGNAL_HONESTY_FRAC,
    out_dir="/kaggle/working/runs/runC",
    bc_ckpt="/kaggle/working/checkpoints/runC_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/runC_rl.pt",
)


def est_hours(total_rl_steps: int) -> float:
    """Rough GPU-hours for the RL phase at the measured T4 throughput."""
    return total_rl_steps / MEASURED_SPS / SECONDS_PER_HOUR


def render_kernel_script(spec: RunSpec) -> str:
    """Generate the Python script-kernel body that runs this spec on Kaggle.

    The code dir is auto-detected by walking /kaggle/input for the marker file,
    so the kernel is robust to however Kaggle mounts/extracts the dataset."""
    return (
        "import os, sys, shutil, subprocess\n"
        f"INPUT_ROOT = {KAGGLE_INPUT_ROOT!r}\n"
        f"MARKER = {CODE_MARKER!r}\n"
        f"WORK = {WORK_DIR_ON_KAGGLE!r}\n"
        "code_dir = next((d for d, _, _ in os.walk(INPUT_ROOT)\n"
        "                 if os.path.isfile(os.path.join(d, MARKER))), None)\n"
        "assert code_dir, f'{MARKER} not found under {INPUT_ROOT}; is the dataset attached?'\n"
        "if not os.path.exists(WORK):\n"
        "    shutil.copytree(code_dir, WORK)\n"
        "os.chdir(WORK)\n"
        "sys.path.insert(0, WORK)\n"
        "subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'gymnasium>=1.0'])\n"
        "os.makedirs('/kaggle/working/checkpoints', exist_ok=True)\n"
        f"FLAGS = {spec.to_cli_args()!r}\n"
        # The generated kernel guards against Kaggle's stock torch build
        # mismatching the session GPU arch ('no kernel image is available'): it
        # verifies CUDA can actually run a kernel and falls back to CPU if not,
        # so the run still completes (a smoke validates the pipeline, not speed).
        "def _cuda_ok():\n"
        "    try:\n"
        "        import torch\n"
        "        if not torch.cuda.is_available():\n"
        "            return False\n"
        "        (torch.ones(8, device='cuda') * 2).sum().item()\n"
        "        return True\n"
        "    except Exception as e:\n"
        "        print(f'CUDA unusable ({e!r}); falling back to CPU', flush=True)\n"
        "        return False\n"
        "if '--device' in FLAGS and not _cuda_ok():\n"
        "    FLAGS[FLAGS.index('--device') + 1] = 'cpu'\n"
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
            "title": "becca-training-cli",
            "code_file": "kernel.py",
            "language": "python",
            "kernel_type": "script",
            "enable_gpu": True,
            "machine_shape": MACHINE_SHAPE,
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
            "title": "becca-training-cli",
            "code_file": "kernel.py",
            "language": "python",
            "kernel_type": "script",
            "enable_gpu": True,
            "machine_shape": MACHINE_SHAPE,
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


_PRESETS = {"smoke": SMOKE_SPEC, "runb": RUN_B_SPEC, "runc": RUN_C_SPEC}


def _spec_from_args(a: argparse.Namespace) -> RunSpec:
    if a.preset:
        spec = dataclasses.replace(_PRESETS[a.preset])
    else:
        spec = RunSpec()
    # Only override fields the user explicitly set on the CLI (None = unset).
    for name in ("total_rl_steps", "num_envs", "d_model", "layers", "resume"):
        val = getattr(a, name, None)
        if val is not None:
            setattr(spec, name, val)
    return spec


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Drive Kaggle GPU runs for BECCA")
    sub = p.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("push-code", help="sync ai/ to the dataset")
    pc.add_argument("--create", action="store_true", help="create the dataset (first time)")
    pc.add_argument("-m", "--message", default="update", help="version message")

    sub.add_parser("configure", help="enable GPU+internet and attach the dataset")

    ln = sub.add_parser("launch", help="render + push a run kernel")
    ln.add_argument("--preset", choices=["smoke", "runb", "runc"], default=None,
                    help="smoke: cheap full-recipe validation; runb: the original "
                         "overnight run (critic + anchors + 11h cap); runc: runb "
                         "plus signal-honesty shaping and best.pt tracking.")
    ln.add_argument("--confirm-cost", action="store_true",
                    help="required to launch a run above the smoke threshold")
    # A curated subset of the most-tuned RunSpec fields; the rest keep defaults.
    ln.add_argument("--total-rl-steps", type=int)
    ln.add_argument("--num-envs", type=int)
    ln.add_argument("--d-model", dest="d_model", type=int)
    ln.add_argument("--layers", type=int)
    ln.add_argument("--resume", type=str,
                    help="resume the RL phase from a prior last.pt on the dataset")

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
