# Becca AI Development Context

## Scope

This submodule owns offline training, evaluation, search, and bot inference for
Beccaccino. The TypeScript backend remains authoritative for persisted online
games; the Python engine exists for high-throughput training and serving.

## Structure

```text
becca_env/
  deck.py          Cards, suits, strengths, and points
  rules.py         Follow-suit, trick winner, and round scoring
  game.py          Match state machine
  observation.py   Public and centralized observation encoders
  env.py           Gymnasium environment and rewards
  signals.py       Shared signal convention
training/
  engine.py        Canonical PPO lifecycle
  trainer.py       Legacy-compatible CLI/setup adapter
  rollout.py       Per-env, per-seat GAE and reward credit
  dual_rollout.py  Production learner/opponent collection
  network.py       V1-V4 policies and centralized critic
  checkpoint.py    Atomic save/load, hashes, provenance, fallback
  vec_env.py       Vector workers and exact state snapshots
evaluation/
  arena.py         Canonical seeded match runner and mirrored records
  heuristic.py     Frozen rule-agent baseline
  protocol.py      Persisted champion decisions
inference/
  hand_sampler.py  Public-constraint hand sampling
  determinized.py  Determinized game copies
  pimc.py          Shared PIMC config, agent, and search
serving/
  app.py           Raw-state /act and /tiers endpoints
  state_adapter.py Backend DTO conversion
  tiers.py         Facile, medio, forte, esperto construction
  fixtures/        Cross-language observation fixtures
```

## Invariants

### Rules and actions

- The engine enforces legal play. The policy cannot violate follow-suit or play
  a card it does not hold.
- The action space is 160 slots: 40 cards by four signal variants.
- A trick leader may choose no signal, striscio, busso, or volo. Followers use
  only the no-signal slot.
- Dishonest signals remain legal. `becca_env/signals.py` defines the convention
  used by the teacher, shaping, and audits.

### Observations

Current public observations have 518 floats:

| Offset | Meaning |
|---|---|
| 0:462 | legacy public layout |
| 462:464 | current-round raw captures by team |
| 464:466 | current-round trick counts by team |
| 466:470 | viewer-relative caller seat |
| 470:518 | four newest-first signal records |

`encode_full_state` appends three hidden hands for a 638-feature CTDE critic.
That full state is train-time only.

The 462 and 470 prefixes remain loadable for legacy inference. They cannot
resume current 518-feature training.

### Rewards and rollout

- `reward` belongs to the current action.
- `info["prior_reward"]` is retro-credited to the seat's previous transition.
- Production self-play uses `training.dual_rollout`; only learner-team
  transitions enter the buffer.
- GAE chains are isolated by `(env, seat)` and cut at game boundaries.

### Training

- `training.engine.run_ppo` owns rollout, updates, schedules, evaluation,
  curriculum, checkpoints, deadlines, and resume.
- `scripts.train` and `training.trainer` adapt CLI/config to the engine.
- `scripts.bc_then_rl` performs BC setup, then calls the same engine.
- A resume keeps the original final horizon and immutable resume contract.
  Completed runs and changed horizons fail closed.

### Checkpoints

- Current resumable artifacts use format 3, SHA-256 sidecars, atomic replace,
  prior-generation fallback, and source/runtime provenance.
- Exact CPU continuation includes RNG, vector games, pending rewards, current
  observations, rollout carry, and return-normalizer chains.
- Legacy checkpoints remain inference/warm-start inputs only.
- `best.pt` is monitoring-only and never automatically replaces a champion.

### Evaluation

- `evaluation.arena.play_recorded_game` is the single-game executor.
- Historical monitoring uses `evaluate_side_balanced`; promotion and Elo use
  the canonical `iter_mirrored_deals` runner.
- Champion decisions require fresh, predeclared mirrored deals and persisted
  per-deal artifacts.
- An inconclusive result retains the incumbent.
- NearPerfect-v1 is a bounded evidence protocol, not solved play. No current
  artifact passes it.

### Serving

- `/act` is the only inference contract. It accepts raw state and returns a
  briscola or card move.
- `serving/models/run_d2_champion.pt` is the verified model-only artifact used
  by both Run D2 tiers. Regenerate it only from the promoted source checkpoint.
- Service startup preloads `forte`; `/health` is public for platform probes,
  while backend readiness uses authenticated `/ready` and moves use `/act`.
- Render Free is the supported online target. The backend owns cold-start
  readiness before room creation; per-move requests keep their short timeout.
- The removed `/predict`/ONNX path must not be reintroduced without a deployed
  consumer and parity with `/act`.
- `esperto` uses the same `inference.pimc.PIMCAgent` as evaluation.
- Python/backend parity is guarded by rule vectors, committed fixtures, the
  backend fixture test, and `/act`'s legal-card disagreement gate.

## Validation

```bash
pytest
ruff check .
ruff format --check .
python -m scripts.gen_bot_fixtures
git diff --exit-code serving/fixtures/
```

Build and smoke the wheel when package discovery changes:

```bash
python -m pip wheel --no-deps --no-build-isolation --wheel-dir /tmp/becca-wheel .
```

Build the deployment image when serving dependencies, artifacts, or startup
behavior changes:

```bash
docker build -t becca-ai .
```

## Documentation

- `README.md`: install and short commands
- `docs/TRAINING_RUNBOOK.md`: current operator procedure
- `docs/EVALUATION_PROTOCOL.md`: binding benchmark and promotion gates
- `docs/EXPERIMENTS.md`: append-only historical evidence
- `docs/DEPLOYMENT.md`: inference platform decision and operator runbook
- `docs/archive/`: dated design, analysis, and implementation snapshots

Do not put live status in archived plans. Update the current runbook when an
operator command or checkpoint contract changes, and append an experiment entry
when a run or ablation produces evidence.
