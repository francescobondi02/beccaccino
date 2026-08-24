"""Drive Kaggle GPU training runs from the CLI without hand-editing the notebook.

The loop: ship ai/ as the dataset DATASET_SLUG -> a script kernel KERNEL_SLUG
copies it and runs scripts.bc_then_rl with a generated flag set -> pull outputs.
Shells out to the authenticated `kaggle` CLI (2.2.x) via subprocess.

Safety (binding): a SMOKE preset launches without confirmation; anything above
SMOKE_MAX_STEPS is REFUSED unless --confirm-cost is passed. This tool must never
autonomously launch a multi-hour run.

Verbs:
  push-code [--create] [-m MSG]   sync ai/ -> new dataset version (or create)
  push-state [--create] [-m MSG]  sync resumable state -> dedicated dataset
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

from training.config import TrainConfig
from training.provenance import SOURCE_MANIFEST_FILENAME, source_manifest

# --- Single source of truth for slugs/paths (edit KAGGLE_USER for your account) ---
KAGGLE_USER = "fbondi"
DATASET_SLUG = f"{KAGGLE_USER}/becca-ai"
STATE_DATASET_SLUG = f"{KAGGLE_USER}/becca-ai-state"
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
AUTO_RESUME = "AUTO"
STATE_MANIFEST = "state-manifest.json"
STATE_ALLOWLIST = (
    "checkpoints/last.pt",
    "checkpoints/last.pt.sha256",
    "checkpoints/last.prev.pt",
    "checkpoints/last.prev.pt.sha256",
    "checkpoints/best.pt",
    "checkpoints/best.pt.sha256",
    "checkpoints/best.prev.pt",
    "checkpoints/best.prev.pt.sha256",
)

# Throughput / cost model (observed T4 transformer throughput).
MEASURED_SPS = 760  # Run C empirical: 30M steps in 11.0h on T4
KAGGLE_SESSION_CAP_HOURS = 12
SECONDS_PER_HOUR = 3600
SMOKE_MAX_STEPS = 1_000_000  # anything above this needs --confirm-cost
SMOKE_BENCHMARK_ENVS = (8, 16, 32, 64)
SMOKE_BENCHMARK_SECONDS = 10

# Dirs/patterns stripped from the ai/ upload (bloat / secrets / local state).
STAGE_IGNORE = shutil.ignore_patterns(
    "__pycache__",
    ".venv",
    "runs",
    "wandb",
    "checkpoints",
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    "*.log",
    ".DS_Store",
)

AI_ROOT = Path(__file__).resolve().parent.parent  # the ai/ package root


def _kaggle_train_config() -> TrainConfig:
    """Training defaults for an ad-hoc Kaggle BC-to-PPO run."""
    return TrainConfig(
        network_version=4,
        hidden_size=256,
        num_layers=3,
        d_model=128,
        nhead=4,
        dim_feedforward=256,
        total_timesteps=5_000_000,
        num_envs=32,
        steps_per_env=512,
        win_points=5,
        eval_win_points=41,
        eval_every=25,
        eval_games=100,
        pool_save_every=30,
        save_last_every=10,
        p_latest_opponent=0.5,
        device="cuda",
        lr=2.5e-4,
        ent_coef=0.02,
        ent_coef_final=0.005,
        seed=0,
        ckpt_every=None,
        eval_at_start=True,
        write_final_checkpoint=False,
        final_eval=False,
        ckpt_dir="/kaggle/working/checkpoints",
        use_wandb=False,
    )


@dataclass
class RunSpec:
    """Kaggle orchestration around the canonical PPO training configuration."""

    training: TrainConfig = field(default_factory=_kaggle_train_config)
    bc_games: int = 3000
    bc_epochs: int = 5
    bc_batch_size: int = 1024
    bc_lr: float = 3e-4
    bc_win_points: int = 5
    out_dir: str = "/kaggle/working/runs/run"
    bc_ckpt: str = "/kaggle/working/checkpoints/run_bc.pt"
    final_ckpt: str = "/kaggle/working/checkpoints/run_rl.pt"
    run_id: str | None = None
    anchor_bc: bool = False
    extra_flags: list[str] = field(default_factory=list)

    def to_cli_args(self) -> list[str]:
        """Render to the scripts.bc_then_rl flag list."""
        cfg = self.training
        args = [
            "--network-version",
            str(cfg.network_version),
            "--d-model",
            str(cfg.d_model),
            "--nhead",
            str(cfg.nhead),
            "--layers",
            str(cfg.num_layers),
            "--dim-feedforward",
            str(cfg.dim_feedforward),
            "--bc-games",
            str(self.bc_games),
            "--bc-epochs",
            str(self.bc_epochs),
            "--bc-batch-size",
            str(self.bc_batch_size),
            "--bc-lr",
            str(self.bc_lr),
            "--bc-win-points",
            str(self.bc_win_points),
            "--total-rl-steps",
            str(cfg.total_timesteps),
            "--num-envs",
            str(cfg.num_envs),
            "--steps-per-env",
            str(cfg.steps_per_env),
            "--eval-win-points",
            str(cfg.eval_win_points),
            "--eval-every",
            str(cfg.eval_every),
            "--eval-games",
            str(cfg.eval_games),
            "--pool-save-every",
            str(cfg.pool_save_every),
            "--save-last-every",
            str(cfg.save_last_every),
            "--p-latest-opponent",
            str(cfg.p_latest_opponent),
            "--lr",
            str(cfg.lr),
            "--ent-coef",
            str(cfg.ent_coef),
            "--ent-coef-final",
            str(cfg.ent_coef_final),
            "--signal-honesty-coef",
            str(cfg.signal_honesty_coef),
            "--signal-honesty-coef-final",
            str(cfg.signal_honesty_coef_final),
            "--signal-honesty-frac",
            str(cfg.signal_honesty_frac),
            "--hidden",
            str(cfg.hidden_size),
            "--seed",
            str(cfg.seed),
            "--device",
            cfg.device,
            "--out-dir",
            self.out_dir,
            "--bc-ckpt",
            self.bc_ckpt,
            "--final-ckpt",
            self.final_ckpt,
        ]
        if cfg.wp_mix is not None:
            args += ["--wp-mix", ",".join(str(value) for value in cfg.wp_mix)]
        else:
            args += ["--win-points", str(cfg.win_points)]
        if self.run_id is not None:
            args += ["--run-id", self.run_id]
        if cfg.centralized_critic:
            args.append("--centralized-critic")
        if self.anchor_bc:
            args.append("--anchor-bc")
        if cfg.max_hours is not None:
            args += ["--max-hours", str(cfg.max_hours)]
        if cfg.resume_from is not None:
            args += ["--resume", cfg.resume_from]
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
    training=dataclasses.replace(
        _kaggle_train_config(),
        total_timesteps=200_000,
        num_envs=16,
        eval_every=50,
        eval_games=20,
        centralized_critic=True,
        signal_honesty_coef=SIGNAL_HONESTY_COEF,
        signal_honesty_frac=SIGNAL_HONESTY_FRAC,
    ),
    bc_games=200,
    bc_epochs=1,
    anchor_bc=True,
    run_id="smoke",
    out_dir="/kaggle/working/runs/smoke",
    bc_ckpt="/kaggle/working/checkpoints/smoke_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/smoke_rl.pt",
)

# The real overnight run: BC + long PPO self-play on the V4 transformer with the
# centralized critic and BC anchor, capped under Kaggle's 12h session limit so it
# saves last.pt and can be resumed. Above SMOKE_MAX_STEPS -> needs --confirm-cost.
RUN_B_SPEC = RunSpec(
    training=dataclasses.replace(
        _kaggle_train_config(),
        d_model=192,
        nhead=6,
        num_layers=4,
        dim_feedforward=384,
        total_timesteps=30_000_000,
        num_envs=64,
        steps_per_env=512,
        eval_every=50,
        eval_games=200,
        pool_save_every=50,
        centralized_critic=True,
        max_hours=11.0,
    ),
    bc_games=6000,
    bc_epochs=6,
    anchor_bc=True,
    run_id="runB",
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
    training=dataclasses.replace(
        RUN_B_SPEC.training,
        signal_honesty_coef=SIGNAL_HONESTY_COEF,
        signal_honesty_frac=SIGNAL_HONESTY_FRAC,
    ),
    run_id="runC",
    out_dir="/kaggle/working/runs/runC",
    bc_ckpt="/kaggle/working/checkpoints/runC_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/runC_rl.pt",
)

HISTORICAL_RUN_D_SPEC = dataclasses.replace(
    RUN_C_SPEC,
    training=dataclasses.replace(
        RUN_C_SPEC.training,
        total_timesteps=60_000_000,
        win_points=5,
        wp_mix=[5, 41],
        save_last_every=10,
        max_hours=9.75,
    ),
    run_id="runD",
    out_dir="/kaggle/working/runs/runD",
    bc_ckpt="/kaggle/working/checkpoints/runD_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/runD_rl.pt",
)

# Run D is a historical pre-A0-A8 artifact and must never be resumed under the
# corrected training contract. Run D2 intentionally keeps its budget and batch
# geometry while using a fresh identity and regenerated BC data.
RUN_D2_SPEC = dataclasses.replace(
    HISTORICAL_RUN_D_SPEC,
    run_id="runD2",
    out_dir="/kaggle/working/runs/runD2",
    bc_ckpt="/kaggle/working/checkpoints/runD2_bc.pt",
    final_ckpt="/kaggle/working/checkpoints/runD2_rl.pt",
)


def est_hours(total_rl_steps: int) -> float:
    """Rough GPU-hours for the RL phase at the measured T4 throughput."""
    return total_rl_steps / MEASURED_SPS / SECONDS_PER_HOUR


def render_kernel_script(spec: RunSpec) -> str:
    """Generate the Python script-kernel body that runs this spec on Kaggle.

    The code dir is auto-detected by walking /kaggle/input for the marker file,
    so the kernel is robust to however Kaggle mounts/extracts the dataset."""
    return (
        "import hashlib, json, os, sys, shutil, subprocess\n"
        f"INPUT_ROOT = {KAGGLE_INPUT_ROOT!r}\n"
        f"MARKER = {CODE_MARKER!r}\n"
        f"WORK = {WORK_DIR_ON_KAGGLE!r}\n"
        f"STATE_MANIFEST = {STATE_MANIFEST!r}\n"
        f"AUTO_RESUME = {AUTO_RESUME!r}\n"
        f"OUT_DIR = {spec.out_dir!r}\n"
        f"FINAL_CKPT = {spec.final_ckpt!r}\n"
        f"EXPECTED_RUN_ID = {spec.run_id!r}\n"
        "code_dirs = [d for d, _, _ in os.walk(INPUT_ROOT)\n"
        "             if os.path.isfile(os.path.join(d, MARKER))]\n"
        "assert len(code_dirs) == 1, (\n"
        "    f'expected exactly one {MARKER} under {INPUT_ROOT}; found {code_dirs}'\n"
        ")\n"
        "code_dir = code_dirs[0]\n"
        "if not os.path.exists(WORK):\n"
        "    shutil.copytree(code_dir, WORK)\n"
        f"FLAGS = {spec.to_cli_args()!r}\n"
        "if '--resume' in FLAGS and FLAGS[FLAGS.index('--resume') + 1] == AUTO_RESUME:\n"
        "    last_matches = [os.path.join(d, 'last.pt') for d, _, files in os.walk(INPUT_ROOT)\n"
        "                    if 'last.pt' in files]\n"
        "    assert len(last_matches) == 1, (\n"
        "        f'expected exactly one last.pt under {INPUT_ROOT}; found {last_matches}'\n"
        "    )\n"
        "    state_root = os.path.dirname(os.path.dirname(last_matches[0]))\n"
        "    manifest_path = os.path.join(state_root, STATE_MANIFEST)\n"
        "    assert os.path.isfile(manifest_path), f'missing state manifest: {manifest_path}'\n"
        "    with open(manifest_path) as f:\n"
        "        manifest = json.load(f)\n"
        "    for relative, expected in manifest.get('artifacts', {}).items():\n"
        "        artifact = os.path.join(state_root, relative)\n"
        "        assert os.path.isfile(artifact), f'missing state artifact: {artifact}'\n"
        "        assert os.path.getsize(artifact) == expected['size'], (\n"
        "            f'state artifact size mismatch: {artifact}'\n"
        "        )\n"
        "        digest = hashlib.sha256()\n"
        "        with open(artifact, 'rb') as stream:\n"
        "            for chunk in iter(lambda: stream.read(1024 * 1024), b''):\n"
        "                digest.update(chunk)\n"
        "        assert digest.hexdigest() == expected['sha256'], (\n"
        "            f'state artifact hash mismatch: {artifact}'\n"
        "        )\n"
        "    if EXPECTED_RUN_ID is not None:\n"
        "        assert manifest.get('run_id') == EXPECTED_RUN_ID, (\n"
        "            f\"state run_id={manifest.get('run_id')!r} does not match \"\n"
        "            f'expected {EXPECTED_RUN_ID!r}'\n"
        "        )\n"
        "    checkpoint_dir = os.path.dirname(FINAL_CKPT)\n"
        "    os.makedirs(checkpoint_dir, exist_ok=True)\n"
        "    for name in (\n"
        "        'last.pt', 'last.pt.sha256', 'last.prev.pt', 'last.prev.pt.sha256',\n"
        "        'best.pt', 'best.pt.sha256', 'best.prev.pt', 'best.prev.pt.sha256',\n"
        "    ):\n"
        "        source = os.path.join(state_root, 'checkpoints', name)\n"
        "        if os.path.isfile(source):\n"
        "            shutil.copy2(source, os.path.join(checkpoint_dir, name))\n"
        "    FLAGS[FLAGS.index('--resume') + 1] = os.path.join(checkpoint_dir, 'last.pt')\n"
        "    metrics_src = os.path.join(\n"
        "        state_root, 'runs', os.path.basename(OUT_DIR.rstrip('/')), 'metrics.csv'\n"
        "    )\n"
        "    if os.path.isfile(metrics_src):\n"
        "        os.makedirs(OUT_DIR, exist_ok=True)\n"
        "        shutil.copy2(metrics_src, os.path.join(OUT_DIR, 'metrics.csv'))\n"
        "os.chdir(WORK)\n"
        "sys.path.insert(0, WORK)\n"
        "subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'gymnasium>=1.0'])\n"
        "os.makedirs(os.path.dirname(FINAL_CKPT), exist_ok=True)\n"
        f"SMOKE_BENCHMARK_ENVS = {SMOKE_BENCHMARK_ENVS!r}\n"
        f"SMOKE_BENCHMARK_SECONDS = {SMOKE_BENCHMARK_SECONDS!r}\n"
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
        "if EXPECTED_RUN_ID == 'smoke' and '--resume' not in FLAGS:\n"
        "    benchmark_device = FLAGS[FLAGS.index('--device') + 1]\n"
        "    subprocess.check_call([\n"
        "        sys.executable, '-m', 'scripts.benchmark', '--sweep-envs',\n"
        "        ','.join(str(value) for value in SMOKE_BENCHMARK_ENVS),\n"
        "        '--seconds', str(SMOKE_BENCHMARK_SECONDS), '--win-points', '5',\n"
        "        '--include-full-obs', '--device', benchmark_device,\n"
        "    ])\n"
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
        (staged / SOURCE_MANIFEST_FILENAME).write_text(
            json.dumps(source_manifest(AI_ROOT), indent=2, sort_keys=True)
        )
        meta = {"title": "becca-ai", "id": DATASET_SLUG, "licenses": [{"name": "CC0-1.0"}]}
        (Path(tmp) / "dataset-metadata.json").write_text(json.dumps(meta, indent=2))
        if create:
            _run(["kaggle", "datasets", "create", "-p", tmp, "-r", "zip"])
        else:
            _run(["kaggle", "datasets", "version", "-p", tmp, "-m", message, "-r", "zip"])


def push_state(source: str, create: bool, message: str) -> None:
    """Publish only resumable checkpoints and CSV history to the state dataset."""
    source_dir = Path(source)
    last_path = source_dir / STATE_ALLOWLIST[0]
    if not last_path.is_file():
        raise SystemExit(f"missing resumable checkpoint: {last_path}")

    from training.checkpoint import checkpoint_sha256, load_resumable_checkpoint

    checkpoint = load_resumable_checkpoint(last_path, map_location="cpu")
    contract = checkpoint.get("resume_contract")
    if not isinstance(contract, dict) or not contract.get("run_id"):
        raise SystemExit("last.pt has no run identity; start the run with the current trainer")

    with tempfile.TemporaryDirectory() as tmp:
        staged_root = Path(tmp)
        staged_files = []
        for relative in STATE_ALLOWLIST:
            src = source_dir / relative
            if not src.is_file():
                continue
            dest = staged_root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            staged_files.append(relative)

        runs_dir = source_dir / "runs"
        if runs_dir.is_dir():
            for src in sorted(runs_dir.rglob("metrics.csv")):
                relative = src.relative_to(source_dir)
                dest = staged_root / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                staged_files.append(relative.as_posix())

        manifest = {
            "format": 1,
            "run_id": contract["run_id"],
            "update": checkpoint.get("update"),
            "step": checkpoint.get("step"),
            "files": sorted(staged_files),
            "artifacts": {
                relative: {
                    "sha256": checkpoint_sha256(staged_root / relative),
                    "size": (staged_root / relative).stat().st_size,
                }
                for relative in sorted(staged_files)
            },
            "resume_contract": contract,
        }
        (staged_root / STATE_MANIFEST).write_text(json.dumps(manifest, indent=2))
        metadata = {
            "title": "becca-ai-state",
            "id": STATE_DATASET_SLUG,
            "licenses": [{"name": "CC0-1.0"}],
        }
        (staged_root / "dataset-metadata.json").write_text(json.dumps(metadata, indent=2))
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
    total_timesteps = spec.training.total_timesteps
    hours = est_hours(total_timesteps)
    print(
        f"Estimated RL GPU time: {hours:.2f}h for {total_timesteps:,} steps "
        f"(~{MEASURED_SPS} SPS on T4)."
    )
    if total_timesteps > SMOKE_MAX_STEPS and not confirm_cost:
        raise SystemExit(
            f"REFUSED: {total_timesteps:,} steps exceeds the smoke threshold "
            f"({SMOKE_MAX_STEPS:,}). Re-run with --confirm-cost to launch a real run."
        )
    if hours > KAGGLE_SESSION_CAP_HOURS:
        print(
            f"WARNING: estimate exceeds the {KAGGLE_SESSION_CAP_HOURS}h session cap; "
            "the run will be killed. Use --max-hours in the spec so it saves last.pt."
        )
    with tempfile.TemporaryDirectory() as tmp:
        dataset_sources = [DATASET_SLUG]
        if spec.training.resume_from == AUTO_RESUME:
            dataset_sources.append(STATE_DATASET_SLUG)
        meta = {
            "id": KERNEL_SLUG,
            "title": "becca-training-cli",
            "code_file": "kernel.py",
            "language": "python",
            "kernel_type": "script",
            "enable_gpu": True,
            "machine_shape": MACHINE_SHAPE,
            "enable_internet": True,
            "dataset_sources": dataset_sources,
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


_PRESETS = {
    "smoke": SMOKE_SPEC,
    "runb": RUN_B_SPEC,
    "runc": RUN_C_SPEC,
    "rund2": RUN_D2_SPEC,
}
_RETIRED_PRESETS = {
    "rund": "Run D is historical and predates A0-A8; launch --preset rund2 as a fresh run",
}


def _spec_from_args(a: argparse.Namespace) -> RunSpec:
    if a.preset in _RETIRED_PRESETS:
        raise SystemExit(_RETIRED_PRESETS[a.preset])
    if a.preset:
        preset = _PRESETS[a.preset]
        training = dataclasses.replace(
            preset.training,
            wp_mix=list(preset.training.wp_mix) if preset.training.wp_mix is not None else None,
        )
        spec = dataclasses.replace(preset, training=training)
    else:
        spec = RunSpec()
    # Only override fields the user explicitly set on the CLI (None = unset).
    field_names = {
        "total_rl_steps": "total_timesteps",
        "num_envs": "num_envs",
        "steps_per_env": "steps_per_env",
        "d_model": "d_model",
        "layers": "num_layers",
        "max_hours": "max_hours",
        "resume": "resume_from",
    }
    overrides = {
        config_name: value
        for arg_name, config_name in field_names.items()
        if (value := getattr(a, arg_name, None)) is not None
    }
    if getattr(a, "resume_state", False):
        overrides["resume_from"] = AUTO_RESUME
    return dataclasses.replace(spec, training=dataclasses.replace(spec.training, **overrides))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Drive Kaggle GPU runs for BECCA")
    sub = p.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("push-code", help="sync ai/ to the dataset")
    pc.add_argument("--create", action="store_true", help="create the dataset (first time)")
    pc.add_argument("-m", "--message", default="update", help="version message")

    ps = sub.add_parser("push-state", help="sync resumable state to its dataset")
    ps.add_argument("--from", dest="source", default=PULL_DIR)
    ps.add_argument("--create", action="store_true", help="create the dataset (first time)")
    ps.add_argument("-m", "--message", default="update state", help="version message")

    sub.add_parser("configure", help="enable GPU+internet and attach the dataset")

    ln = sub.add_parser("launch", help="render + push a run kernel")
    ln.add_argument(
        "--preset",
        choices=["smoke", "runb", "runc", "rund", "rund2"],
        default=None,
        help="smoke: cheap full-recipe validation; runb: the original "
        "overnight run (critic + anchors + 11h cap); runc: runb "
        "plus signal-honesty shaping and best.pt tracking; rund: retired "
        "historical identity; rund2: fresh 60M-step mixed wp=5/41 long run.",
    )
    ln.add_argument(
        "--confirm-cost",
        action="store_true",
        help="required to launch a run above the smoke threshold",
    )
    # A curated subset of the most-tuned RunSpec fields; the rest keep defaults.
    ln.add_argument("--total-rl-steps", type=int)
    ln.add_argument("--num-envs", type=int)
    ln.add_argument("--steps-per-env", type=int)
    ln.add_argument("--d-model", dest="d_model", type=int)
    ln.add_argument("--layers", type=int)
    ln.add_argument("--max-hours", type=float)
    resume = ln.add_mutually_exclusive_group()
    resume.add_argument(
        "--resume", type=str, help="resume the RL phase from a prior last.pt on the dataset"
    )
    resume.add_argument(
        "--resume-state",
        action="store_true",
        help="resume from the dedicated state dataset",
    )

    sub.add_parser("status", help="poll the kernel run state")

    pl = sub.add_parser("pull", help="fetch kernel outputs")
    pl.add_argument("-p", "--path", default=PULL_DIR)
    return p


def main() -> None:
    a = build_parser().parse_args()
    if a.cmd == "push-code":
        push_code(create=a.create, message=a.message)
    elif a.cmd == "push-state":
        push_state(source=a.source, create=a.create, message=a.message)
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
