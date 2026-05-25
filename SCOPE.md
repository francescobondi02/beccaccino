# becca-ai — Scope & Architecture

## What This Submodule Does

This is the **AI training environment** for Beccaccino. It provides:

1. **A headless game engine** (`becca_env/`) — a pure-Python re-implementation of the card game rules that runs ~2400 games/sec, fast enough for RL self-play training.

2. **A Gymnasium interface** (`becca_env/env.py`) — standard RL API so any algorithm (PPO, MAPPO, AlphaZero-style MCTS) can train against itself.

3. **Training infrastructure** (`training/`) — PPO self-play with vectorized environments, TensorBoard logging, and evaluation.

4. **Evaluation** (`evaluation/`) — arena for pitting agents against each other + random baseline.

5. **Serving** (`serving/`) — FastAPI endpoint to plug a trained model into the live web app (planned).

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

**Consistency is enforced by shared test vectors** in `tests/test_rules.py`. These tests verify that trick winner determination, follow-suit rules, point computation, and Cricca detection produce identical results to the TypeScript backend. If game rules change in the backend, the same change must be reflected here and the shared tests must still pass.

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

## Setup

```bash
cd ai/
uv venv .venv && source .venv/bin/activate
uv pip install -e ".[dev]"       # core + test tools
uv pip install -e ".[train]"     # + PyTorch + TensorBoard
pytest                            # run tests (47 tests, <0.2s)
python scripts/benchmark.py       # ~2400 games/sec throughput
```

## Training

### Quick Start

```bash
# Phase 1 — single round games (~5 min, target >65% vs random)
python -m training.trainer --steps 2000000 --num-envs 8 --win-points 5 --ent-coef 0.02 --gamma 0.97

# Phase 2 — full games (~30 min, target >80% vs random)
python -m training.trainer --steps 10000000 --num-envs 8 --win-points 41 --ent-coef 0.01

# Monitor progress
tensorboard --logdir runs/
```

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--steps` | 2,000,000 | Total environment steps |
| `--num-envs` | 8 | Parallel game environments |
| `--steps-per-env` | 256 | Steps per env per rollout |
| `--lr` | 3e-4 | Learning rate |
| `--lr-schedule` | constant | `constant`, `linear`, or `cosine` |
| `--hidden` | 256 | Hidden layer width |
| `--layers` | 3 | Number of hidden layers |
| `--epochs` | 4 | PPO update epochs |
| `--minibatch` | 512 | Minibatch size |
| `--gamma` | 0.99 | Discount factor (use 0.97 for short games) |
| `--ent-coef` | 0.01 | Entropy bonus coefficient |
| `--win-points` | 41 | Points to win (use 5 for fast iteration) |
| `--device` | cpu | `cpu`, `cuda`, or `mps` |
| `--seed` | 0 | Random seed |
| `--eval-every` | 25 | Evaluate vs random every N updates |
| `--eval-games` | 200 | Games per evaluation |
| `--ckpt-every` | 50 | Save model every N updates |
| `--ckpt-dir` | checkpoints/ | Where to save `.pt` files |
| `--log-dir` | runs/ | TensorBoard log directory |

### Device Selection

- **CPU** (default): Best for the current 481K-param network. ~5,000-7,000 SPS with 8 envs.
- **MPS** (Apple Silicon GPU): Only beneficial with larger networks or batch sizes.
- **CUDA**: For training on a cloud GPU with a scaled-up network.

### Training Strategy

1. **Phase 1 — Learn basic play**: Train with `--win-points 5` (single-round games). The agent learns trick-taking fundamentals. Target: >65% vs random (ceiling ~78%).

2. **Phase 2 — Full game**: Resume from Phase 1 checkpoint with `--win-points 41`. Multi-round games amplify skill advantage. Target: >80% vs random (ceiling ~98%).

3. **Phase 3 — Signals** (planned): Fine-tune with signal-aware rewards. The agent learns when to use striscio/busso/volo and how to interpret opponent signals.

### Outputs

- `checkpoints/becca_ppo_NNNNNN.pt` — periodic model snapshots
- `checkpoints/becca_ppo_final.pt` — final trained model
- `runs/<run_name>/` — TensorBoard event files

### Resuming Training

Load a checkpoint and continue:

```python
import torch
from training.network import BeccaNet

net = BeccaNet()
ckpt = torch.load("checkpoints/becca_ppo_final.pt", weights_only=True)
net.load_state_dict(ckpt["model_state_dict"])
# Then pass `net` to training or evaluation
```

### Evaluating a Trained Model

```python
import torch
from training.network import BeccaNet
from evaluation.arena import evaluate_against_random, play_match, NeuralAgent, RandomAgent

net = BeccaNet()
ckpt = torch.load("checkpoints/becca_ppo_final.pt", weights_only=True)
net.load_state_dict(ckpt["model_state_dict"])

# Win rate vs random (200 games, half as each team)
winrate = evaluate_against_random(net, num_games=200)
print(f"Win rate: {winrate:.1%}")

# Model vs model
agent_a = NeuralAgent(net, temperature=0.0)  # greedy
agent_b = RandomAgent(seed=42)
result = play_match(agent_a, agent_b, num_games=100)
print(f"Agent A wins: {result.team0_wins}, Agent B wins: {result.team1_wins}")
```

## Training Roadmap

| Phase | What | Status |
|-------|------|--------|
| 1 | Game engine + Gymnasium env | Done |
| 2 | PPO self-play training pipeline | Done |
| 3 | Training overhaul (GAE, scale, self-play pool, curriculum) | Done |
| 4 | Train to >80% vs random on full 41-point games | Ready to run |
| 5 | Fine-tune with signals | Planned |
| 6 | MCTS / search hybrid | Planned |
| 7 | Serving API + web integration | Planned |

## Advanced Features Roadmap (Post-Overhaul)

These features are planned for after the core training pipeline is working and producing >80% WR vs random:

### 1. Wire Signal Observation Features
- Offsets 274-344 in `observation.py` are allocated but not fully wired
- Train the agent to *interpret* opponent signals (striscio/busso/volo) and *produce* meaningful signals for its teammate
- Add signal-specific reward shaping: bonus for accurate signals that lead to teammate making better plays

### 2. Card Counting & Inference Features
- Track which cards are *definitely* NOT in an opponent's hand (deduced from follow-suit failures)
- Feature: remaining cards per suit that are unaccounted for
- Feature: probability estimates for key cards (e.g., where is the Tre di briscola?)
- This gives the network "memory" of previous tricks' information content

### 3. Population-Based Training (PBT)
- Run 8-16 independent training runs in parallel with different hyperparameters
- Periodically: copy weights from best-performing agents, mutate hyperparameters of worst
- Automates hyperparameter search while training
- Reference: Jaderberg et al. 2017 "Population Based Training of Neural Networks"

### 4. MCTS Hybrid (AlphaZero-style)
- At inference time, use Monte Carlo Tree Search with the value network for evaluation
- Policy network provides the prior for MCTS node expansion (guides search)
- Handle imperfect information via determinization (sample possible opponent hands, run MCTS on each)
- Dramatically stronger play at the cost of more inference compute (~100ms vs 1ms per decision)
- Reference: Silver et al. 2017 "Mastering Chess and Shogi by Self-Play"

### 5. Attention-Based Architecture
- Replace MLP with a Transformer-style architecture
- Cards as tokens: each card in hand / on table is a token with learned embeddings
- Cross-attention between hand and table cards
- Better generalization to rare game states
- Reference: similar to PokerRL's card embeddings
