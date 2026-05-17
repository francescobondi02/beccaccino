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
training/           (Placeholder) RL training loops, PPO/MAPPO agents
evaluation/         (Placeholder) Agent evaluation, Elo rating
serving/            (Placeholder) FastAPI + ONNX inference server for online play
scripts/            (Placeholder) CLI scripts for training runs
checkpoints/        Saved model checkpoints (.gitkeep)
tests/
  test_deck.py      Deck integrity: 40 cards, 10/suit, 32 total raw points, unique strengths
  test_rules.py     Follow-suit, trick winner, round scoring (mirrors backend test vectors)
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
| 274 | 30 | Signals history (10 hands × 3 types) — TODO: not yet wired |
| 304 | 40 | Signal declarers (10 hands × 4 seats) — TODO: not yet wired |

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
- Reward shaping: trick ±0.1, round ±1.0, game ±5.0

## Scoring Notes

Points system uses raw×3 to avoid fractions (same as backend):
- Total raw points in deck: 32 (4 suits × 8 per suit: asso=3 + 5 figures×1)
- Last trick bonus: +3 raw
- Total per round: 35 raw = 11 points + 2 figures remainder
- Game win: cumulative real points (raw // 3) ≥ 41

## Dependencies

```bash
pip install -e ".[dev]"     # Core + pytest + ruff
pip install -e ".[train]"   # + torch + tensorboard
pip install -e ".[serve]"   # + fastapi + uvicorn + onnxruntime
```

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
