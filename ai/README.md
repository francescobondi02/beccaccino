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

`training/engine.py` is the only production PPO lifecycle, including the
curriculum (`config.curriculum_stages`). The script modules are configuration
adapters; BC collection runs before the shared engine.

Training writes to `checkpoints/` and `runs/` by default; their outputs are
git-ignored local files.

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

`make dev` runs the service in the `bot` container on port 8011 with reload.
To run it on the host:

```bash
BOT_SERVICE_TOKEN=local-secret \
  uvicorn serving.app:app --host 0.0.0.0 --port 8011
curl http://localhost:8011/tiers
curl http://localhost:8011/health
curl -H "Authorization: Bearer local-secret" \
  "http://localhost:8011/ready?tier=forte"
```

The backend calls `POST /act` with raw game state. Python owns state adaptation,
observation encoding, checkpoint inference, legality validation, and action
decoding. `GET /tiers` reports only tiers whose required local checkpoints are
available. `GET /health` is public for platform probes. `GET /ready` lets the
backend verify the requested tier and shared credential before creating a
practice room. The service refuses to start without `BOT_SERVICE_TOKEN` or
when the `forte` agent cannot be built;
`/ready` and `POST /act` require `Authorization: Bearer <token>`.

`forte` serves the locally tested Kaggle policy: 82,280,448 training actions,
366/400 wins against random. Its frozen 1888-feature encoder is selected by the
artifact's input size. This is an operator-selected deployment, not evidence of
superiority over Run D2. `esperto` retains Run D2 with experimental PIMC search.

Known limitation: `facile` loads a full training checkpoint from
`checkpoints/kaggle-runb/checkpoints/runB_bc.pt`, not a verified inference
artifact. That file is git-ignored and `.dockerignore` excludes `checkpoints`,
so the deployment image cannot serve `facile` and `GET /tiers` omits it there.
The decision on this tier is pending.

The supported online target is a Render Free Docker service. The `Dockerfile`
defaults to `PORT=10000` (the local example above uses 8011), verifies the
`esperto` artifact and builds the `forte` agent at image build time, and runs
one uvicorn worker. `render.yaml` sets `healthCheckPath: /health`. Its cold start is handled by the backend before
practice-room creation. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the platform decision, deployment
procedure, secrets, and verification gates.

The pre-encoded `/predict` and ONNX path were retired because no deployed
consumer used them.

## Contracts

Observation size, action space, checkpoint format, promotion and
Python/backend parity rules are in [CLAUDE.md](./CLAUDE.md#invariants).

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
checkpoints/  Local training output (default ckpt_dir; git-ignored)
runs/         Local metrics and logs (default log_dir; git-ignored)
Dockerfile    Serving image for the Render deployment
render.yaml   Render service definition
CLAUDE.md     Rules and invariants for agents
```
