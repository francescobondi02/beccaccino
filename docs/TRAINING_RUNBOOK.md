# Training Runbook

Current operator procedure for local and Kaggle training. Historical results
belong in [EXPERIMENTS.md](EXPERIMENTS.md), not in this runbook.

## 1. Safety Rules

1. Run the full validation gate before uploading code.
2. Run a cheap smoke before any paid or quota-consuming run.
3. Never launch more than 1,000,000 steps without the explicit
   `--confirm-cost` flag.
4. Set the final training horizon in session 1. A resume keeps that horizon,
   run ID, network, batch geometry, schedules, and training hyperparameters.
5. Treat `best.pt` as monitoring only. Promotion happens after training through
   the held-out protocol.
6. Do not call a legacy checkpoint an exact resume. Current resume requires a
   format-3 checkpoint, integrity sidecar, provenance, and vector rollout state.

## 2. Preflight

Start from the exact commit intended for training and record it with the run
identity.

```bash
git status --short
git rev-parse HEAD
pytest
ruff check .
ruff format --check .
python -m scripts.gen_bot_fixtures
git diff --exit-code serving/fixtures/
```

An intentional dirty tree is recorded in checkpoint provenance, but paid runs
should normally use a clean tree so the source can be reconstructed.

Check the local environment:

```bash
python --version
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
python -m scripts.benchmark --sweep-envs 2,4 --seconds 2 --win-points 5 --device cpu
```

## 3. Pipeline

The strong recipe has two phases:

```text
BC  -> masked policy imitation from the heuristic teacher
PPO -> self-play through training.engine with CTDE critic and opponent pool
```

The policy sees only public state. The centralized critic may see hidden hands
during training, but it is never used for serving.

Signals are legal regardless of honesty. To teach the shared convention early
without making silence illegal:

```bash
--signal-honesty-coef 0.05 \
--signal-honesty-coef-final 0.0 \
--signal-honesty-frac 0.5
```

This is a training choice, not a proven strength improvement. A non-zero final
floor is required if the product needs persistent convention honesty.

## 4. Local Smoke

Exercise the canonical PPO engine on CPU:

```bash
python -m scripts.train \
  --steps 100000 \
  --num-envs 2 \
  --steps-per-env 64 \
  --win-points 5 \
  --hidden 64 \
  --layers 2 \
  --eval-every 10 \
  --eval-games 20 \
  --no-wandb \
  --device cpu
```

For the complete BC-to-RL path:

```bash
python -m scripts.bc_then_rl \
  --network-version 4 \
  --d-model 64 \
  --nhead 4 \
  --layers 2 \
  --dim-feedforward 128 \
  --bc-games 200 \
  --bc-epochs 1 \
  --total-rl-steps 200000 \
  --num-envs 4 \
  --steps-per-env 64 \
  --win-points 5 \
  --eval-win-points 5 \
  --eval-every 10 \
  --eval-games 20 \
  --centralized-critic \
  --anchor-bc \
  --device cpu
```

Confirm that the run writes `last.pt`, its `.sha256` sidecar, metrics, and a
plot; that updates advance; and that no fixture changed.

## 5. Kaggle Smoke

Upload the exact source and configure the T4-backed script kernel:

```bash
python -m scripts.kaggle_run push-code -m "current training source"
python -m scripts.kaggle_run configure
python -m scripts.kaggle_run launch --preset smoke
python -m scripts.kaggle_run status
python -m scripts.kaggle_run pull -p checkpoints/kaggle-smoke
```

The smoke runs the full recipe and an 8/16/32/64-worker throughput sweep. Check:

- CUDA is active. A P100 incompatibility may force CPU; do not use that result
  to estimate a paid T4 run.
- BC accuracy is finite and improves from initialization.
- PPO updates, steps, and games increase.
- `last.pt`, its hash sidecar, metrics, and plot exist.
- The final log has no traceback.

## 6. Resume Drill

A real Kaggle dataset round-trip succeeded on 2026-07-28: session 1 stopped at
update 28 and session 2 resumed at update 29, then reached update 56. That proves
the historical dataset plumbing, and is recorded in
[EXPERIMENTS.md](EXPERIMENTS.md).

It does not prove the current format-3 bundle introduced later. Before Run D2,
repeat the drill with current code:

```bash
# Session 1
python -m scripts.kaggle_run launch \
  --preset smoke \
  --total-rl-steps 1000000 \
  --max-hours 0.05
python -m scripts.kaggle_run pull -p checkpoints/kaggle-smoke-session1
python -m scripts.kaggle_run push-state \
  --from checkpoints/kaggle-smoke-session1 \
  -m "current-format smoke session 1"

# Session 2
python -m scripts.kaggle_run launch \
  --preset smoke \
  --total-rl-steps 1000000 \
  --resume-state \
  --max-hours 0.05
python -m scripts.kaggle_run pull -p checkpoints/kaggle-smoke-session2
```

Use `push-state --create` only if the private state dataset does not already
exist. The second log must say it resumed the same run ID at the next update.
Verify that metrics append rather than restart and that checkpoint/state
manifest hashes match.

## 7. Run D2

Historical Run D predates the A0-A8 correctness contract and is retired.
`--preset rund` fails closed. Run D2 is a fresh identity with regenerated
518-feature BC data:

```bash
# Session 1
python -m scripts.kaggle_run launch \
  --preset rund2 \
  --total-rl-steps 60000000 \
  --confirm-cost

# After each capped session
python -m scripts.kaggle_run status
python -m scripts.kaggle_run pull -p checkpoints/kaggle-rund2
python -m scripts.kaggle_run push-state \
  --from checkpoints/kaggle-rund2 \
  -m "runD2 session N"
python -m scripts.kaggle_run launch \
  --preset rund2 \
  --total-rl-steps 60000000 \
  --resume-state \
  --confirm-cost
```

Choose `num_envs` and `steps_per_env` from the current T4 smoke before session 1,
keep the batch at 32,768, and then freeze both values for every resume.

## 8. Read Results

The metrics `steps` column counts learner-team transitions. A learner team owns
two of four seats, so this is roughly half the simulated environment steps.
The `sps` column is simulated environment steps per second.

Rows after the last scheduled evaluation carry the last evaluation value
forward. The final CSV row is therefore not necessarily an evaluation of the
final weights. Score checkpoint files directly.

Audit bot behavior separately:

```bash
python -m scripts.watch_bots --tier forte --games 20
python -m scripts.watch_bots --tier forte --games 1 --trace
```

## 9. Promotion

Freeze candidate and incumbent hashes, predeclare a fresh seed block, then
follow [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md):

```bash
python -m scripts.score_checkpoints \
  --candidate checkpoints/candidate.pt \
  --incumbent checkpoints/deployed.pt \
  --protocol-id "${PROTOCOL_ID}" \
  --seed-base "${FRESH_SEED_BASE}" \
  --games 1000 \
  --output "runs/${PROTOCOL_ID}/score.jsonl"
```

An inconclusive interval retains the incumbent. Do not add deals after seeing
the result. PIMC, observation, signal-head, teacher, reward, and capacity changes
need separate predeclared ablations; changing several factors in one run does
not identify which one helped.
