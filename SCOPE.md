# becca-ai — Scope & Architecture

## What This Submodule Does

This is the **AI training environment** for Beccaccino. It provides:

1. **A headless game engine** (`becca_env/`) — a pure-Python re-implementation of the card game rules that runs ~2400 games/sec, fast enough for RL self-play training.

2. **A Gymnasium interface** (`becca_env/env.py`) — standard RL API so any algorithm (PPO, MAPPO, AlphaZero-style MCTS) can train against itself.

3. **Training infrastructure** (`training/`) — PPO self-play loop with multi-agent support.

4. **Evaluation** (`evaluation/`) — arena for pitting agents against each other, Elo rating.

5. **Serving** (`serving/`) — FastAPI endpoint to plug a trained model into the live web app.

## Relationship to Other Submodules

```
BECCA (parent)
├── backend/    TypeScript game server (authoritative for online play)
├── frontend/   React web client
└── ai/         THIS — Python RL training (offline, then serves via API)
```

**The game rules exist in two places** (TypeScript backend + Python here). This is intentional:
- The backend handles real-time multiplayer with database persistence.
- The AI env needs millions of games/hour — calling the backend via HTTP would be 1000x too slow.

**Consistency is enforced by shared test vectors** in `tests/test_rules.py`. These tests verify that trick winner determination, follow-suit rules, and point computation produce identical results to the TypeScript backend. If game rules change in the backend, the same change must be reflected here and the shared tests must still pass.

## How It Will Connect to the Web App

```
[Frontend] → WebSocket → [Backend] → HTTP → [AI Serving API]
                                              ↓
                                        [ONNX Model]
```

When an AI player's turn arrives:
1. Backend sends the game state to the serving API.
2. Serving API encodes the observation, runs inference, returns the action.
3. Backend plays the card on behalf of the AI player.

The AI never touches the database or sockets — it's a stateless function: `observation → action`.

## Development

```bash
cd ai/
uv venv .venv && source .venv/bin/activate
uv pip install -e ".[dev]"       # core + test tools
uv pip install -e ".[train]"     # + PyTorch + TensorBoard
pytest                            # run tests (41 tests, <2s)
python scripts/benchmark.py       # ~2400 games/sec throughput
```

## Training Roadmap

| Phase | What | Status |
|-------|------|--------|
| 1 | Game engine + Gymnasium env | Done |
| 2 | PPO self-play (no signals) | Next |
| 3 | Fine-tune with signals | Planned |
| 4 | MCTS / search hybrid | Planned |
| 5 | Serving API + web integration | Planned |
