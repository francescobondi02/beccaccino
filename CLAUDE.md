# AI — Gymnasium Environment for RL Training

Python 3.11+, Gymnasium-based environment for training AI agents to play Beccaccino via self-play reinforcement learning.

## Structure

```
becca_env/
  __init__.py
  deck.py           Card/Suit/Value definitions, 40-card deck, strength and points tables
  rules.py          Core rules: follow_suit_filter, determine_hand_winner, compute_round_scores
  game.py           Full game state machine (BeccaGame): phases, actions, step()
  observation.py    State → numpy tensor encoding (344 features), action mask (160 slots)
  env.py            Gymnasium wrapper (BeccaEnv) — self-play, scaled rewards
training/
  config.py         TrainConfig dataclass (all hyperparameters)
  network.py        BeccaNet (v1 legacy) + BeccaNetV2 (ReLU, LayerNorm, residuals)
  ppo.py            PPO update with clipped surrogate, KL early stopping
  rollout.py        Rollout buffer with per-seat GAE
  trainer.py        Main training loop (wandb, curriculum, resume, entropy annealing)
  self_play.py      OpponentPool — historical policy sampling for diversity
  self_play_env.py  SelfPlayEnv wrapper (team-vs-opponent, learner-only observations)
  curriculum.py     Auto-advancing difficulty stages
  vec_env.py        Vectorized environment creation (AsyncVectorEnv)
  normalization.py  Running mean/std for return normalization
evaluation/
  arena.py          Agent vs agent matches, evaluate_against_random()
  elo.py            Elo rating tracker
serving/
  app.py            FastAPI inference endpoint (stateless: obs → action)
  export_onnx.py    Export PyTorch checkpoint to ONNX
scripts/
  benchmark.py      Environment throughput benchmark
checkpoints/        Saved model checkpoints (.pt files)
tests/
  test_deck.py      Deck integrity
  test_rules.py     Game rules (mirrors backend test vectors)
  test_env.py       Gymnasium env correctness
  test_game.py      Game state machine
  test_gae.py       Per-seat GAE computation
  test_self_play.py Opponent pool + self-play env
  test_curriculum.py Curriculum advancement logic
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

Feature vector: 344 floats (OBS_SIZE = 344)

| Offset | Size | Feature |
|--------|------|---------|
| 0 | 40 | My hand (binary) |
| 40 | 40 | Cards seen in previous tricks (binary) |
| 80 | 160 | Current trick (4 positions × 40 one-hot) |
| 240 | 4 | Briscola suit (one-hot) |
| 244 | 4 | My seat (one-hot) |
| 248 | 4 | Trick starter (one-hot) |
| 252 | 10 | Hand number (one-hot, 1-10) |
| 262 | 10 | Round number (one-hot, capped at 10) |
| 272 | 2 | Normalized scores (team0, team1) |
| 274 | 30 | Signals history (10 hands × 3 types) |
| 304 | 40 | Signal declarers (10 hands × 4 seats) |

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

## Training (v2)

PPO self-play with: per-seat GAE, BeccaNetV2 (ReLU + LayerNorm + residuals),
opponent pool, curriculum learning, wandb tracking, entropy annealing.

```bash
# Quick training (short games, ~2h on Apple Silicon)
python -m training.trainer --win-points 5 --steps 20000000 --device mps

# Full curriculum training (~8-10h)
python -m training.trainer --curriculum --steps 100000000 --device mps

# Resume from checkpoint
python -m training.trainer --resume checkpoints/ckpt_000500.pt --steps 50000000

# Without wandb (offline)
python -m training.trainer --no-wandb --win-points 5 --steps 5000000
```

Key hyperparameters (defaults in `training/config.py`):
- 64 parallel envs × 512 steps = 32,768 batch size
- GAE: gamma=0.995, lambda=0.95
- Network: 3×512 ReLU+LayerNorm with residual connections (~1M params)
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
