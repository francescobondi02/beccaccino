# Becca AI — Reinforcement Learning for Beccaccino

Self-play training system for the Italian card game Beccaccino. The strongest
recipe is a **behavioral-cloning warm-start** (imitate the heuristic) followed by
**PPO self-play** on a **V4 transformer** card encoder, with per-seat GAE, an
opponent diversity pool (with permanent anchors), an optional centralized (CTDE)
critic, curriculum learning, and wandb tracking. Four network families ship
(V1 MLP → V2 residual → V3 factorized head → V4 transformer). The two-phase
BC→PPO pipeline lives in `scripts/bc_then_rl.py`; `training/trainer.py` is the
pure-PPO trainer (also BC-anchor and CTDE aware).

## Setup

```bash
cd ai/
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,train]"

# Optional: wandb for experiment tracking
pip install wandb && wandb login
```

## Running Tests

```bash
pytest                     # Full suite (~200 tests, a few seconds)
pytest tests/test_gae.py   # Just GAE correctness tests
pytest -x                  # Stop on first failure
ruff check .               # Lint
ruff format .              # Auto-format
```

## Training Commands

### Recommended: BC warm-start → PPO self-play (`scripts/bc_then_rl.py`)

The strongest recipe. Behavioral-cloning the heuristic first gives PPO a large
head start. Add `--network-version 4` for the transformer. See
`scripts/kaggle_setup.md` for the full GPU recipe, or drive Kaggle runs from the
CLI with `scripts/kaggle_run.py` (see "Kaggle GPU runs" below).

```bash
python -m scripts.bc_then_rl \
  --network-version 4 --d-model 128 --nhead 4 --layers 3 --dim-feedforward 256 \
  --bc-games 3000 --bc-epochs 5 --total-rl-steps 5000000 \
  --num-envs 32 --win-points 5 --eval-win-points 41 --device cuda
```

### Pure PPO trainer (`training/trainer.py`)

Supports `--network-version {1,2,3,4}`, `--resume`, `--max-hours` (graceful stop
for Kaggle's 12h cap), a global `--seed`, and (via config) a BC-anchor opponent
and a centralized CTDE critic.

### Quick Smoke Test (verify everything works, ~1 min)

```bash
python -m training.trainer \
  --steps 100000 \
  --num-envs 2 \
  --steps-per-env 64 \
  --win-points 5 \
  --hidden 64 \
  --layers 2 \
  --no-wandb \
  --eval-every 10 \
  --eval-games 20 \
  --device cpu
```

### Phase 1: Short Games (learn basic trick-taking, ~30 min CPU / ~10 min MPS)

```bash
python -m training.trainer \
  --steps 5000000 \
  --num-envs 16 \
  --steps-per-env 256 \
  --win-points 5 \
  --hidden 256 \
  --layers 3 \
  --ent-coef 0.03 \
  --gamma 0.97 \
  --device cpu

# Target: >65% vs random
```

### Phase 2: Full Network, Short Games (~2h on Apple Silicon)

```bash
python -m training.trainer \
  --steps 20000000 \
  --win-points 5 \
  --device mps

# Uses production defaults: 64 envs, 512 steps/env, 512 hidden, 3 layers
# Target: >70% vs random
```

### Phase 3: Full Games (multi-round strategy, ~4-6h)

```bash
python -m training.trainer \
  --steps 50000000 \
  --win-points 41 \
  --device mps \
  --resume checkpoints/final.pt

# Target: >80% vs random
```

### Full Curriculum (auto-advances 5→11→21→41 points, ~8-10h)

```bash
python -m training.trainer \
  --curriculum \
  --steps 100000000 \
  --device mps
```

### Resume from Checkpoint

```bash
python -m training.trainer \
  --resume checkpoints/ckpt_000500.pt \
  --steps 50000000 \
  --device mps
```

## Configuration Variants

### Conservative (stable but slower learning)

```bash
python -m training.trainer \
  --lr 1e-4 \
  --ent-coef 0.05 \
  --ent-coef-final 0.01 \
  --gamma 0.99 \
  --gae-lambda 0.98 \
  --num-envs 32 \
  --steps-per-env 1024 \
  --minibatch 4096 \
  --win-points 5 \
  --device mps
```

### Aggressive (faster convergence, risk of instability)

```bash
python -m training.trainer \
  --lr 5e-4 \
  --ent-coef 0.02 \
  --ent-coef-final 0.003 \
  --gamma 0.995 \
  --num-envs 128 \
  --steps-per-env 256 \
  --minibatch 2048 \
  --epochs 6 \
  --win-points 5 \
  --device mps
```

### Legacy Network (V1, smaller, for comparison)

```bash
python -m training.trainer \
  --network-version 1 \
  --hidden 256 \
  --layers 2 \
  --steps 5000000 \
  --win-points 5 \
  --no-wandb \
  --device cpu
```

### CPU-Only (no GPU, for cloud/server training)

```bash
python -m training.trainer \
  --num-envs 32 \
  --steps-per-env 512 \
  --steps 50000000 \
  --win-points 5 \
  --device cpu
```

## Monitoring Training

```bash
# TensorBoard (always available)
tensorboard --logdir runs/

# wandb (if configured)
# Dashboard at: https://wandb.ai/<your-username>/becca-ai
```

Key metrics to watch:
- `eval/vs_random` — win rate against random baseline (primary success metric)
- `train/entropy` — should decrease slowly (exploration → exploitation)
- `train/explained_variance` — should trend toward 1.0 (value function accuracy)
- `train/approx_kl` — should stay below 0.02 (policy stability)
- `perf/sps` — steps per second (throughput)

## Evaluation

```python
import torch
from training.network import create_network
from evaluation.arena import evaluate_against_random, play_match, NeuralAgent, RandomAgent

# Load trained model
net = create_network(version=2, hidden_size=512, num_layers=3)
ckpt = torch.load("checkpoints/final.pt", weights_only=False)
net.load_state_dict(ckpt["model"])

# Win rate vs random (400 games, balanced sides)
wr = evaluate_against_random(net, num_games=400)
print(f"Win rate: {wr:.1%}")

# Model vs model comparison
net_old = create_network(version=2, hidden_size=512, num_layers=3)
ckpt_old = torch.load("checkpoints/ckpt_000100.pt", weights_only=False)
net_old.load_state_dict(ckpt_old["model"])

result = play_match(NeuralAgent(net), NeuralAgent(net_old), num_games=200)
print(f"New wins: {result.team0_wins}, Old wins: {result.team1_wins}")
```

## Cross-checkpoint Elo ladder

vs-random saturates near 95%, so use a round-robin Elo ladder on a frozen deal
block to rank strong checkpoints against each other:

```bash
python -m scripts.elo_ladder checkpoints/a.pt checkpoints/b.pt --num-games 100
```

## Kaggle GPU runs

Drive Kaggle GPU training from the CLI (no notebook editing). Ships `ai/` as a
dataset, configures a GPU kernel, and launches a run. A `smoke` preset is free;
anything above ~1M steps requires `--confirm-cost`.

```bash
python -m scripts.kaggle_run push-code --create   # first time; else omit --create
python -m scripts.kaggle_run configure            # GPU + internet on
python -m scripts.kaggle_run launch --preset smoke
python -m scripts.kaggle_run status
python -m scripts.kaggle_run pull -p checkpoints/kaggle
```

## ONNX Export & Serving

```bash
# Export trained model to ONNX
python serving/export_onnx.py checkpoints/final.pt --output serving/model.onnx

# Run inference server
pip install -e ".[serve]"
uvicorn serving.app:app --host 0.0.0.0 --port 8090

# Test endpoint
curl -X POST http://localhost:8090/predict \
  -H "Content-Type: application/json" \
  -d '{"obs": [0.0, ...462 floats...], "action_mask": [1.0, ...160 floats...]}'
```

## Benchmarks

```bash
# Environment throughput (no training, raw game speed)
python scripts/benchmark.py
# Expected: ~2400 games/sec single-threaded

# Training throughput (with network inference)
# Expected with production config on Apple Silicon:
#   - 64 envs, 512 hidden: ~5000-8000 SPS
#   - 128 envs, 512 hidden: ~8000-12000 SPS
```

## Architecture

```
becca_env/          Headless game engine + Gymnasium wrapper (obs = 462 floats)
training/           BC + PPO self-play, GAE, opponent pool + anchors, CTDE critic,
                    unified checkpoint/resume, V1–V4 networks
evaluation/         Arena (agent vs agent), Wilson CIs, Elo + round-robin ladder
serving/            FastAPI + ONNX inference (V4-capable export)
scripts/            bc_then_rl (BC→PPO), elo_ladder, kaggle_run, benchmark
inference/          PIMC (perfect-information Monte Carlo) — not yet wired to serving
```

See [SCOPE.md](SCOPE.md) for detailed architecture and roadmap.
