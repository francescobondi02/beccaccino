# Training BECCA V4 on a free GPU (Kaggle)

End-to-end recipe for running the BC + PPO pipeline (`scripts/bc_then_rl.py`)
on a Kaggle T4 / P100 notebook. Kaggle is the recommended option:
30 GPU-hrs/week, no idle timeout once the notebook is running, 12h cap per
"Save & Run All" job.

Colab works but disconnects on idle (~90 min) — risky for unattended 8h runs.
Use Kaggle.

## Why GPU matters here

V4 (transformer card encoder) on CPU runs at ~150-200 SPS. On a T4 GPU it
runs at ~2,000-4,000 SPS — **10-20× faster**. That makes 50M-step training
go from "infeasible" to "single overnight job".

## Plan: two runs

| Run | Purpose | d_model | layers | RL steps | Walltime | Target wp=41 |
|---|---|---|---|---|---|---|
| **A — sanity** | Validate the GPU pipeline, verify warm-start carries through | 128 | 3 | 5M | ~1-2h | ≥ 30% |
| **B — real**   | Push past the local plateau                                     | 192 | 4 | 50M | ~6-10h | 50-65% |

Always run **A first**. If A's `vs_heur` curve is climbing past 30% at the end
and `approx_kl` stays below 0.05, **B is safe to launch overnight**. If A is
flat or KL is unstable, fix locally before burning quota on B.

---

## Step 1 — Kaggle account + CLI (one-time)

1. Sign up at [kaggle.com](https://kaggle.com) and verify your phone (required
   to enable GPUs).
2. Profile → **Account** → **Create New API Token** → downloads
   `kaggle.json`.
3. On your Mac:

```bash
mkdir -p ~/.kaggle
mv ~/Downloads/kaggle.json ~/.kaggle/
chmod 600 ~/.kaggle/kaggle.json
pip install --user kaggle
kaggle --version    # confirm CLI works
```

## Step 2 — Package and upload `ai/` as a Kaggle dataset

We ship the entire `ai/` directory as a Kaggle dataset. The notebook copies
it into the writable working dir at runtime.

```bash
# from repo root on Mac
rm -rf /tmp/becca_upload && mkdir -p /tmp/becca_upload
cp -r ai /tmp/becca_upload/

# Strip junk that bloats the upload
find /tmp/becca_upload -name "__pycache__" -type d -prune -exec rm -rf {} +
find /tmp/becca_upload -name ".pytest_cache" -type d -prune -exec rm -rf {} +
rm -rf /tmp/becca_upload/ai/.venv /tmp/becca_upload/ai/runs /tmp/becca_upload/ai/wandb
# Keep only checkpoints we actually want as warm-start (or none for fresh BC):
rm -rf /tmp/becca_upload/ai/checkpoints
mkdir -p /tmp/becca_upload/ai/checkpoints

cd /tmp/becca_upload
kaggle datasets init -p .
# Edit dataset-metadata.json:
#   "title": "becca-ai"
#   "id":    "<your-kaggle-username>/becca-ai"
#   "licenses": [{"name": "CC0-1.0"}]
kaggle datasets create -p . -r zip
```

For subsequent updates after editing code locally:

```bash
# rerun the cleanup above, then:
cd /tmp/becca_upload
kaggle datasets version -p . -m "update YYYY-MM-DD" -r zip
```

The dataset will be **private by default**. That's fine. Copy the dataset
slug — you'll attach it in the notebook.

## Step 3 — Create the notebook

1. [kaggle.com/code](https://kaggle.com/code) → **New Notebook**.
2. Right sidebar → **Settings**:
   - **Accelerator** → `GPU T4 x2` (use only one, but T4×2 is what's offered)
     or `GPU P100`. T4 is fine.
   - **Internet** → On (needed to `pip install` anything we don't have).
   - **Persistence** → Files only (default).
3. Right sidebar → **Add Input** → **Datasets** → search for your
   `becca-ai` dataset → **Add**.
4. Note the path — usually `/kaggle/input/becca-ai/ai`. Use that everywhere.

## Step 4 — Notebook cells

Paste these in order. Run them top to bottom. Each block is one cell.

### Cell 1 — sanity check

```python
import os, sys, subprocess
AI_DIR = "/kaggle/input/becca-ai/ai"
assert os.path.isdir(AI_DIR), f"can't find {AI_DIR}; check the dataset path"

import torch
print("torch:", torch.__version__)
print("cuda:", torch.cuda.is_available(),
      torch.cuda.get_device_name(0) if torch.cuda.is_available() else "(no GPU!)")
assert torch.cuda.is_available(), "GPU not enabled — check Settings → Accelerator"
```

### Cell 2 — copy code into the writable dir, install, run a quick test

```python
import shutil, sys, subprocess, os
WORK = "/kaggle/working/ai"
if not os.path.exists(WORK):
    shutil.copytree(AI_DIR, WORK)
sys.path.insert(0, WORK)

# Minimal extras (torch + numpy already installed on Kaggle)
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                       "gymnasium>=1.0"])

# Quick smoke: V4 unit tests should all pass
os.chdir(WORK)
subprocess.check_call([sys.executable, "-m", "pytest",
                       "tests/test_network_v4.py", "tests/test_imitation.py",
                       "-q", "--no-header"])
```

### Cell 3 — RUN A (sanity, ~1-2h)

```python
import os
os.chdir("/kaggle/working/ai")
os.makedirs("/kaggle/working/checkpoints", exist_ok=True)

!python -m scripts.bc_then_rl \
    --network-version 4 \
    --d-model 128 --nhead 4 --layers 3 --dim-feedforward 256 \
    --bc-games 3000 --bc-epochs 5 --bc-batch-size 1024 --bc-lr 3e-4 \
    --bc-win-points 5 \
    --total-rl-steps 5000000 \
    --num-envs 32 --steps-per-env 512 \
    --win-points 5 --eval-win-points 41 \
    --eval-every 25 --eval-games 100 \
    --pool-save-every 30 \
    --p-latest-opponent 0.5 \
    --device cuda \
    --out-dir /kaggle/working/runs/v4_runA \
    --bc-ckpt /kaggle/working/checkpoints/v4_runA_bc.pt \
    --final-ckpt /kaggle/working/checkpoints/v4_runA_rl.pt
```

What to watch for as it runs:
- BC accuracy at end of Phase 1: should reach **0.85-0.95** (heuristic action accuracy).
- Phase 2 first eval (`update=1`): `vs_heur ≈ 30%` (wp=41) — confirms BC carry-through.
- After ~150 updates: `vs_heur ≥ 35%`, `approx_kl < 0.05`, `entropy` slowly falling.
- After ~300 updates (5M steps): `vs_heur ≥ 35-45%`. Done.

If the curve is flat at 30% by 100 updates AND `approx_kl < 0.005`, the LR is
too low / opponents too weak. Easy fix is `--p-latest-opponent 0.3`.

### Cell 4 — RUN B (real, only if A looked good — ~6-10h)

```python
import os
os.chdir("/kaggle/working/ai")

!python -m scripts.bc_then_rl \
    --network-version 4 \
    --d-model 192 --nhead 6 --layers 4 --dim-feedforward 384 \
    --bc-games 6000 --bc-epochs 6 --bc-batch-size 1024 --bc-lr 3e-4 \
    --bc-win-points 5 \
    --total-rl-steps 50000000 \
    --num-envs 64 --steps-per-env 512 \
    --win-points 5 --eval-win-points 41 \
    --eval-every 50 --eval-games 100 \
    --pool-save-every 50 \
    --p-latest-opponent 0.5 \
    --device cuda \
    --out-dir /kaggle/working/runs/v4_runB \
    --bc-ckpt /kaggle/working/checkpoints/v4_runB_bc.pt \
    --final-ckpt /kaggle/working/checkpoints/v4_runB_rl.pt
```

Targets at wp=41:
- `update≈300`  (15M steps): `vs_heur ≥ 40%`
- `update≈700`  (35M steps): `vs_heur ≥ 50%`
- `update≈1000` (50M steps): `vs_heur ≥ 55-65%`

If `vs_heur` is below 35% at 15M steps, kill the run and try
`--p-latest-opponent 0.3` (more historical opponent diversity) or drop
`--lr 2.5e-4` to `--lr 1.5e-4`.

### Cell 5 — final eval (run after Cell 3 or Cell 4 finishes)

```python
import torch, sys
sys.path.insert(0, "/kaggle/working/ai")
from training.network import create_network
from evaluation.arena import evaluate_against_random
from evaluation.heuristic import evaluate_against_heuristic

CKPT = "/kaggle/working/checkpoints/v4_runB_rl.pt"   # or v4_runA_rl.pt
ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
cfg = ckpt["config"]
net = create_network(version=4,
                     d_model=cfg["d_model"], nhead=cfg["nhead"],
                     num_layers=cfg["num_layers"],
                     dim_feedforward=cfg["dim_feedforward"])
net.load_state_dict(ckpt["model"])
print(f"Steps: {ckpt.get('steps', '?'):,}")
for wp in (5, 11, 41):
    wr_r = evaluate_against_random(net, num_games=500, seed=0)
    wr_h = evaluate_against_heuristic(net, num_games=500, seed=0, win_points=wp)
    print(f"  wp={wp:2d} | random {wr_r:.1%} | heuristic {wr_h:.1%}")
```

### Cell 6 — package outputs for download

Kaggle preserves `/kaggle/working` between cells, but the cleanest way to
get your artifacts back to the Mac is **Save Version → Quick Save → Output
zip**.

You can also download a single file via the Kaggle CLI from your Mac later:

```bash
kaggle kernels output <your-username>/<notebook-slug> -p ./kaggle_out
```

The plot will be at `runs/v4_runB/learning_curve.png`, the checkpoint at
`checkpoints/v4_runB_rl.pt`.

## Step 5 — pull the checkpoint back to the Mac

```bash
# After the notebook finished and you clicked Save Version → Commit:
mkdir -p ~/Desktop/BECCA/ai/checkpoints/kaggle
kaggle kernels output <user>/<notebook-slug> -p ~/Desktop/BECCA/ai/checkpoints/kaggle
```

Then locally:

```bash
cd ~/Desktop/BECCA/ai
source .venv/bin/activate
python -c "
import torch
from training.network import create_network
from evaluation.heuristic import evaluate_against_heuristic
from evaluation.arena import evaluate_against_random

ckpt = torch.load('checkpoints/kaggle/v4_runB_rl.pt', map_location='cpu', weights_only=False)
cfg = ckpt['config']
net = create_network(version=4, d_model=cfg['d_model'], nhead=cfg['nhead'],
                     num_layers=cfg['num_layers'], dim_feedforward=cfg['dim_feedforward'])
net.load_state_dict(ckpt['model'])
print('vs random   :', evaluate_against_random(net, 500, seed=0))
print('vs heur wp=41:', evaluate_against_heuristic(net, 500, seed=0, win_points=41))
"
```

## Cost reality

Free Kaggle: **30 GPU-hrs/week**. RUN B uses ~6-10h, RUN A ~1-2h. So you
have budget for 2-3 RUN B's per week — comfortable for iterating.

If you outgrow free quota:
- **Lambda Labs Cloud**: ~$0.50/hr for an RTX 4090 (3-4× faster than T4)
- **RunPod / Vast.ai**: similar pricing, more flexible

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cuda: False` in cell 1 | Accelerator not enabled | Settings → Accelerator → GPU T4 x2 |
| `ModuleNotFoundError: gymnasium` | Cell 2 install skipped | Re-run cell 2 |
| Tests in Cell 2 fail | Stale dataset | Re-upload via `kaggle datasets version` |
| `vs_heur` stuck at ~30% at update 100 | Opponent pool too sparse | `--p-latest-opponent 0.3` |
| `approx_kl > 0.1` early | LR too high for big net | Drop `--lr` to `1.5e-4` |
| Out-of-memory mid-run | Batch too big for T4 | Reduce `--num-envs` 64→32 or `--steps-per-env` 512→256 |
| Notebook killed at 12h | Kaggle Save & Run timeout | Reduce `--total-rl-steps` to fit; resume not yet supported |
