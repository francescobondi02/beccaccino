# BECCA AI — Review Fixes & Strengthening: Implementation Plan

**Status:** Locked plan, implementation in progress.
**Branch:** `feature/ai-review-fixes` (in the `ai/` submodule).
**Baseline:** 158 tests passing, `ruff` clean except 6 known unused-import nits in test files.
**Audience:** Whoever implements this (you, me, or a future session). This document is
self-sufficient — it carries the *why*, the *what*, the *exact change*, and the *verification*
for every commit, so no prior conversation context is required.

---

## 1. Background & goals

### 1.1 Where the project stands

`ai/` is the reinforcement-learning training submodule for BECCA (online Beccaccino).
It contains a headless Python game engine, a Gymnasium env, a PPO self-play trainer with
behavioral-cloning (BC) warm-start, four network architectures (V1 MLP → V4 transformer),
a heuristic opponent, PIMC search, and a FastAPI/ONNX serving path.

A multi-agent senior review produced **39 findings; 36 survived adversarial verification**.
The headline facts:

- The code is **ahead of its docs** — BC, V3/V4 nets, PIMC, and heuristic-eval all exist but
  aren't documented. The docs still claim `OBS_SIZE = 344`; the real value is **450**.
- The **BC + V4-transformer recipe already beat the old plateau**: Run A reached **95% vs random /
  60% vs heuristic at 41-point games** (`checkpoints/kaggle/v4_runA_rl.pt`).
- The **measured bottleneck is `explained_variance` pinned at ~0.3** for the whole run — the value
  head is blind to hidden hands in a cooperative imperfect-information game.

### 1.2 What this effort delivers

Two intertwined goals, kept deliberately separate in the commit plan:

1. **Fix all 36 verified findings** — correctness bugs, RL-soundness issues, ops/reproducibility
   gaps, serving defects, and doc rot.
2. **Make the bot materially stronger** via four strategy items:
   - **#4 Centralized critic (CTDE)** — give the value head the full state at train time. Directly
     targets the EV bottleneck. *Highest-confidence strength lever.*
   - **#5 Encode signals into the observation** — striscio/busso/volo are a live action dimension
     that no player can currently see and nothing rewards. Make the cooperative channel learnable.
   - **#6 Opponent-pool anchors** — stop self-play from collapsing to near-copies of itself.
   - **#7 Elo ladder** — a monotone cross-checkpoint strength axis (vs-random is saturated at 95%).

Plus a **Kaggle automation tool** so training runs can be driven from the CLI without hand-editing
the notebook.

### 1.3 Engineering bar (non-negotiable)

Minimal code that solves the problem; no speculative abstraction; extend the nearest existing
pattern rather than inventing; named constants over magic numbers; comments explain *why*, not
*what*; surgical changes. This is a solo-dev project, not a framework — a design that adds a plugin
system or base classes for single use is wrong.

### 1.4 User decisions that shaped this plan (binding)

- **Signals → encode into the observation** (not collapse the action space). Accept that this and
  the critic invalidate the current 60% checkpoint; a fresh training run is expected.
- **One commit per feature** — each commit must be understandable and reviewable in isolation, and
  must build + pass all tests on its own.
- **Kaggle GPU: build automation + a cheap smoke run only.** Never autonomously launch a multi-hour
  training run; anything above a smoke threshold requires explicit confirmation.
- **Scope = all 36 findings + strategy items #4/#5/#6/#7 + Kaggle tool + docs.**

---

## 2. How the plan was derived (provenance)

1. **Review workflow** — 7 review dimensions, each finding adversarially verified by a skeptic.
   → 36 confirmed findings + a strategy synthesis.
2. **Design workflow** — 5 parallel component designs (checkpoint/loop, signals-obs,
   centralized-critic, kaggle-tool, eval-rigor), a devil's-advocate critique that hunted for
   over-engineering / missing dependencies / ordering hazards, then a locked commit plan.

The critique made three cuts that this plan honors:

- **Deferred the `run_ppo` consolidation.** The design wanted to merge the three training loops
  (`trainer.py`, `scripts/bc_then_rl.py`, `scripts/train_and_plot.py`) into one `run_ppo()` with a
  `TrainHooks` seam and BC folded in. It fixes no bug and would force every later `trainer.py`-
  touching commit to rebase against a rewritten file. **Deferred.** Consequence, stated openly: the
  two helper scripts keep their schedule drift (ent_coef default, cosine endpoint) until a future
  consolidation; commit 9 fixes only the primary `trainer.py` path.
- **Dropped the callable-heuristic anchor.** It only works under `SyncVectorEnv`; the real training
  path is `AsyncVectorEnv`. Anchors ship as **net-snapshots only** (a frozen BC net stands in for
  the heuristic's behavior and rides the existing batched-forward path with zero `dual_rollout` change).
- **Gave the Elo ladder a real CLI caller** so nothing added is dead code.

---

## 3. Plan at a glance

17 commits, grouped into 8 phases. Ordering is dependency-safe: correctness before refactor;
additive infra before checkpoint-invalidating changes; and the three features that all edit
`dual_rollout.py` (GAE → critic → anchors) are strictly serialized.

| # | Phase | Commit (conventional-commits) | Invalidates ckpt? |
|---|-------|-------------------------------|:---:|
| 1 | A Foundations | `fix(ppo): reset KL accumulator per-epoch so early-stop engages` | no |
| 2 | A Foundations | `fix(env): name CRICCA_RAW_BONUS and clip round reward to ±1` | no |
| 3 | A Foundations | `fix(rollout): cut GAE trajectory when opponent seat ends the game` | no |
| 4 | A Foundations | `refactor(imitation): BC policy-only; drop mis-scaled value warm-start` | no |
| 5 | A Foundations | `fix(heuristic): load carichi onto partner's winning trick` | no |
| 6 | B Eval rigor | `feat(eval): frozen EVAL_SEED_BASE, stop per-update seed drift` | no |
| 7 | B Eval rigor | `feat(eval): counts + Wilson CI + fix odd-count division` | no |
| 8 | C Checkpoint | `feat(checkpoint): unified save/load + net.config + RNG/normalizer serialization` | no |
| 9 | C Checkpoint | `feat(trainer): resume, mid-run save, --max-hours, global seed, widen --network-version` | no |
| 10 | D Serving | `fix(serving): export V4 in export_onnx + pin missing deps` | no |
| 11 | D Serving | `feat(serving): validate obs input width/shape in app.py` | no |
| 12 | E Signals | `feat(obs): encode striscio/busso/volo signal mask (OBS_SIZE 450→462)` | **yes** |
| 13 | F Strengthen | `feat(critic): centralized CTDE critic over full state` | **yes** |
| 14 | F Strengthen | `feat(self-play): permanent net-snapshot anchors in opponent pool` | no* |
| 15 | F Strengthen | `feat(eval): fix Elo update + elo_ladder with a real CLI caller` | no |
| 16 | G Tooling | `feat(kaggle): scripts/kaggle_run.py orchestration CLI` | no |
| 17 | H Docs | `docs(ai): correct OBS_SIZE, test counts, BC+PPO flow, stale snippets` | no |

\*Commit 14 doesn't itself change the network shape, but it lands after 12/13 which do — anchors
seed from a post-462 checkpoint.

**Per-commit discipline:** run `pytest` (must stay green, growing from 158) and `ruff check .` in
isolation before committing. Never skip the clean → build → test loop.

---

## 4. Detailed commit specifications

Each spec has: **Finding/goal**, **Why it matters**, **Change** (file-level, precise), **Test**,
and **Verify**. Line numbers are the review-time snapshot — always re-read the file before editing.

---

### Commit 1 — `fix(ppo): reset KL accumulator per-epoch so early-stop engages`

**Files:** `training/ppo.py`

**Finding:** KL early-stop compares a *cumulative cross-epoch* average to `target_kl`, so the
near-zero first-epoch KL permanently dilutes the running mean and the brake almost never fires.

**Why it matters:** the KL trust-region safeguard is inert. Overlarge policy updates that the brake
is meant to stop pass through. Secondary safeguard (the clipped surrogate is the primary one), hence
medium severity, but it silently disables a stated feature.

**Change:** in `ppo_update`, `totals["approx_kl"]` and `count` are initialized once outside the
epoch loop and never reset. Add a **per-epoch** accumulator:
- Before the minibatch loop, inside `for epoch in range(num_epochs):`, set `epoch_kl_sum = 0.0`,
  `epoch_mb_count = 0`.
- After the existing `totals["approx_kl"] += approx_kl; count += 1`, also add
  `epoch_kl_sum += approx_kl; epoch_mb_count += 1`.
- Replace the early-stop block with: break when `epoch_kl_sum / epoch_mb_count > target_kl`.
- `totals`/`count` stay cumulative for logging (`metrics`, `epochs_used` unchanged).

**Test:** `tests/test_ppo*.py` — craft a batch so epoch-2 mean KL exceeds `target_kl`; assert
`epochs_used < num_epochs` (currently it would be `num_epochs`).

**Verify:** `pytest -q && ruff check .`

---

### Commit 2 — `fix(env): name CRICCA_RAW_BONUS and clip round reward to ±1`

**Files:** `becca_env/game.py`, `becca_env/env.py`

**Finding:** `_distribute_round_end` normalizes the raw team-score difference by
`MAX_RAW_PER_ROUND = 35`, but the Cricca bonus adds `+9` raw to one team, so a Cricca-round reward
can reach ±1.26 — exceeding the documented ±1 range and dwarfing the terminal ±1.0 signal. The `+9`
is also a magic literal.

**Why it matters:** reward scale is inconsistent on exactly the high-variance rounds that matter
most. Low severity (return normalization dampens it, Cricca is rare), but a real inconsistency and a
magic number.

**Change:**
- `game.py`: add module constant `CRICCA_RAW_BONUS = 9  # +3 real points in raw×3 units`. Replace
  `scores[team_key]["raw"] += 9` with `+= CRICCA_RAW_BONUS` and `["points"] += 3` with
  `+= CRICCA_RAW_BONUS // 3`.
- `env.py` `_distribute_round_end`: after `magnitude = diff_raw / MAX_RAW_PER_ROUND`, add
  `magnitude = float(np.clip(magnitude, -1.0, 1.0))` with a one-line *why* comment. (`np` already
  imported.)

**Decision — clip, not renormalize:** dividing by `35 + 9 = 44` would shrink *every* round's reward
by ~0.8 to accommodate a rare event, diluting the primary signal. Clip touches only the overflow.
(Because we clip, `env.py` does not need to import `CRICCA_RAW_BONUS` — the constant earns its place
by killing the magic 9 in `game.py`.)

**Test:** `tests/test_env.py` / `test_game.py` — construct a Cricca round where the caller team
sweeps; step to `round_end`; assert per-seat round reward ∈ [-1, 1] and raw score includes the bonus.

**Verify:** `pytest -q && ruff check .`

---

### Commit 3 — `fix(rollout): cut GAE trajectory when opponent seat ends the game`

**Files:** `training/rollout.py`, `training/dual_rollout.py`, `tests/test_gae.py`

**Finding (the one high-severity correctness bug):** in the dual self-play rollout (the primary
training path), `done=True` is stored on a transition only when a **learner** seat ends the game.
When an **opponent** seat plays the final card (~half of all games), no stored transition carries
`done`, so per-`(env, seat)` GAE never cuts the trajectory and leaks rewards/values across the game
boundary into the next game.

**Why it matters:** for ~half of all games, advantages and value targets blend two independent
episodes. Training still converged (60% vs heuristic), so this *degrades* the signal rather than
breaks it — but it plausibly contributes to the quality ceiling. Fix it before any further training.

**Root cause detail:** `collect_self_play_rollout_vec` stores only learner-team transitions and
copies `dones[i]` onto them. `compute_gae` keys trajectories by `(env_idx, seat)` and cuts only when
it sees `dones[t] == 1`. With no such flag between games N and N+1 for a reused `env_idx`, the last
learner transition of game N bootstraps from game N+1's value.

**Change:**
- `rollout.py`: add a helper beside `_credit_terminal_residuals` (same backward-walk pattern):
  ```python
  def _mark_latest_transition_done(buf, env_idx):
      """Stamp done=1.0 on env_idx's most recent stored transition.
      In selective-storage self-play the game-ending step is often taken by an
      opponent seat whose transition is NOT stored, so the terminal done never
      lands on a learner transition and compute_gae leaks across the boundary.
      compute_gae resets all 4 seats of an env on any done=1, so one stamp suffices."""
      for t in range(buf.ptr - 1, -1, -1):
          if int(buf.env_idx[t]) == env_idx:
              if buf.dones[t] == 0.0:
                  buf.dones[t] = 1.0
                  buf.games_done += 1   # keep the stat honest for opponent-ended games
              return
  ```
- `dual_rollout.py`: in the existing terminal loop (`for i in range(num_envs): if not dones[i]: continue …`),
  call `_mark_latest_transition_done(buf, env_idx=i)` as the first statement inside the guard, for
  every terminated env (idempotent when the learner acted on the terminal step). Import it alongside
  the existing `_credit_terminal_residuals, _extract_terminal_info`.

Timing is correct: the helper runs after `vec_env.step` but before the next game's transitions are
stored, so `buf.ptr - 1` is env i's true last transition. The done-stamp and residual crediting
touch independent fields (`dones` vs `rewards`); order is irrelevant.

**Test:** `tests/test_gae.py` — a pure-buffer regression that encodes "opponent ends game → learner's
pre-terminal advantage must NOT depend on the next game's values", **with a negative control** that
asserts the leak *does* happen without the stamp:
```python
def test_opponent_terminal_cuts_trajectory_across_game_boundary():
    def build(stamp):
        buf = RolloutBuffer(size=8)
        buf.store(OBS, MASK, 0, 0.0, value=1.0, reward=0.5, done=0, seat=0, env_idx=0)
        buf.store(OBS, MASK, 0, 0.0, value=2.0, reward=1.0, done=0, seat=0, env_idx=0)  # game1 last learner txn
        if stamp:
            _mark_latest_transition_done(buf, env_idx=0)   # opponent ended game1 (unstored)
        buf.store(OBS, MASK, 0, 0.0, value=99.0, reward=0.0, done=0, seat=0, env_idx=0)  # game2, same env
        return buf
    a1, _ = build(True).compute_gae(0.99, 0.95)
    b = build(True); b.values[2] = -99.0
    a2, _ = b.compute_gae(0.99, 0.95)
    assert a1[1] == pytest.approx(a2[1])          # invariant to game2
    assert a1[1] == pytest.approx(1.0 - 2.0)      # pure terminal: r - V
    c1, _ = build(False).compute_gae(0.99, 0.95)
    d = build(False); d.values[2] = -99.0
    c2, _ = d.compute_gae(0.99, 0.95)
    assert c1[1] != pytest.approx(c2[1])          # teeth: without the stamp it leaks
```

**Verify:** `pytest -q tests/test_gae.py && pytest -q && ruff check .`

**Ordering note:** MUST land before commits 13 (critic) and 14 (anchors) — all three edit
`dual_rollout.py`.

---

### Commit 4 — `refactor(imitation): BC policy-only; drop mis-scaled value warm-start`

**Files:** `training/imitation.py`, `tests/test_imitation.py`, `tests/test_network_v4.py`

**Finding:** BC fits the value head to raw discounted returns at `gamma=0.99`, but the subsequent PPO
phase fits the value head to `ReturnNormalizer`-scaled returns at `gamma=0.995`. The warm-started
value head is at the wrong scale *and* the wrong discount the moment RL starts.

**Why it matters:** the value warm-start is wasted or mildly harmful; the policy warm-start (the
dominant benefit — "tens of percent") is untouched. Aligning gamma fixes only the discount, not the
scale, and you cannot make BC value targets scale-compatible without coupling BC to normalizer state
that doesn't exist yet. **Cleanest fix: BC the policy only, let PPO learn V from scratch under correct
normalized targets.** Given EV is the measured bottleneck, removing a mis-scaled V warm-start is the
right direction and cannot hurt.

**Change in `behavioral_clone`:**
- Drop the `value_loss_coef` parameter; change `logits, value = net.forward(...)` to
  `logits, _ = ...`; remove `v_loss`; set `loss = ce`.
- Remove `v_total` accumulation, `history["v_loss"]`, and `v_loss` from the verbose print.
- Remove the `dataset.returns` assertion and `ret_t`.

**Orphaned by this change (delete in the SAME commit):** `ImitationDataset.returns` field, and the
entire returns machinery in `collect_heuristic_dataset` (`seat_rewards`/`seat_indices`/`returns_buf`,
the round_end/game_over reward crediting, the discounted-return computation, the pad loop, the
`gamma` param, `returns=` in the constructor). ~55 dead lines removed.

**Caller surface (critique correction):** the *only* production caller is `scripts/bc_then_rl.py:164`,
which does **not** pass `value_loss_coef` and does **not** read `history["v_loss"]` — so **no
`bc_then_rl.py` edit is needed** (the design's claim of a `trainer.py` caller was wrong; `trainer.py`
never calls `behavioral_clone`). The real breakage is in **tests**:
- Delete `test_bc_value_head_learns_something` (asserts `history["v_loss"]`).
- Drop the `ds.returns` assertions in `test_dataset_shapes_and_validity` and
  `test_dataset_returns_in_reasonable_range`.
- Confirm `test_network_v4.py`'s `behavioral_clone` call still passes with the new signature.

**Verify:** `pytest -q && ruff check .` (ruff catches orphaned imports from the deletions).

---

### Commit 5 — `fix(heuristic): load carichi onto partner's winning trick`

**Files:** `evaluation/heuristic.py`, `tests/test_heuristic.py`

**Finding:** when the partner is already winning a trick, the heuristic always dumps its
lowest-point card instead of throwing *carichi* (Asso/3/2) onto the partner's guaranteed points — a
core Beccaccino tactic. This makes it both a weaker BC teacher and a softer benchmark, so "60% vs
heuristic" overstates absolute skill.

**Why it matters:** the teacher systematically under-collects points on partner tricks; BC clones
that blind spot. Design severity, not a correctness bug (code matches its docstring).

**Change:** add a "partner winning AND my play cannot be overtaken" case to the two follower branches
(`_follow_in_suit`, `_follow_free`): when the trick can no longer be stolen by a later opponent
(e.g. I am last to play, or all higher relevant cards are accounted for), play the **highest**-point
card (`max card_points`) instead of the lowest. Keep the low-dump only when a later opponent can
still steal the trick. Update the module docstring to describe the new case.

**Test:** `tests/test_heuristic.py` — a crafted state where the partner is winning and the agent is
last to play; assert it plays its highest-point card, not the lowest. Keep existing pinned-behavior
tests green (adjust any that asserted the old low-dump in the now-carico case).

**Verify:** `pytest -q && ruff check .`

**Note:** this changes the BC teacher's behavior, so it should land before any fresh training run,
but it does not invalidate checkpoints (obs/action shapes unchanged).

---

### Commit 6 — `feat(eval): frozen EVAL_SEED_BASE, stop per-update seed drift`

**Files:** `evaluation/arena.py`, `evaluation/heuristic.py`, `training/trainer.py`

**Finding (strategy #1 prerequisite):** eval helpers are called with `seed = config.seed + update`,
so the deal set **slides every eval** — the win-rate curve mixes skill with deal luck and
consecutive checkpoints are scored on different deals.

**Why it matters:** until eval is on a frozen block, *every* downstream experiment (bigger net,
longer run, critic, signals) produces a number you can't compare. Cheapest high-leverage fix.

**Change:**
- `arena.py`: add module constant `EVAL_SEED_BASE = 20260724  # frozen; value arbitrary, must never change`.
  Change `evaluate_against_random` default `seed=0` → `seed=EVAL_SEED_BASE`.
- `heuristic.py`: `from evaluation.arena import EVAL_SEED_BASE` (it already imports `NeuralAgent`
  from arena — no new coupling); default `evaluate_against_heuristic` `seed` to `EVAL_SEED_BASE`.
- `trainer.py:242,245`: drop the `seed=config.seed + update` argument entirely (fall through to the
  frozen default). Leave the line-308 final sanity eval's `seed=99999` as its own distinct frozen
  block.

**Test:** `evaluate_against_random(net, seed=EVAL_SEED_BASE)` called twice returns identical counts.

**Verify:** `pytest -q && ruff check .`

---

### Commit 7 — `feat(eval): counts + Wilson CI + fix odd-count division`

**Files:** `evaluation/arena.py`, `evaluation/heuristic.py`, `evaluation/stats.py` (new),
`tests/test_stats.py`

**Findings:** eval helpers return a bare `float` (no confidence interval possible);
`evaluate_against_random` divides by `num_games` while only playing `2*(num_games//2)` games (off by
one for odd counts — `evaluate_against_heuristic` already does the right thing).

**Why it matters:** "60%" at n=100 is ±~10pp — statistically indistinguishable from 55%. CIs make
gains attributable. The division bug is low blast-radius (default eval_games is even) but free to fix.

**Change:**
- Add `return_counts: bool = False` to both helpers: `return (wins, n) if return_counts else wins / n`,
  where `n = 2 * half` (the actual games played). Float default preserved — no existing caller breaks.
- Fix `evaluate_against_random` to divide by `n = 2 * half`, not `num_games`.
- New `evaluation/stats.py` (pure stdlib `math`, torch-free so it's importable from tests/scripts):
  ```python
  def wilson_interval(wins, n, z=1.96):
      """95% Wilson score interval for a binomial proportion."""
      if n == 0: return (0.0, 0.0)
      p = wins / n
      denom = 1 + z*z/n
      center = (p + z*z/(2*n)) / denom
      half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / denom
      return (center - half, center + half)
  ```

**Test:** `tests/test_stats.py` — `wilson_interval(50,100)` centered ~0.5; `(0,0) → (0.0, 0.0)`;
`lo ≤ p ≤ hi`; interval narrows as n grows. Odd-count: `evaluate_against_random(num_games=7,
return_counts=True)` returns `n == 6`.

**Verify:** `pytest -q && ruff check .`

---

### Commit 8 — `feat(checkpoint): unified save/load + net.config + RNG/normalizer serialization`

**Files:** `training/checkpoint.py` (new), `training/network.py`, `training/config.py`,
`training/normalization.py`, `tests/test_checkpoint.py`

**Findings:** checkpoints omit optimizer / normalizer / opponent-pool / RNG / training
hyperparameters, so runs can't be cleanly continued or reproduced; `make_net` + `_net_config_dict` +
three inline dicts re-implement `create_network`'s dispatch; no global RNG seeding (`--seed` is a
false promise).

**Why it matters:** foundation for resume (commit 9) and the load path reused by commits 10 and 15.
Purely additive — no behavior change, 158 tests stay green.

**Change:**
- `network.py`: in `create_network`, stamp the resolved rebuild kwargs onto the instance:
  `net.config = {"version": version, **resolved_kwargs}` so `create_network(**net.config)` rebuilds
  bit-identically. Knowledge of defaults stays in the one place that owns it.
- `config.py`: add `TrainConfig.net_kwargs()` — the single `v4-vs-else` mapping from config to
  `create_network` kwargs (replaces the copies in `make_net`/`_net_config_dict`/inline calls).
- `normalization.py`: add `ReturnNormalizer.to_dict()/from_dict()` persisting `gamma`, `epsilon`, and
  the `RunningMeanStd` `mean/var/count` (the load-bearing running-std state). The transient
  per-`(env,seat)` `_returns` dict is NOT persisted (rebuilt within a rollout).
- `checkpoint.py` (new):
  ```python
  CKPT_FORMAT = 2
  def save_checkpoint(path, *, net, optimizer, config, step, update,
                      normalizer=None, pool=None, extra=None) -> None
  def load_checkpoint(path, map_location="cpu") -> dict          # returns payload dict
  def build_net(ckpt, device) -> nn.Module                        # create_network(**ckpt["net_config"]) + load_state_dict
  def seed_everything(seed) -> None                               # torch / numpy / random / cuda
  def rng_state() -> dict                                         # {torch, torch_cuda, numpy, python}
  def restore_rng(state) -> None
  ```
  Payload: `{format, net_config, model, optimizer, train_config (full asdict), step, update, rng,
  normalizer, pool, **extra}`. Callers keep the `ckpt.get(...)` idiom — no dataclass wrapper.

**Decisions:**
- **No legacy format-1 fallback.** The old `v4_runA_rl.pt` (450-dim) can't load into the post-signals
  (462) / post-critic nets anyway, so a weights-only shim would be dead on arrival. Format-2 only.
- **No `torch.use_deterministic_algorithms`/cudnn flags** — real GPU throughput cost, and the
  stochastic part that matters (card dealing) is already env-seeded. Stated, not hidden.

**Test:** `tests/test_checkpoint.py` — V2 and V4 round-trip to bit-identical `state_dict` + optimizer
reload; `ReturnNormalizer` to_dict/from_dict preserves mean/var/count; `seed_everything` makes two
`create_network` + sample sequences identical; `rng_state`/`restore_rng` reproduces a `torch.rand`
draw.

**Verify:** `pytest -q && ruff check .`

---

### Commit 9 — `feat(trainer): resume, mid-run save, --max-hours, global seed, widen --network-version`

**Files:** `training/trainer.py`, `training/config.py`

**Findings:** no resume/mid-run checkpoint on the primary training path (Kaggle's 12h cap kills long
runs); `--network-version` capped to `{1,2}` so V3/V4 are only trainable via the duplicated script;
no global seeding; cosine-LR off-by-one on the primary path.

**Why it matters:** wires the commit-8 helpers into the **existing** loop (the `run_ppo` refactor is
deferred). Makes Run B feasible across sessions and makes `--seed` real.

**Change (all against the existing `train()` loop):**
- Call `seed_everything(config.seed)` at the top; on resume, `restore_rng(ckpt["rng"])` after loading.
- Mid-run checkpoint: the existing `update % ckpt_every == 0` block calls `save_checkpoint(...)`
  instead of hand-rolled `torch.save`. Scripts get resumable mid-run checkpoints for free.
- `--max-hours` graceful stop: add `TrainConfig.max_hours: float | None`; compute
  `deadline = time.monotonic() + max_hours * 3600` (const `SECONDS_PER_HOUR = 3600`); after each
  update, if past the deadline, `save_checkpoint(ckpt_dir/"last.pt", ...)` and break. Always write
  `last.pt` on graceful stop and at final, so `--resume checkpoints/last.pt` continues across sessions.
- Widen argparse `--network-version choices=[1,2,3,4]`; add `--d-model/--nhead/--dim-feedforward` and
  `TrainConfig` fields `d_model=128, nhead=4, dim_feedforward=256`; build the net via
  `create_network(**cfg.net_kwargs())`.
- Fix the cosine-LR / entropy-anneal endpoint to the consistent `frac = (update-1)/max(total-1,1)`
  form on the primary path.

**Test:** 2-update smoke with tiny `num_envs`/`win_points`; resume from `last.pt`; assert update
numbering continues and `step_count` is monotonic.

**Verify:** `pytest -q && ruff check .`; also the Kaggle GPU smoke (see §6) once the tool exists.

---

### Commit 10 — `fix(serving): export V4 in export_onnx + pin missing deps`

**Files:** `serving/export_onnx.py`, `pyproject.toml` (`[serve]` extra)

**Findings:** the documented export defaults to `network_version=2` and can't load the real V4
checkpoints; `onnx`/`onnxscript`/`torch` aren't in the `[serve]` extra; the V4 transformer export is
batch-broken under torch 2.12's dynamo default.

**Why it matters:** there is no working path from a trained V4 checkpoint to `serving/model.onnx`.
Serving is dead-on-arrival. High severity as a build blocker (nothing production-live depends on it
yet).

**Change:**
- Build the net via `build_net(load_checkpoint(path), "cpu")` (commit 8) so the architecture comes
  from the checkpoint, not a CLI default. Persist `network_version`/V4 dims are already in
  `net_config`.
- Pass `dynamo=False` to `torch.onnx.export` so the TorchScript exporter produces a batch-symbolic
  graph (the dynamo path hardcodes the export-time batch for the transformer).
- `pyproject.toml [serve]`: add `torch`, `onnx>=1.16` (and `onnxscript` if any dynamo path remains).

**Test:** import + export a tiny V4 net to ONNX and run it at batch > 1 under `onnxruntime`; assert
output matches eager. (CI/local; no GPU needed.)

**Verify:** `pytest -q && ruff check .`

---

### Commit 11 — `feat(serving): validate obs input width/shape in app.py`

**Files:** `serving/app.py`

**Findings:** `/predict` crashes with an opaque 500 on an empty/all-illegal action mask (empty-array
reduction) and does no length validation against `OBS_SIZE`/`ACTION_SIZE`.

**Why it matters:** malformed requests across the service boundary should return a clear 4xx, not a
cryptic 500. Defensive hardening on the live inference path.

**Change:**
- Import `OBS_SIZE` from `becca_env.observation` and the 160 action size; reject payloads where
  `len(obs) != OBS_SIZE` or `len(action_mask) != ACTION_SIZE` with `HTTPException(422, ...)`.
  Importing `OBS_SIZE` means the check tracks the 462 change automatically.
- Guard the empty-legal-actions case before the confidence reduction (422 or a defined fallback).

**Test:** wrong-width payload → 4xx; all-zero mask → 4xx (not 500).

**Verify:** `pytest -q && ruff check .`

---

### Commit 12 — `feat(obs): encode striscio/busso/volo signal mask (OBS_SIZE 450→462)`  ⚠️ invalidates checkpoints

**Files:** `becca_env/observation.py`, `training/network.py`, `tests/test_observation.py`

**Finding / strategy #5:** signals are a live 4× leader action dimension, stored in game state and
fully public — yet **no player observes them** and **nothing rewards them**. `encode_observation`
emits zero signal features.

**Why it matters:** the policy emits signals as pure entropy — a partner can't read them and they
earn nothing. Encoding them makes the cooperative channel learnable by PPO. (Reward shaping stays out
of scope — the point is observability.)

**Change (mirror the `_compute_void_mask` exemplar):**
- `observation.py`: add `SIGNAL_INDEX = {s: i for i, s in enumerate(Signal)}` (striscio=0, busso=1,
  volo=2); `OBS_SIZE = 462`. New `_compute_signal_mask(game, viewer_seat) -> (4, 3)` multi-hot over
  the round: `[relative_declarer_seat, signal_type]`, populated from `hands_played[*].signal/signal_seat`
  and the in-progress `trick_signals[0]`. Rows relative to viewer (0=me, 1=left, 2=partner, 3=right);
  **row 0 IS populated** (own past signals aren't otherwise observable — unlike the void mask). In
  `encode_observation`, append the 12 floats after the void mask (indices 450..462), before the final
  `assert offset == OBS_SIZE`. Fix the stale `NUM_SIGNALS` "not encoded" comment and the layout table.
- `network.py` BeccaNetV4 — the ONLY two constants that move (signals land in the global region, so
  they route to the global token automatically; per-card slices 0..400 unchanged):
  `OBS_GLOBAL_END = 462` (was 450), `GLOBAL_FEAT_DIM = 62` (was 50). This resizes
  `global_proj = nn.Linear(62, d_model)`. Update the two doc comments naming the old numbers.
  V2/V3 read `OBS_SIZE` directly and resize automatically.

**Invalidation:** all prior checkpoints (`global_proj` in_features=50, trunk in_features=450) will
not load. This is the intended fresh-run trigger. The BC dataset regenerates automatically (asserts
`obs.shape[1] == OBS_SIZE`); note the heuristic teacher never declares signals, so BC-phase signal
features are all-zero — PPO self-play is where signal usage is learned.

**Test:** `tests/test_observation.py` — signal set from a completed trick (correct relative row);
from the in-progress trick; relative-to-viewer shift; all-zero when no signal. `test_obs_shape` →
462; `test_network_v4` forward at global dim 62.

**Verify:** `pytest -q && ruff check .`

**Deliberately NOT built:** suit-context on signals (4×3×4=48 features — speculative); per-trick
temporal history (the round-aggregated mask mirrors void_mask and is cheaper); signal reward shaping
(out of scope); any obs-version switch/shim (invalidation is accepted).

---

### Commit 13 — `feat(critic): centralized CTDE critic over full state`  ⚠️ invalidates checkpoints

**Files:** `becca_env/observation.py`, `becca_env/env.py`, `training/network.py`,
`training/rollout.py`, `training/dual_rollout.py`, `training/ppo.py`, `training/trainer.py`,
`training/config.py`, `tests/test_centralized_critic.py`

**Finding / strategy #4 (highest-confidence strength lever):** `explained_variance` pinned ~0.3 all
of Run A because the value head sees only the imperfect-info obs. In a hidden-hand cooperative game
the return is largely determined by cards the value head can't see. CTDE: give the **critic** the
full state (all 4 hands) at **train time only**; the **policy** keeps using the normal obs, so
serving/PIMC are byte-for-byte unchanged.

**Change:**
- `observation.py`: `FULL_STATE_SIZE = OBS_SIZE + 3 * NUM_CARDS` (derived — inherits the signal
  change automatically → 462 + 120 = 582). `encode_full_state(game, seat)` = actor obs ⊕ the 3
  hidden hands (3×40 binary), other-seat order mirroring void-mask rows (left/partner/right).
- `network.py`: `CentralizedCritic` — a **separate MLP** (BeccaNetV2 trunk shape: Linear→LayerNorm→
  ReLU + ResidualBlocks, scalar value head, ortho init value gain 1.0). Does **not** reuse the V4
  transformer trunk (reusing it would leak hidden hands into the policy; the bottleneck is missing
  *information*, not capacity).
- `rollout.py`: additive `full_obs` buffer field + `store(..., full_obs=None)` + `get_batch` key.
  Stored `values` become the **critic's** estimate so GAE/returns stay consistent.
- `env.py`: add `"full_obs"` to the observation-space Dict and to `_get_obs()`
  (`encode_full_state(...)`) and `_terminal_obs()` (zeros). Train-only cost; serving uses arena/ONNX
  which call `encode_observation` directly.
- `dual_rollout.py`: `collect_self_play_rollout_vec(..., critic=None)` — when a critic is passed,
  learner-seat values come from `critic(full_obs)` and `full_obs` is stored; policy action/log_prob/
  entropy still come from the actor net. `critic is None` → legacy path (keeps 158 tests green).
- `ppo.py`: `ppo_update(..., critic=None)` — `new_val = critic(full_obs[mb]) if critic else actor_val`;
  everything else identical. The actor's own value head is left idle (dead ~8k params) so `V4.forward`
  and `export_onnx` (which expect `(logits, value)`) stay untouched.
- `trainer.py`/`config.py`: `config.centralized_critic: bool = False`; when true, build the critic,
  use one Adam over `list(net.parameters()) + list(critic.parameters())`, pass `critic=` to rollout +
  update, add `"critic"` to the checkpoint.

**Minimalism:** shared-policy CTDE, NOT MAPPO (no per-agent critics); one optimizer/LR; the single
`centralized_critic` flag exists only to keep this reviewable and the legacy tests green.

**Test:** `tests/test_centralized_critic.py` — `encode_full_state` size 582, first `OBS_SIZE` slice
equals `encode_observation`, hidden-hand blocks exactly equal the other seats' hands (every card is
mine / seen / in exactly one hidden block); `CentralizedCritic` forward `(B,582)→(B,)` differentiable;
buffer stores/returns `full_obs`; `ppo_update(critic=...)` grad flows; CPU smoke of `train(...)` with
`centralized_critic=True` runs a few updates and logs EV. Legacy path (flag off) stays green.

**Verify:** `pytest -q && ruff check .`; GPU smoke to confirm EV actually moves off ~0.3.

**Ordering:** AFTER signals (12) so `FULL_STATE_SIZE` reflects the final layout; AFTER GAE (3) —
shared `dual_rollout.py`.

---

### Commit 14 — `feat(self-play): permanent net-snapshot anchors in opponent pool`

**Files:** `training/self_play.py`, `training/trainer.py`, `training/config.py`,
`tests/test_self_play.py`

**Finding / strategy #6:** the opponent pool is a FIFO of self-snapshots; `p_latest_opponent=0.5`
trains half of rollouts vs near-copies of self → strategy collapse. The heuristic is only ever an
eval opponent.

**Change (net-snapshot anchors only — callable-heuristic form dropped per critique):**
- `self_play.py`: minimal `Opponent` representation (`name`, `state_dict`) + a permanent, never-
  evicted `anchors` list beside the existing FIFO deque. `sample()` returns `None` (latest learner —
  unchanged sentinel) with prob `p_latest`, else uniform over `anchors + FIFO snapshots` — so anchors
  stay reachable even before the FIFO fills (the anti-collapse property). `serialize()/from_serialized`
  stay FIFO-only; anchors are re-seeded at construction.
- `trainer.py`/`config.py`: `config.bc_anchor_path: str | None`; build the pool with
  `anchors=[Opponent("bc", state_dict=load_checkpoint(bc_anchor_path)["model"])]` when set. The
  existing `sample → load_state_dict` block loads an anchor's `state_dict` exactly like a FIFO
  snapshot — **zero `dual_rollout.py` change** (that's the payoff of dropping the callable form).

**Test:** `tests/test_self_play.py` — anchors are sampled even with an empty FIFO (mock `random` so
the `p_latest` branch is skipped); anchors survive `add_policy` overflow past `max_size`; net anchor
round-trips.

**Verify:** `pytest -q && ruff check .`

**Open question to resolve at implementation:** the BC anchor needs a BC checkpoint on disk; the
anchor is inert until one exists. Wire it to the BC snapshot the pipeline already produces.

---

### Commit 15 — `feat(eval): fix Elo update + elo_ladder with a real CLI caller`

**Files:** `evaluation/elo.py`, `evaluation/arena.py`, `scripts/elo_ladder.py` (new),
`tests/test_elo.py`

**Finding / strategy #7:** `EloTracker.update` multiplies the delta by the full game count
(`* total`), so a single eval can move the rating by thousands of points; and it's dead code (no
caller). vs-random is saturated at 95%, so a monotone cross-checkpoint Elo axis is the strength
signal that's missing.

**Change:**
- `elo.py`: drop the `* total` factor — `self.current_rating += k_factor * (actual - expected)`.
- `arena.py`: `elo_ladder(checkpoints: dict[str, net], num_games=100, block_seed=EVAL_SEED_BASE,
  win_points=41, ...)` — round-robin on ONE frozen block, reusing `play_match`. For each unordered
  pair, play `num_games` twice (sides swapped) → a combined `score_ab ∈ [0,1]`; init all ratings to
  1000 and run `LADDER_ITERATIONS = 20` fixed-point passes of the standard update. Reuses the exact
  logistic expected-score formula from `EloTracker` (one Elo convention). Lives in arena (not elo.py)
  so `elo.py` stays a pure torch-free dataclass.
- `scripts/elo_ladder.py` (new): thin CLI that loads `.pt` checkpoints via `build_net` (commit 8) and
  prints the ranking — the **real caller** so nothing added is dead.

**Test:** `tests/test_elo.py` — equal ratings + 50% actual leaves rating unchanged (regression guard
against `* total`); a win nudges up by ≤ `k_factor`; `elo_ladder` with two deterministic stub agents
ranks the winner strictly higher; two calls with the same `block_seed` return identical dicts.

**Verify:** `pytest -q && ruff check .`; validate the CLI by ranking two checkpoints on CPU.

**Note:** if you'd rather not maintain a checkpoint-ranking CLI, this whole commit can be dropped —
Wilson CI + frozen seed (6, 7) already make checkpoints comparable. Kept because strategy #7 asked
for it and the CLI makes it non-dead.

---

### Commit 16 — `feat(kaggle): scripts/kaggle_run.py orchestration CLI`

**Files:** `scripts/kaggle_run.py` (new), `scripts/kaggle_setup.md`

**Goal:** drive Kaggle GPU runs from the CLI without hand-editing the notebook. The loop today: ship
`ai/` as dataset `fbondi/becca-ai` → notebook `fbondi/becca-training` copies it and runs
`scripts.bc_then_rl` → pull outputs. The `kaggle` CLI (2.2.0) is authenticated locally.

**Change:** one file, argparse subcommands shelling out to the authenticated `kaggle` CLI via
`subprocess` (no `kaggle_ops/` package, no framework). Verbs:
- `push-code [--create] [-m MSG]` — `shutil.copytree` with the junk-strip `ignore_patterns`
  (`__pycache__`, `.venv`, `runs`, `wandb`, `checkpoints`, `.git`, caches, `*.log`, `.DS_Store`) →
  `kaggle datasets version` (or `create`).
- `configure` — write `kernel-metadata.json` with `enable_gpu=true`, `enable_internet=true`,
  dataset attached, and push (flips the current GPU-OFF/internet-OFF defaults).
- `launch [--preset smoke] [SPEC FLAGS...] [--confirm-cost]` — render a **script kernel** (`kernel.py`,
  not `.ipynb`) from a `RunSpec` dataclass that mirrors `bc_then_rl` flags 1:1, then push.
- `status` — `kaggle kernels status` (one-shot; compose with `/loop` if polling wanted).
- `pull [-p checkpoints/kaggle]` — `kaggle kernels output`.

Module constants (single source of truth): `DATASET_SLUG`, `KERNEL_SLUG`, `AI_DIR_ON_KAGGLE`,
`PULL_DIR`, `MEASURED_SPS = 1150` (observed T4 transformer throughput), `KAGGLE_SESSION_CAP_HOURS = 12`,
`SMOKE_MAX_STEPS = 1_000_000`.

**Safety gate (binding):** `launch` prints a cost estimate (`steps / MEASURED_SPS / 3600` GPU-h). A
`SMOKE` preset (200k steps, ~3 min) launches without confirmation. Anything above `SMOKE_MAX_STEPS`
exits with `REFUSED` unless `--confirm-cost` is passed; if the estimate exceeds the 12h cap, warn that
the run will be killed without resume (commit 9).

**Test:** `tests/test_kaggle_run.py` (pure logic, no network) — `RunSpec.to_cli_args()` parses cleanly
through `bc_then_rl.parse_args` (drift guard); `est_hours` math; safety gate raises `SystemExit` above
the threshold without `--confirm-cost`; `STAGE_IGNORE` excludes the junk dirs; rendered `kernel.py`
compiles. Manual: `push-code --create` → `configure` → `launch --preset smoke` once (the sanctioned
cheap GPU smoke).

**Verify:** `pytest -q && ruff check .`

**Ordering:** LAST among code commits — after commit 9 finalizes the `bc_then_rl`/trainer flag surface
so `RunSpec` mirrors it.

---

### Commit 17 — `docs(ai): correct OBS_SIZE, test counts, BC+PPO flow, stale snippets`

**Files:** `ai/CLAUDE.md`, `ai/README.md`, `ai/SCOPE.md`

**Findings:** docs say `OBS_SIZE = 344` (real 462 after commit 12); describe a PPO-only system (BC,
V3/V4, PIMC, heuristic-eval all exist); list implemented features as "planned"; SCOPE code snippets
crash on copy-paste (wrong checkpoint key `model_state_dict` vs `model`, wrong filenames, wrong
network class); test counts say 47/63 (real 158+).

**Change:** correct `OBS_SIZE` to 462 and the layout table; rewrite the pipeline description as
**BC warm-start → PPO self-play** with the V1–V4 family, heuristic+Elo eval, and PIMC; move
serving/search/transformer from "planned" to Done/Partial (note PIMC is not yet wired into serving);
fix the SCOPE snippets to match what `trainer.py` saves (`create_network(...)`, `ckpt["model"]`,
`final.pt`); fix test counts.

**Companion work (outside `ai/`, flagged here, not done by this commit):** for a signals/critic-
trained net to actually **serve**, the **TypeScript backend's observation encoder** (`backend/`) must
emit the same 12 signal features at indices 450..462, and `serving/model.onnx` must be re-exported at
the new input width. This is a different submodule — assign to the backend owner.

**Verify:** manual read-through; no tests.

---

## 5. Coverage matrix — every finding & strategy item → commit

| Finding / item | Commit |
|---|---|
| GAE episode-boundary leak (high) | 3 |
| No resume / no mid-run checkpoint (high) | 8 + 9 |
| Checkpoint omits optimizer / normalizer / pool / RNG (high) | 8 |
| ONNX export can't export V4 + missing deps (high) | 10 |
| V4 ONNX batch-broken under dynamo | 10 |
| Trainer caps network-version to {1,2} | 9 |
| 3-way PPO loop duplication | **DEFERRED** (run_ppo consolidation) |
| Eval seed drift | 6 |
| Eval no confidence interval | 7 |
| Eval odd-count `/num_games` division | 7 |
| KL early-stop never engages | 1 |
| BC value-head scale + gamma mismatch | 4 |
| Cricca reward overflow past ±1 | 2 |
| Magic literal `9` (Cricca) | 2 |
| Elo `* total` math bug | 15 |
| Heuristic never loads partner tricks | 5 |
| Serving no input validation / empty-mask 500 | 11 |
| `make_net`/`_net_config_dict` duplication + 3 inline net dicts | 8 |
| Cosine-LR off-by-one / entropy-anneal drift | 9 (primary path); scripts deferred |
| No global seeding / `--seed` not honored | 8 + 9 |
| No `--max-hours` graceful stop (Kaggle 12h cap) | 9 |
| Stale `NUM_SIGNALS` "not encoded" comment | 12 |
| Docs: OBS_SIZE 344, wrong test counts, PPO-only, stale snippets | 17 |
| ReturnNormalizer stale `_returns` at rollout boundary (low) | 8 (serialization) / accept |
| Terminal all-zero mask latent trap (low) | documented invariant (11 guards serving) |
| **Strategy #4 — centralized critic** | 13 |
| **Strategy #5 — signal observation** | 12 |
| **Strategy #6 — opponent anchors** | 14 |
| **Strategy #7 — Elo ladder** | 15 |
| Kaggle orchestration tool | 16 |
| TS backend encoder + ONNX re-export at 462 (companion) | 17 (note; runtime step after 12/13) |

**Not closed this cycle:** the 3-way PPO loop consolidation (deferred per critique — fixes no bug,
multiplies rebase surface). Consequence stated: the two helper scripts keep their schedule drift
until that consolidation.

---

## 6. Verification strategy

**Per commit (all of 1–16):** `cd ai && pytest -q && ruff check .` must be green **in isolation**.
Baseline 158 tests; commit 4 deletes some by design; 7/12/13/others add new files. Never skip the
clean → build → test loop.

**Kaggle GPU smoke (`kaggle_run.py launch --preset smoke`, ~3 min T4)** — required to validate:
- **9** — resume + `--max-hours` graceful stop + cross-session continue on the real 12h runner.
- **12** — signals net trains end-to-end at width 462; EV telemetry sane.
- **13** — critic runs on GPU; confirm `explained_variance` moves off the ~0.3 pin (the point of the
  fresh run).
- **14** — self-play with anchors runs without `p_latest` collapse.
- **16** — the tool validates itself end-to-end (`push-code --create` → `configure` →
  `launch --preset smoke`).

**Never autonomously launch a multi-hour run.** The full Run B (signals + critic, ~40M+ steps) is a
human-confirmed step after the smoke validates the pipeline.

---

## 7. Deferred / out of scope (explicit, not forgotten)

- **`run_ppo` consolidation** (merge the 3 training loops + hook seam + BC-as-Phase-1). Deferred by
  critique. Revisit as a standalone refactor once these 17 land, if the drift becomes painful.
- **Suit-context signal features** (4×3×4=48). Start with seat×type (12); expand only if a fresh run
  shows the cooperative channel needs it.
- **PIMC wired into serving** (a stateful endpoint that reconstructs a `BeccaGame`). Big lever
  (strategy) but larger build; measure PIMC-on-net vs bare net on the frozen block first (the
  decisive experiment) before committing to it.
- **TS backend observation encoder + ONNX re-export at 462** — companion runtime work in `backend/`,
  flagged in commit 17.

---

## 8. Fresh-run readiness checklist

Before launching the first real Run B (signals + critic):

1. Commits 1–16 landed, each with green `pytest`/`ruff`.
2. Commit 12 + 13 confirmed to invalidate the old checkpoint (expected) — start from a fresh BC.
3. BC anchor checkpoint produced on disk (commit 14 dependency).
4. Kaggle smoke green for commits 9, 12, 13, 14, 16.
5. Eval is on the frozen block with CIs (commits 6, 7) so the run's curve is trustworthy.
6. Watch `explained_variance` — the critic (13) should pull it well off ~0.3; if it doesn't, the
   critic isn't wired correctly.
