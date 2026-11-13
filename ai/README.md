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

## Generate annotation batches

Annotation scenarios are generated only by an explicit offline command:

```bash
.venv/bin/python -m scripts.generate_annotation_scenarios \
  --master-seed-file .private/annotation-master.seed \
  --batch-id expert-2026-08-a \
  --scenario-count 50 \
  --source-game-count 120 \
  --model-artifact serving/models/run_d2_champion.pt \
  --output-batch out/annotations/expert-2026-08-a.json \
  --manifest out/annotations/expert-2026-08-a.manifest.json \
  --generator-commit "$(git rev-parse HEAD)"
```

Retain the private seed file securely: the same seed bytes and inputs reproduce
the exact batch and manifest, but the seed is never written to either output.
Replenishment is another offline generation and backend import with a new batch
ID, never generation during service startup or a request. See
[docs/EXPERT_DATA_COLLECTION.md](docs/EXPERT_DATA_COLLECTION.md) for seed setup,
batch verification, production import, replenishment, and recovery procedures.
V2 batches balance close briscola choices, lead card/signal decisions, and
publicly identifiable risk plays; they do not feed annotations into training.

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
checkpoints/  Local training output (default ckpt_dir; git-ignored)
runs/         Local metrics and logs (default log_dir; git-ignored)
Dockerfile    Serving image for the Render deployment
render.yaml   Render service definition
CLAUDE.md     Agent-facing development context
```

## Subdirectories & Boundaries

- becca_env: [./becca_env/](./becca_env/) - Pure-Python
  engine (deck, rules, `BeccaGame`), signal convention, 518-feature and frozen
  1888-feature observation encoders, 160-slot action mask, and the
  `BeccaEnv` Gymnasium environment with reward shaping. No I/O.
- training: [./training/](./training/) - Canonical
  `run_ppo` lifecycle, learner/opponent rollouts with per-`(env, seat)` GAE,
  V1–V4 networks, centralized critic, behavioral cloning, and atomic format-3
  checkpoints with SHA-256 sidecars and provenance.
- evaluation: [./evaluation/](./evaluation/) - Random and
  frozen heuristic baselines, seeded arena and mirrored-deal records, Elo,
  confidence intervals, persisted champion protocol, and the fail-closed
  NearPerfect-v1 gate.
- inference: [./inference/](./inference/) - Public-constraint
  hand sampling, determinized game copies, and the shared PIMC search agent.
- serving: [./serving/](./serving/) - FastAPI `/act`,
  `/tiers`, `/health`, `/ready`, `/version`; backend state adapter; tier
  construction; checksum-verified inference artifacts (except `facile`) and
  parity fixtures.
- scripts: [./scripts/](./scripts/) - Operator CLIs for
  training, scoring, champion selection, artifact export, fixture generation,
  Kaggle runs, benchmarks, bot audits, and annotation batches.

## Interface

- Python package roots discovered by setuptools: `becca_env`, `training`,
  `evaluation`, `inference`, `serving` (`[pyproject.toml:tool.setuptools.packages.find]`).
  `scripts` is run from the source tree as `python -m scripts.<name>`.
- Shared agent contract: every agent exposes `select_action(game, seat)`
  returning a `Suit`, a `(Card, Signal | None)` leader pair, or a follower
  `Card` (`[evaluation/arena.py:NeuralAgent]`, `[evaluation/heuristic.py:HeuristicAgent]`,
  `[inference/pimc.py:PIMCAgent]`).
- HTTP contract consumed by the backend: `POST /act`, `GET /ready`,
  `GET /tiers`, `GET /health`, `GET /version` (`[serving/app.py:app]`).
- Deployment: `Dockerfile` installs only the `serve` extra, listens on
  `PORT` (default `10000`) with one uvicorn worker, and fails the build if the
  `esperto` artifact or the `forte` agent cannot load. `render.yaml` deploys it
  on Render Free with `healthCheckPath: /health`
  and the `BOT_SERVICE_TOKEN` secret.

## Invariants

- Rules mirror the backend: teams `{0, 2}` / `{1, 3}`, quattro di denara opens
  round 1, follow suit when able, raw ×3 scoring with a `+3` last-trick bonus
  and `+9` Cricca bonus (`[becca_env/game.py:TEAM_OF_SEAT]`,
  `[becca_env/rules.py:compute_round_scores]`, `[becca_env/game.py:CRICCA_RAW_BONUS]`).
- Signals are legal regardless of honesty; `becca_env/signals.py` is the one
  convention used by reward shaping, the BC teacher, PIMC weighting and audits
  (`[becca_env/signals.py:signal_is_honest]`).
- `EVAL_SEED_BASE` and the heuristic yardstick are frozen
  (`[evaluation/arena.py:EVAL_SEED_BASE]`, `[evaluation/heuristic.py:HeuristicAgent]`).
- Backend and Python exchange enum strings, never card or suit indices
  (`[serving/state_adapter.py:state_dict_to_game]`).

## Side Effects

- Training writes checkpoints, CSV metrics, plots, TensorBoard logs and,
  optionally, Weights & Biases runs; spawns vector-env subprocesses
  (`[training/engine.py:run_ppo]`, `[training/trainer.py:train]`).
- Evaluation writes non-overwritable JSONL score artifacts
  (`[evaluation/protocol.py:write_score_jsonl]`).
- Every checkpoint save runs `git` subprocesses and enumerates installed
  packages for provenance (`[training/checkpoint.py:save_checkpoint_payload]`,
  `[training/provenance.py:checkpoint_provenance]`).
- Serving reads `BOT_SERVICE_TOKEN`, loads `forte` and `esperto` artifacts
  from `serving/models/`, and listens for HTTP (`[serving/app.py:lifespan]`).
  `facile` instead loads a full training checkpoint from
  `checkpoints/kaggle-runb/checkpoints/runB_bc.pt` with `load_checkpoint`
  (`[serving/tiers.py:TIERS]`).
- Scripts write files: `export_inference_artifact` writes an artifact and its
  `.sha256` sidecar; `gen_bot_fixtures` overwrites
  `serving/fixtures/bot_states.json`; `generate_annotation_scenarios` reads the
  master seed and model and writes the batch and manifest; `score_checkpoints`
  writes JSONL (`[scripts/export_inference_artifact.py:main]`,
  `[scripts/gen_bot_fixtures.py:main]`,
  `[scripts/generate_annotation_scenarios.py:write_batch_outputs]`,
  `[scripts/score_checkpoints.py:main]`).
- `scripts/kaggle_run.py` calls the external `kaggle` CLI, and `push-code`
  writes `.source-provenance.json` into the staged dataset
  (`[scripts/kaggle_run.py:_run]`, `[scripts/kaggle_run.py:push_code]`).

## Verification

- Run: `cd ai && pytest`
