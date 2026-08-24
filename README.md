# Becca AI

Python 3.11+ training, evaluation, and serving for Beccaccino bots.

The package contains a rules-compatible game engine, Gymnasium environments,
behavioral cloning, PPO self-play, held-out evaluation, PIMC search, and the
raw-state FastAPI endpoint used by the backend.

## Install

```bash
cd ai
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,train,serve]"
```

Core dependencies are Gymnasium and NumPy. The optional extras add PyTorch and
training tools, or FastAPI and the torch-backed serving tiers.

## Validate

```bash
pytest
ruff check .
ruff format --check .
python -m scripts.gen_bot_fixtures
git diff --exit-code serving/fixtures/
```

CI also builds a wheel, installs it outside the source tree, and imports the
`inference` and `serving` packages from that wheel.

## Train

The recommended recipe is behavioral cloning followed by PPO self-play:

```bash
python -m scripts.bc_then_rl \
  --network-version 4 \
  --bc-games 3000 \
  --total-rl-steps 5000000 \
  --num-envs 32 \
  --wp-mix 5,41 \
  --eval-win-points 41 \
  --centralized-critic \
  --anchor-bc \
  --device cuda
```

For a short local PPO smoke:

```bash
python -m scripts.train \
  --steps 100000 \
  --num-envs 2 \
  --steps-per-env 64 \
  --win-points 5 \
  --hidden 64 \
  --layers 2 \
  --no-wandb \
  --device cpu
```

`training/engine.py` is the only production PPO lifecycle. The script modules
are configuration adapters; BC collection runs before the shared engine.

For Kaggle setup, smoke, resume, and Run D2 commands, follow
[docs/TRAINING_RUNBOOK.md](docs/TRAINING_RUNBOOK.md). A paid run must not launch
until the current checkpoint format passes its own stop/pull/push/resume smoke.

## Evaluate

Training evaluation and `best.pt` are monitoring signals, not champion
promotion. Score a frozen candidate directly against the incumbent on a fresh,
predeclared mirrored deal block:

```bash
python -m scripts.score_checkpoints \
  --candidate checkpoints/candidate.pt \
  --incumbent checkpoints/deployed.pt \
  --protocol-id "${PROTOCOL_ID}" \
  --seed-base "${FRESH_SEED_BASE}" \
  --games 1000 \
  --output "runs/${PROTOCOL_ID}/score.jsonl"
```

The command persists checkpoint hashes, both sides of every deal, confidence
intervals, and public-state slices. See
[docs/EVALUATION_PROTOCOL.md](docs/EVALUATION_PROTOCOL.md) for the binding
promotion and NearPerfect-v1 gates. Historical results are kept separately in
[docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).

## Serve

```bash
uvicorn serving.app:app --host 0.0.0.0 --port 8011
curl http://localhost:8011/tiers
```

The backend calls `POST /act` with raw game state. Python owns state adaptation,
observation encoding, checkpoint inference, legality validation, and action
decoding. `GET /tiers` reports only tiers whose required local checkpoints are
available.

The pre-encoded `/predict` and ONNX path were retired because no deployed
consumer used them.

## Contracts

- The current public observation has 518 features. The 462-feature and
  470-feature layouts remain loadable for legacy inference, but cannot resume
  current training.
- The policy action space has 160 slots: 40 cards by no signal, striscio,
  busso, or volo. The engine masks illegal actions.
- Current format-3 resumable checkpoints include hashes, provenance, RNG,
  vector-game state, pending rewards, rollout carry, and normalizer chains.
  Exact continuation is pinned on CPU; exact GPU bit reproducibility is not
  claimed.
- `best.pt` is a teacher-coupled monitoring candidate. Promotion requires the
  held-out paired protocol.
- `esperto` uses the shared PIMC agent. Search correctness is tested, but its
  current strength and latency promotion experiments remain unrun.
- No checked-in artifact supports a NearPerfect-v1 claim.
- Python/backend rule and encoding parity are pinned by unit vectors, committed
  bot fixtures, the backend fixture consumer, and the runtime legality gate.

## Layout

```text
becca_env/    Rules, game state, Gymnasium environment, observations
training/     Shared PPO engine, rollout, networks, checkpoints, curriculum
evaluation/   Arena, heuristic baseline, Elo, statistics, protocols
inference/    Determinization, hand sampling, shared PIMC agent
serving/      Raw-state FastAPI endpoint, tier loading, parity fixtures
scripts/      Training, scoring, Kaggle, benchmark, and audit CLIs
tests/        Unit, regression, serving, packaging, and parity coverage
docs/         Current runbook, evaluation protocol, experiment ledger, archive
```
