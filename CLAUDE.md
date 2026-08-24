# AI — Gymnasium Environment for RL Training

Python 3.11+, Gymnasium-based environment for training AI agents to play Beccaccino via self-play reinforcement learning.

## Structure

```
becca_env/
  __init__.py
  deck.py           Card/Suit/Value definitions, 40-card deck, strength and points tables
  rules.py          Core rules: follow_suit_filter, determine_hand_winner, compute_round_scores
  signals.py        The signalling CONVENTION (what busso/striscio/volo claim) —
                    shared by reward shaping, the BC teacher, and the audit
  game.py           Full game state machine (BeccaGame): phases, actions, step()
  observation.py    State → numpy tensor encoding (518 features), action mask (160 slots)
                    + encode_full_state (638) for the centralized CTDE critic
  env.py            Gymnasium wrapper (BeccaEnv) — self-play, scaled rewards
training/
  config.py         TrainConfig dataclass (all hyperparameters) + net_kwargs()
  network.py        BeccaNet V1/V2/V3/V4 (V4 = transformer with card-conditioned
                    signal deltas) + CentralizedCritic;
                    create_network stamps net.config for exact rebuild
  ppo.py            PPO update: clipped surrogate, per-epoch KL early stop, critic hook
  rollout.py        Rollout buffer with per-(env,seat) GAE + full_obs (critic)
  trainer.py        PPO loop (wandb, curriculum, resume, --max-hours, seed, CTDE)
  imitation.py      Behavioral cloning on the heuristic (policy-only warm-start)
  checkpoint.py     Unified save/load, build_net, seed_everything, RNG state
  self_play.py      OpponentPool — FIFO snapshots + permanent anchors
  curriculum.py     Auto-advancing difficulty stages
  vec_env.py        Vectorized envs, disjoint deal streams, exact worker-state snapshots
  normalization.py  Running mean/std + live return-chain checkpoint state
evaluation/
  arena.py          Agent-vs-agent matches, evaluate_against_random(), elo_ladder(), EVAL_SEED_BASE
  heuristic.py      HeuristicAgent baseline + evaluate_against_heuristic()
  stats.py          wilson_interval() confidence bounds
  elo.py            Elo rating tracker
serving/
  app.py            FastAPI: /act (raw state) + /tiers
  state_adapter.py  Backend JSON <-> BeccaGame, so /act reuses the training encoder
  tiers.py          Difficulty tiers: facile/medio/forte/esperto -> agents
  fixtures/         Committed (state, expected_obs) pairs the backend is tested against
inference/          PIMC with hard public constraints, signal-weighted worlds,
                    and match-winning utility — served as the "esperto" tier
scripts/
  bc_then_rl.py     BC warm-start → PPO self-play pipeline (the strong recipe)
  score_checkpoints.py  Persisted mirrored candidate-vs-incumbent champion gate
  elo_ladder.py     Cross-checkpoint Elo ranking CLI
  kaggle_run.py     Drive Kaggle GPU runs from the CLI (smoke-gated)
  watch_bots.py     Audit signal honesty (volo => void, busso => holds strength)
  gen_bot_fixtures.py  Regenerate serving/fixtures/bot_states.json
  benchmark.py      Bare-engine and end-to-end rollout throughput benchmark
docs/
  TRAINING_RUNBOOK.md  How to run + verify a training run (READ BEFORE A GPU RUN)
  EVALUATION_PROTOCOL.md  Champion and NearPerfect-v1 evidence gates
  LONG_RUN_PLAN.md     Long-run readiness status, residual risks, and Run D protocol
  BOT_PLAY_DESIGN.md   Playing against the bots in the real UI
checkpoints/        Saved model checkpoints (.pt files); best.pt = monitoring candidate,
                    final.pt = last
tests/              Pytest suite mirroring the modules above
```

## Game Engine (game.py)

`BeccaGame` is a complete stateful Beccaccino engine:
- Phases: `CHOOSE_BRISCOLA` → `PLAY_CARD` (×10 tricks) → `ROUND_END` → loop or `GAME_OVER`
- Teams: seats {0,2} = team 0, {1,3} = team 1
- `legal_actions()`: returns Suit list (briscola phase) or (Card, Signal|None) tuples (trick leader) or Card list (follower)
- `step(action)` → info dict with event type and details
- Seeded RNG for reproducible games

### Signals
Trick leader can declare: `Signal.STRISCIO`, `Signal.BUSSO`, `Signal.VOLO`, or `None`.
Signals are part of the action space for the leader and stored in `trick_signals`.

The engine does **not** enforce honesty — a dishonest signal is a legal move and must
stay legal. `becca_env/signals.py` defines what each signal *claims*, and is the single
source shared by reward shaping (`env.py`), the BC teacher (`heuristic.py`), and the
audit (`scripts/watch_bots.py`). Training that channel is covered in
`docs/TRAINING_RUNBOOK.md` §3; without `--signal-honesty-coef` the signal slots get no
gradient and a trained policy picks among them at roughly chance.

## Observation Encoding (observation.py)

Feature vector: 518 floats (`OBS_SIZE = 518`). The first 462 and 470 entries
preserve the legacy and A2 layouts so older checkpoints can still be served at
their inferred input width.

| Offset | Size | Feature |
|--------|------|---------|
| 0 | 40 | My hand (binary) |
| 40 | 200 | Per-card status one-hot (5 classes: unseen/mine/partner/left/right) |
| 240 | 160 | Current trick (4 positions × 40 one-hot) |
| 400 | 4 | Briscola suit (one-hot) |
| 404 | 4 | My seat (one-hot) |
| 408 | 4 | Trick starter (one-hot) |
| 412 | 10 | Hand number (one-hot, 1-10) |
| 422 | 10 | Round number (one-hot, capped at 10) |
| 432 | 2 | Normalized scores (team0, team1) |
| 434 | 16 | Void mask (4 relative seats × 4 suits) |
| 450 | 12 | Signal mask (4 relative seats × 3 signal types) |
| 462 | 2 | Current-round captured raw points (team0, team1), normalized by 35 |
| 464 | 2 | Current-round trick counts (team0, team1), normalized by 10 |
| 466 | 4 | Caller seat, viewer-relative one-hot |
| 470 | 48 | Four recent signal records: relative declarer, type, led suit, timing |

`encode_full_state` (638 floats) appends the 3 hidden hands (3×40) for the
centralized CTDE critic — train-time only; the policy never sees it.

The A2/A3 schemas and parity fixtures are implemented, but the architecture is
not empirically promoted. Its fixed-budget three-seed ablation must improve
held-out explained variance or paired playing strength without slice
regressions; that gate remains unrun and unproven.

New V4 policies condition striscio/busso/volo deltas on each candidate card
token. Legacy V4 checkpoints without that stamped head flag retain the original
global signal head for inference only. A4's signal-response and card-only
strength promotion gates remain unrun.

PIMC never assigns a proven-void suit. It weights determinizations by whether
public declarations fit the sampled hand, uses exact match outcomes at the
threshold (including caller tie-break), and searches each card once before the
network picks that card's signal variant. The +2 point paired-strength and
deployment-latency promotion gates remain unrun.

`NearPerfect-v1` is the only defined near-perfect claim, and it means "no
material exploit found under this protocol," not solved play. Run
`scripts.check_near_perfect` against a persisted manifest; missing evidence or
any inconclusive gate fails. No current artifact passes it.

## Action Space

160 discrete actions = 40 cards × 4 signal options (none, striscio, busso, volo).
- Briscola phase: only actions 0-3 valid (mapped to 4 suits)
- Trick leader: card_idx × 4 + signal_idx
- Follower: card_idx × 4 + 0 (only "no signal" slot valid)

Action mask provided in observation dict for legal action filtering.

## Gym Environment (env.py)

`BeccaEnv(gym.Env)` — single-agent wrapper cycling through 4 seats (self-play):
- `reset()` → obs dict with "obs", "action_mask", "current_seat"
- `step(action)` → obs, reward, terminated, truncated, info
- `reward` contains credit generated by the current action; `info["prior_reward"]`
  is retro-credited by collectors to the seat's previous transition
- Reward totals remain round score ±(raw_pts/35), optional shaping, and terminal ±1.0

## Training

**Full procedure, verification steps, and how to read results: `docs/TRAINING_RUNBOOK.md`.**
Read it before launching a GPU run — the costly past mistakes were measuring the wrong
number or shipping the wrong checkpoint, not bad hyperparameters.

The strong recipe is **BC warm-start → PPO self-play** on the V4 transformer
(`scripts/bc_then_rl.py`). `training/trainer.py` is the pure-PPO trainer and now
also supports resume, `--max-hours` graceful stop, global `--seed`,
`--network-version {1,2,3,4}`, a BC-anchor opponent, and a centralized (CTDE)
critic. Both use per-seat GAE, the opponent pool (with anchors), curriculum,
wandb, entropy annealing, signal-honesty shaping, and monitoring-candidate
tracking.

Two things worth knowing before trusting any run's numbers:
- **`best.pt` is a teacher-coupled monitoring peak, not the champion.** Self-play
  is non-monotone, so shortlist checkpoints during training, then directly
  compare the candidate with the incumbent on a fresh mirrored seed block.
  Promotion requires a persisted pairing-aware definitive result.
- **The `steps` column counts learner-team transitions, not env steps** — a team owns 2
  of 4 seats, so it reads ~half the simulated env steps. Units, not a bug.
- **Vector streams are disjoint and exact CPU resume is stateful.** Worker `i`,
  game `g`, uses `base_seed + i + g * num_workers`; checkpoints preserve live
  games, pending rewards, current observations, rollout carry, return chains,
  and RNG. Legacy checkpoints without `rollout_state`, or with 462/470-feature
  inputs, cannot resume current training and must begin a new 518-feature run.
  Exact GPU bit reproducibility is not claimed.

```bash
# Recommended: BC + PPO on the transformer (see scripts/kaggle_setup.md for GPU)
python -m scripts.bc_then_rl --network-version 4 --bc-games 3000 \
  --total-rl-steps 5000000 --num-envs 32 --wp-mix 5,41 \
  --eval-win-points 41 --device cuda

# With a meaningful signal channel (anneals the honesty term to 0 by mid-run)
python -m scripts.bc_then_rl --network-version 4 --signal-honesty-coef 0.05 \
  --signal-honesty-coef-final 0.0 --signal-honesty-frac 0.5 --device cuda

# Pure PPO trainer (short games)
python -m training.trainer --win-points 5 --steps 20000000 --device mps

# Full curriculum training (~8-10h)
python -m training.trainer --curriculum --steps 100000000 --device mps

# Resume across sessions (writes last.pt; --max-hours for Kaggle's 12h cap)
python -m training.trainer --resume checkpoints/last.pt --steps 50000000 --max-hours 11

# Kaggle Run D: preserve run ID, final target, and batch geometry across sessions
python -m scripts.kaggle_run launch --preset rund --confirm-cost
python -m scripts.kaggle_run pull -p checkpoints/kaggle-rund
python -m scripts.kaggle_run push-state \
  --from checkpoints/kaggle-rund --create -m "runD session 1"
python -m scripts.kaggle_run launch --preset rund --resume-state --confirm-cost

# Final champion decision on a fresh one-use seed block
python -m scripts.score_checkpoints \
  --candidate checkpoints/best.pt --incumbent checkpoints/deployed.pt \
  --protocol-id "${PROTOCOL_ID}" --seed-base "${FRESH_SEED_BASE}" \
  --games 1000 --output "runs/${PROTOCOL_ID}/score.jsonl"

# Without wandb (offline)
python -m training.trainer --no-wandb --win-points 5 --steps 5000000
```

Key hyperparameters (defaults in `training/config.py`):
- 64 parallel envs × 512 steps = 32,768 batch size
- GAE: gamma=0.995, lambda=0.95
- Network: V2 3×512 ReLU+LayerNorm residual (~1M params), or V4 transformer
- Entropy: annealed from 0.03 → 0.005
- LR: 2.5e-4 with cosine schedule

## Scoring Notes

Points system uses raw×3 to avoid fractions (same as backend):
- Total raw points in deck: 32 (4 suits × 8 per suit: asso=3 + 5 figures×1)
- Last trick bonus: +3 raw
- Total per round: 35 raw = 11 points + 2 figures remainder
- Game win: cumulative real points (raw // 3) ≥ 41

## Dependencies

```bash
pip install -e ".[dev]"     # Core + pytest + ruff
pip install -e ".[train]"   # + torch + tensorboard + wandb
pip install -e ".[serve]"   # + fastapi + uvicorn + torch
```

## W&B (Weights & Biases) Setup

Training runs are logged to W&B Models for experiment tracking (loss curves, win rate, hyperparameters).

```bash
# 1. Install (included in [train] extra)
pip install -e ".[train]"

# 2. Login (one-time, stores key in ~/.netrc)
wandb login
# Paste API key from https://wandb.ai/authorize

# 3. Runs auto-log to:
#    Entity:  francesco-bondi02-eth-z-rich
#    Project: BECCACCINO-RL
```

To disable wandb for a run: `python -m training.trainer --no-wandb`

## Running Tests

```bash
cd ai
pytest                  # All tests
pytest -x              # Stop on first failure
ruff check .           # Linting
ruff format .          # Auto-format
```

## Playing Against the Bots (serving the game)

Design + first findings: `docs/BOT_PLAY_DESIGN.md`.

```bash
# 1. Serve the four tiers (facile: checkpoints/kaggle-runb/, forte+esperto: checkpoints/kaggle-runc/)
uvicorn serving.app:app --port 8011
curl localhost:8011/tiers            # which tiers this process can actually serve

# 2. Point the backend at it, then use "Pratica contro i bot" in the frontend
#    backend/.env:  BOT_SERVICE_URL=http://localhost:8011

# 3. Audit signal honesty offline (no backend needed)
python -m scripts.watch_bots --tier forte --games 20 --trace
```

`POST /act` takes RAW game state as enum strings and owns encoding, inference, and action
decoding, so the bot always reads the board through the same encoder it trained on. Cards
never cross as indices: Python orders suits DENARA, SPADE, COPPE, BASTONI and Prisma orders
them denara, coppe, spade, bastoni, so an index computed on either side would transpose 20
cards silently.

Three layers guard that boundary — the backend's serializer is the risky part, so all three
are worth keeping green:
1. `tests/test_state_adapter_parity.py` — Python round-trip byte parity (Python vs itself).
2. `serving/fixtures/bot_states.json` — committed (state, obs) pairs the TypeScript
   serializer is asserted against in `backend/tests/integration/botStateFixtures.test.ts`.
   Regenerate with `python -m scripts.gen_bot_fixtures` (must be a no-op if nothing changed).
3. `/act`'s runtime legality gate — 409 if the caller's legal-move set disagrees with ours.

## Consistency with Backend

The Python engine MUST produce identical results to the TypeScript backend for:
- Card strength ordering
- Follow-suit filtering
- Trick winner determination
- Point computation

Test vectors in `tests/test_rules.py` mirror `backend/tests/unit/` to ensure parity.
