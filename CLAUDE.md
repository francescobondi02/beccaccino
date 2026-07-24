# AI — Gymnasium Environment for RL Training

Python 3.11+, Gymnasium-based environment for training AI agents to play Beccaccino via self-play reinforcement learning.

## Structure

```
becca_env/
  __init__.py
  deck.py           Card/Suit/Value definitions, 40-card deck, strength and points tables
  rules.py          Core rules: follow_suit_filter, determine_hand_winner, compute_round_scores
  game.py           Full game state machine (BeccaGame): phases, actions, step()
  observation.py    State → numpy tensor encoding (462 features), action mask (160 slots)
                    + encode_full_state (582) for the centralized CTDE critic
  env.py            Gymnasium wrapper (BeccaEnv) — self-play, scaled rewards
training/
  config.py         TrainConfig dataclass (all hyperparameters) + net_kwargs()
  network.py        BeccaNet V1/V2/V3/V4 (V4 = transformer) + CentralizedCritic;
                    create_network stamps net.config for exact rebuild
  ppo.py            PPO update: clipped surrogate, per-epoch KL early stop, critic hook
  rollout.py        Rollout buffer with per-(env,seat) GAE + full_obs (critic)
  trainer.py        PPO loop (wandb, curriculum, resume, --max-hours, seed, CTDE)
  imitation.py      Behavioral cloning on the heuristic (policy-only warm-start)
  checkpoint.py     Unified save/load, build_net, seed_everything, RNG state
  self_play.py      OpponentPool — FIFO snapshots + permanent anchors
  self_play_env.py  SelfPlayEnv wrapper (team-vs-opponent, learner-only observations)
  curriculum.py     Auto-advancing difficulty stages
  vec_env.py        Vectorized environment creation (AsyncVectorEnv)
  normalization.py  Running mean/std for return normalization (to/from_dict)
evaluation/
  arena.py          Agent-vs-agent matches, evaluate_against_random(), elo_ladder(), EVAL_SEED_BASE
  heuristic.py      HeuristicAgent baseline + evaluate_against_heuristic()
  stats.py          wilson_interval() confidence bounds
  elo.py            Elo rating tracker
serving/
  app.py            FastAPI inference endpoint (stateless: obs → action, input-validated)
  export_onnx.py    Export any checkpoint (incl. V4) to ONNX via build_net
inference/          PIMC (perfect-information Monte Carlo) — not yet wired to serving
scripts/
  bc_then_rl.py     BC warm-start → PPO self-play pipeline (the strong recipe)
  elo_ladder.py     Cross-checkpoint Elo ranking CLI
  kaggle_run.py     Drive Kaggle GPU runs from the CLI (smoke-gated)
  benchmark.py      Environment throughput benchmark
checkpoints/        Saved model checkpoints (.pt files)
tests/              ~200 tests (pytest); mirrors the modules above
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

## Observation Encoding (observation.py)

Feature vector: 462 floats (OBS_SIZE = 462)

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

`encode_full_state` (582 floats) appends the 3 hidden hands (3×40) for the
centralized CTDE critic — train-time only; the policy never sees it.

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
- Reward: trick ±(raw_pts/35) normalized, terminal ±1.0

## Training

The strong recipe is **BC warm-start → PPO self-play** on the V4 transformer
(`scripts/bc_then_rl.py`). `training/trainer.py` is the pure-PPO trainer and now
also supports resume, `--max-hours` graceful stop, global `--seed`,
`--network-version {1,2,3,4}`, a BC-anchor opponent, and a centralized (CTDE)
critic. Both use per-seat GAE, the opponent pool (with anchors), curriculum,
wandb, and entropy annealing.

```bash
# Recommended: BC + PPO on the transformer (see scripts/kaggle_setup.md for GPU)
python -m scripts.bc_then_rl --network-version 4 --bc-games 3000 \
  --total-rl-steps 5000000 --num-envs 32 --win-points 5 --device cuda

# Pure PPO trainer (short games)
python -m training.trainer --win-points 5 --steps 20000000 --device mps

# Full curriculum training (~8-10h)
python -m training.trainer --curriculum --steps 100000000 --device mps

# Resume across sessions (writes last.pt; --max-hours for Kaggle's 12h cap)
python -m training.trainer --resume checkpoints/last.pt --steps 50000000 --max-hours 11

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
pip install -e ".[serve]"   # + fastapi + uvicorn + onnxruntime
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

## Consistency with Backend

The Python engine MUST produce identical results to the TypeScript backend for:
- Card strength ordering
- Follow-suit filtering
- Trick winner determination
- Point computation

Test vectors in `tests/test_rules.py` mirror `backend/tests/unit/` to ensure parity.
