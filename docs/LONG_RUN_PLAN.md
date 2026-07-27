# BECCA AI — Long-Run Readiness: Implementation Plan

**Status:** Locked plan, not yet implemented.
**Goal:** Make a multi-session Kaggle training run (12h sessions chained via checkpoints)
actually work end-to-end, fix the silent-corruption class of training defects, close the
wp=5→wp=41 distribution gap, and squeeze more throughput out of the T4 — so the next long
run produces the strongest bot this pipeline can deliver.
**Audience:** Implementing agents. This document is self-sufficient: every item carries the
*why* (evidence), the *what* (exact change), and the *verification*. No conversation context
is required. Line numbers are approximate (verified at the commit this plan was written);
anchor on the quoted function/identifier, not the number.

---

## 0. Ground rules for implementing agents

1. **Never touch the rules engine** (`becca_env/deck.py`, `rules.py`, `game.py`) or the
   observation LAYOUT (`becca_env/observation.py` offsets). Rules parity with the backend is
   verified and exact; the serving fixtures (`serving/fixtures/bot_states.json`) pin the
   encoding. If a change would alter any fixture, stop — the change is wrong.
2. **Verify after every item:** `cd ai && pytest -x` (all green) and `ruff check . && ruff
   format --check .` (ruff is pinned `==0.15.13`). Items that add behaviour add tests.
3. **Keep backward compatibility with existing checkpoints.** `checkpoints/kaggle-runb/` and
   `checkpoints/kaggle-runc/` are served in production. All loading changes must still load
   both the unified format (`save_checkpoint`) and the flat format (`{"model", "config"}`).
4. **Do not launch GPU runs.** Kaggle launches (Phase 4) are the operator's call — the
   `--confirm-cost` gate in `scripts/kaggle_run.py` exists exactly for this. Smoke-size local
   runs (`--device cpu`, tiny steps) are fine for verification.
5. **One item = one commit**, message `fix(ai): <item id> <summary>` or `feat(ai): ...`.
   Implement in the order given: P0 → P1 → P2 → P3. Later items assume earlier ones.

---

## 1. Background — what the review found

Full findings: `docs/SYSTEM_ANALYSIS.md` (H/M/L ids referenced below) plus a 2026-07-27
re-verification pass. The four facts that shaped this plan:

1. **The multi-session resume chain has never worked.** Run C (30M steps) fit in one 11h
   session, so `--resume` was never exercised on Kaggle. Tracing it end-to-end: `last.pt` is
   written to ephemeral `/kaggle/working`, `push-code` strips `checkpoints/` from the dataset
   (`STAGE_IGNORE` in `kaggle_run.py`), and the kernel attaches only the code dataset — so a
   second session's `--resume /kaggle/input/.../last.pt` points at a file that cannot exist.
   Five more defects hide behind that one (P1 below).
2. **Training is CPU-bound, not GPU-bound.** Measured: the bare engine does ~570k steps/s;
   with observation encoding ~29k steps/s; vectorized throughput is FLAT from 16 to 64 envs.
   The ceiling is Python-side encoding + `AsyncVectorEnv` subprocess IPC, with the GPU doing
   latency-bound batch-64 forwards on a 1.25M-param net. A P100 (needs a fragile torch
   reinstall — Kaggle docker-python#1546 still open) or a second T4 (no DDP anywhere in the
   loop) would buy **zero** speedup. Stay on the T4 pin; the real levers are P2.
3. **Run B/C trained at `win_points=5` = single-round games.** The cumulative-score features
   (`obs[432:434]`) were constant (0,0) and only round-slot 0 of the round one-hot ever
   activated during training. Serving plays wp=41 (~6.7 rounds): those features are live and
   out-of-distribution, and multi-round match management (protect a lead, desperation when
   behind) is entirely untaught. This is the biggest remaining strength lever (P3.1).
4. **A cluster of silent-corruption defects** on exactly the paths a long run exercises:
   critic gradients unclipped (H2), resume rebuilds the net from CLI flags instead of the
   checkpoint stamp (H4), RNG not restored (H3), zero tests on PPO loss direction (H9).
   Cheap to fix, and they protect everything downstream (P0).

---

## Phase P0 — Correctness fixes (silent-corruption class)

### P0.1 — Clip critic gradients (H2)

**Files:** `training/ppo.py` (`ppo_update`, the `clip_grad_norm_` call ~line 97).
**Why:** With `--centralized-critic`, the optimizer owns `net` + `critic` params, but the
clip covers only `net.parameters()`. A single bad CTDE minibatch can send an unbounded
gradient through the critic — the exact instability grad-clipping exists to prevent, on the
exact configuration (runc recipe) a long run uses.
**Change:** Clip over the union: build `params = list(net.parameters()) + (list(critic.
parameters()) if critic is not None else [])` once and pass that to `clip_grad_norm_`.
Fixing it inside `ppo_update` transitively fixes BOTH callers (`bc_then_rl.py` and
`training/trainer.py` build the same net+critic optimizer and call the same `ppo_update`)
— no trainer.py edit needed.
**Verify:** New test in `tests/test_ppo.py`: run one `ppo_update` with a critic and a
deliberately huge advantage scale; assert the global grad norm over net+critic params
immediately before `optimizer.step()` is ≤ `max_grad_norm` (use a hook or re-run the clip
and check the returned pre-clip norm > post-clip). Existing tests stay green.

### P0.2 — Tests that pin PPO loss direction (H9)

**Files:** `tests/test_ppo.py` (extend).
**Why:** Nothing currently fails if someone flips a sign in the surrogate loss, the
advantage normalization, or the value clip. For a codebase that will be modified by agents
under this very plan, direction tests are the cheapest insurance available.
**Change:** Three tests, each on a tiny fixed net and synthetic batch:
1. *Policy direction:* positive advantage on a taken action ⇒ its log-prob increases after
   one `ppo_update`; negative advantage ⇒ decreases.
2. *Value direction:* value loss on a fixed batch decreases over 5 updates (both the
   actor-value path and the `critic=` path).
3. *KL brake:* with `target_kl` tiny and a large learning rate, `metrics["epochs_used"] <
   num_epochs`.
**Verify:** The new tests pass; then temporarily flip the sign of `pi_loss` locally and
confirm test 1 fails (do not commit the flip).

### P0.3 — Resume rebuilds the network and critic from the checkpoint, not CLI flags (H4)

**Files:** `scripts/bc_then_rl.py` (`main`, `phase2_rl` resume block ~lines 366–388),
`training/checkpoint.py` (`build_net` already exists — use it).
**Why:** On `--resume`, `main()` calls `make_net(args, ...)`: the architecture comes from
whatever flags this session happened to pass. Most mismatches fail loudly (shape mismatch
in `load_state_dict` / optimizer load), but the failure is an opaque stack trace naming
neither the flag nor the checkpoint value — and a forgotten `--centralized-critic`
constructs no critic and drops the saved critic weights before the optimizer load crashes.
Resuming must be "continue THAT run", not "continue whatever these flags describe", with
errors that name the disagreement.
**Change:** When `--resume` is set: load the checkpoint first; rebuild the policy via
`build_net(ck, device)` (note: `build_net` rebuilds only the policy — the critic must be
reconstructed separately from `ck.get("critic")`); construct the critic iff
`ck.get("critic") is not None` (and error clearly if the CLI flag contradicts the
checkpoint: "checkpoint has a critic; refusing to resume without --centralized-critic" and
vice versa). Same principle for `d_model`/`layers` etc.: the stamped `net_config` wins; if
an explicit CLI flag disagrees, `SystemExit` with a message naming both values.
**Verify:** New test: save a checkpoint from a tiny critic-enabled run, resume it in-process
with mismatched flags, assert `SystemExit`; resume with no arch flags at all, assert the
rebuilt net matches the stamped config and the critic exists.

### P0.4 — Restore RNG state on resume (H3)

**Files:** `scripts/bc_then_rl.py` (resume block).
**Why:** `save_checkpoint` already persists `rng` and `training/checkpoint.py` provides
`restore_rng` — `training/trainer.py` calls it on resume, `bc_then_rl.py` (the recipe Kaggle
actually runs) does not. Without it, opponent-pool sampling, torch action sampling, and env
seeding diverge from the recorded run, so a resumed run is unreproducible.
**Change:** In the resume block, after loading: `if ck.get("rng") is not None:
restore_rng(ck["rng"])`. (Mirror the trainer.py call.)
**Verify:** Test: run 3 updates of a tiny run, save; resume and run 2 more; separately run 5
straight with the same seed. Assert the sampled opponent sources and final `step_count`
match. (Exact weight equality across a process boundary is not required — assert the RNG
draws match.)

### P0.5 — Make "resume of a completed run" a hard error, not a silent no-op

**Files:** `scripts/bc_then_rl.py` (`phase2_rl`, the `if start_update > cfg.total_updates`
guard ~line 428).
**Why:** The multi-session protocol (P4) is: launch session 1 with the FINAL step target and
`--max-hours 11`; the session stops early at the wall-clock cap; later sessions resume with
the **same** `--total-rl-steps` and continue toward it. (Same, not larger: the cosine LR,
entropy anneal, and signal-honesty schedules all key off `cfg.total_updates`, which is
recomputed from this session's flags — changing the total mid-run warps every schedule.
`--num-envs`/`--steps-per-env` must likewise be identical across sessions, since they feed
`batch_size` → `total_updates` → the update numbering.) Under that protocol the guard trips
only when the run genuinely completed — but today it prints "nothing to do" and exits 0,
indistinguishable from success. If an operator resumes a finished run by mistake, a whole
Kaggle session is consumed producing nothing, and `status` reports success.
**Change:** Replace the print+return with `raise SystemExit(f"resume checkpoint is already
at update {start_update - 1} of {cfg.total_updates}: this run is complete. Extending it
requires a larger --total-rl-steps and RESHAPES the LR/entropy/signal schedules — prefer
starting a new run from this checkpoint.")`. Update the resume example in
`docs/TRAINING_RUNBOOK.md` to show the set-final-target-once protocol.
**Verify:** Test asserting `SystemExit` (nonzero) in that condition. Runbook example updated.

---

## Phase P1 — Wire the multi-session resume chain (the blocker)

The design in one paragraph: run state travels between sessions in a **second, dedicated
Kaggle dataset** (`fbondi/becca-ai-state`) containing an explicit allowlist of files —
never the whole pulled output (the pull contains a full copy of the code tree under
`/kaggle/working/ai`, and re-uploading it would let the kernel's first-marker-wins code
detection run *stale code* from session 2 onward). The operator loop per session becomes:
`status` → `pull` → `push-state` → `launch --preset runX --resume-state --confirm-cost`.

### P1.1 — `push-state` verb + state-dataset plumbing in `kaggle_run.py`

**Files:** `scripts/kaggle_run.py`, `tests/test_kaggle_run.py` (exists — extend).
**Why:** There is currently no vehicle that can move `last.pt` from one session's output to
the next session's `/kaggle/input`. This is the root cause of the blocker.
**Change:**
1. New constant `STATE_DATASET_SLUG = f"{KAGGLE_USER}/becca-ai-state"`.
2. New verb `push-state [--from DIR] [--create] [-m MSG]` (default `--from` = `PULL_DIR`):
   stages ONLY an allowlist into a temp dir and creates/versions the state dataset. The
   allowlist (module constant, so tests can pin it): `checkpoints/last.pt`,
   `checkpoints/best.pt` (if present), and every `metrics.csv` under `runs/`. Refuse
   (SystemExit) if `last.pt` is missing — that means the pull didn't contain a resumable run.
3. `launch` gains `--resume-state` (bool). When set: `dataset_sources` becomes
   `[DATASET_SLUG, STATE_DATASET_SLUG]`, and the spec's `resume` is set to the sentinel
   string `"AUTO"` — resolved inside the kernel (P1.2), because the mount path isn't known
   until runtime. `--resume <path>` (explicit) keeps working for manual use.
4. Harden code-dir detection for the two-dataset world: after the walk, assert that
   **exactly one** directory under `/kaggle/input` contains `CODE_MARKER`, else fail with a
   message listing the matches. (The allowlist guarantees the state dataset carries no code;
   the assert is defense-in-depth against a hand-uploaded dataset.)
**Verify:** Unit tests (no network — the `kaggle` CLI calls are already shelled through
`_run`; monkeypatch it): `push-state` stages exactly the allowlist and nothing else from a
fixture dir that also contains decoy files (`ai/scripts/bc_then_rl.py`, `runs/plot.png`);
missing `last.pt` ⇒ SystemExit; `launch --resume-state` renders kernel metadata with both
datasets and the AUTO sentinel in FLAGS.

### P1.2 — Kernel-side AUTO resume resolution + metrics.csv carry-forward

**Files:** `scripts/kaggle_run.py` (`render_kernel_script`).
**Why:** The kernel is the only place that knows where Kaggle mounted the state dataset; and
`metrics.csv` must be seeded into `--out-dir` before training starts or the learning curve
restarts from zero every session (see P1.4).
**Change:** In the generated kernel body, when `"--resume"` is in FLAGS with value `"AUTO"`:
walk `/kaggle/input` for a file named `last.pt`, assert exactly one match, and substitute its
absolute path into FLAGS. If a `metrics.csv` sits in the state mount, copy it into the
spec's `--out-dir` before invoking `bc_then_rl`. If no `last.pt` is found, fail loudly
(assert) — do NOT fall back to a fresh run, which would silently burn the session retraining
from scratch.
**Verify:** Extend the kernel-render test: generated script contains the AUTO-resolution
block; a small `exec`-based test of the generated script against a fake `/kaggle/input`
tree (tmp dir, patched constants) resolves the path and fails when zero or two `last.pt`
files exist.

### P1.3 — Persist BC anchors inside the checkpoint

**Files:** `scripts/bc_then_rl.py` (`phase2_rl`: anchor setup ~line 361, `_save` ~line 406,
resume block), `training/self_play.py` (no change needed — `OpponentPool(anchors=...)`
already takes them).
**Why:** `pool.serialize()` deliberately excludes anchors ("re-seeded at construction from
fixed external checkpoints") — but on Kaggle the anchor source `args.bc_ckpt` lives on the
wiped ephemeral disk. Result: session 1 trains with the anti-collapse BC anchor, every later
session silently trains without it. Long runs are precisely where self-play collapse
protection matters most.
**Change:** In `_save`, add `extra["anchors"] = pool.anchors` (list of state_dicts; ~5MB
per anchor at 1.25M params — negligible). In the resume block, prefer `ck.get("anchors")`
over the `bc_ckpt`-file path when constructing the pool. Keep the file path as fallback for
local resumes of old checkpoints.
**Verify:** Test: run a tiny `--anchor-bc` run, save, delete the bc ckpt file, resume;
assert `pool.anchors` is non-empty and byte-equal to the saved anchor.

### P1.4 — Append to metrics.csv on resume instead of truncating

**Files:** `scripts/bc_then_rl.py` (`phase2_rl`, CSV setup ~line 311).
**Why:** The CSV is opened `"w"` unconditionally: every session truncates the curve. Since
wandb is hardcoded off in this recipe (`use_wandb=False`), the CSV is the *only*
cross-session training record — winner's-curse checkpoint decisions (which bit Run C) need
the full curve.
**Change:** Write header only when the file doesn't already exist:
`new_file = not csv_path.exists(); with csv_path.open("a" if not new_file else "w") ...` —
simplest: always open `"a"`, write the header iff the file was absent. (P1.2 already copies
the previous session's CSV into `out_dir` on Kaggle.)
**Verify:** Test: run 2 updates, "resume" in-process for 2 more into the same out_dir;
assert one header line and 4+ data rows in order.

### P1.5 — Advance the deal stream across sessions

**Files:** `scripts/bc_then_rl.py` (`phase2_rl`: move the checkpoint load above
`create_vec_env`, then seed the vec env with an offset).
**Why:** `BeccaEnv.reset` seeds each game `_base_seed + _game_count` with `_game_count`
starting at 0 in every process. Every resumed session therefore replays the same deal
prefix it already trained on — correlated data, wasted GPU hours, and an overfitting risk
that grows with the number of sessions.
**Change:** Load the resume checkpoint BEFORE `create_vec_env` (currently the vec env is
built first), then build the vec env with `seed=cfg.seed + games_total` (games_total is
already persisted/restored). Fresh runs are unchanged (`games_total = 0`). Known
pre-existing limitation, out of scope: env i and env i+1 are the same seed stream shifted
by one game (intra-session deal correlation) — this change neither introduces nor fixes
that. Eval seeds live at `EVAL_SEED_BASE = 20,260,724`, far above any training seed Run D
can reach (~3M games), so no eval leakage; P3.2 documents the constraint.
**Verify:** Test: two envs created with seeds `s` and `s + games_total` produce different
first deals; and a resumed tiny run's first game differs from the original run's first game.

### P1.6 — Decouple `last.pt` cadence from the opponent-pool cadence

**Files:** `scripts/bc_then_rl.py` (arg + the `update % args.pool_save_every == 0` guard on
the `last.pt` write ~line 547), `scripts/kaggle_run.py` (`RunSpec` + `to_cli_args` — a test
guards the 1:1 flag mapping).
**Why:** `last.pt` is currently written only every `pool_save_every=50` updates ≈ 36 min of
work at observed throughput. A hard session kill (Kaggle preempts; `--max-hours` only covers
the graceful path) loses up to that much. Checkpoint cadence and pool-snapshot cadence are
different concerns accidentally sharing a knob.
**Change:** New flag `--save-last-every` (default `10`; ≈7 min exposure) controlling only
the `last.pt` write; `pool_save_every` keeps governing pool snapshots. Add the field to
`RunSpec` (same default) so presets render it.
**Verify:** Existing `RunSpec` flag-mapping test extended; tiny-run test asserting `last.pt`
mtime changes at the new cadence.

### P1.7 — Honest cost model + runbook update

**Files:** `scripts/kaggle_run.py` (`MEASURED_SPS`), `docs/TRAINING_RUNBOOK.md`.
**Why:** `MEASURED_SPS = 1150` vs Run C's actual ~760 (30M steps / 11.0h): `est_hours`
under-predicts wall-clock by ~34%, which corrupts session planning against the 30
GPU-h/week quota.
**Change:** `MEASURED_SPS = 760  # Run C empirical: 30M steps in 11.0h on T4`. Runbook: add
a "Multi-session protocol" section documenting the P1 loop verbatim (status → pull →
push-state → launch --resume-state with the SAME --total-rl-steps/--num-envs/
--steps-per-env as session 1 — see P0.5 for why), and fix the broken resume example (P0.5).
**Verify:** `est_hours(30_000_000)` ≈ 11.0; runbook renders the protocol; grep confirms no
other use of the old constant.

---

## Phase P2 — Throughput on the T4 (the honest speed levers)

Context for whoever implements this: the GPU is idle most of the time. Do not add AMP/DDP
complexity; the wins are in Python and IPC.

### P2.1 — Stop encoding the observation twice per step

**Files:** `becca_env/observation.py` (`encode_full_state`), `becca_env/env.py` (`_get_obs`).
**Why:** `_get_obs` calls `encode_observation` AND `encode_full_state`, and
`encode_full_state`'s first line re-runs `encode_observation` internally. The 462-float
actor encoding — the single most expensive per-step Python cost — is computed twice on
every step of every env.
**Change:** Give `encode_full_state` an optional `obs: np.ndarray | None = None` parameter;
when provided, copy it into `full[:OBS_SIZE]` instead of re-encoding. In `_get_obs`, encode
once and pass it in. No layout change — the fixtures must not move.
**Verify:** `pytest tests/test_observation.py` green; `python -m scripts.gen_bot_fixtures`
is a no-op (`git diff --exit-code serving/fixtures/`); quick benchmark (see P2.4) shows the
env-step rate improvement.

### P2.2 — Gate full-state encoding + IPC behind an env flag

**Files:** `becca_env/env.py` (`BeccaEnv.__init__`, `_get_obs`, `_terminal_obs`,
`observation_space`), `training/vec_env.py` (`make_env`, `create_vec_env`),
`scripts/bc_then_rl.py` / `training/trainer.py` (pass the flag).
**Why:** `full_obs` (582 floats) is computed and shipped through AsyncVectorEnv subprocess
pipes on EVERY step — including runs with no centralized critic, and including opponent
steps where `dual_rollout` never reads it. Encoding + pickling + pipe traffic on the
hot path, for data that is often discarded.
**Change:** `BeccaEnv(include_full_obs: bool = True)` (default True = today's behaviour, so
nothing breaks). When False: omit `full_obs` from the observation dict AND from
`observation_space` (a Dict space without the key — vector envs require space consistency,
which this preserves per-env-set). Thread the flag through `make_env`/`create_vec_env`.
Callers set it to `centralized_critic` (bc_then_rl) / `cfg.centralized_critic` (trainer).
`dual_rollout` already only touches `full_obs` when `critic is not None` — add an assert
with a clear message if a critic is passed but the obs dict lacks the key.
**Note:** with the critic ON (the real recipe), full_obs is still produced every step even
though only learner steps consume it (~50%). Skipping it per-step is not reachable from
inside a vector env (the env doesn't know whose turn the learner is); accept that half and
move on — P2.1 already removed the duplicated actor encode inside it.
**Verify:** Tests: env with flag False has no `full_obs` key and steps fine under
`SyncVectorEnv`; critic run with flag True unchanged (existing CTDE tests green); the
assert fires when misconfigured.

### P2.3 — Right-size `num_envs` to Kaggle's CPU (measurement, then preset change)

**Files:** `scripts/benchmark.py` (extend if needed), `scripts/kaggle_run.py` (presets).
**Why:** Throughput is flat 16→64 envs locally because encoding+IPC saturates the cores;
Kaggle gives 4 vCPUs, where 64 async subprocesses mostly thrash the scheduler. Fewer envs
with the same total batch (via `steps_per_env`) may be strictly faster — but this must be
measured on Kaggle hardware, not assumed.
**Change:** (a) Ensure `scripts/benchmark.py` can sweep `num_envs ∈ {8, 16, 32, 64}` for a
fixed wall-clock and print env-steps/s. (b) Add the sweep to the SMOKE kernel path (a few
minutes of the smoke budget) so the numbers come from the real machine. (c) After the
operator reads the numbers: set the winning `num_envs` (and compensating `steps_per_env`,
keeping `num_envs * steps_per_env = 32768`) in the long-run preset. Batch/minibatch sizes
are otherwise untouched.
**Constraint:** `num_envs`/`steps_per_env` may only change BEFORE a run starts — never
between resume sessions of the same run (they feed `batch_size` → `total_updates` → every
schedule; see P0.5). The preset change lands before Run D's session 1, then freezes.
**Verify:** Smoke log contains the sweep table. Preset change is a follow-up commit citing
the measured numbers in its message.

### P2.4 — (Optional, last) Enable TF32 for the update phase

**Files:** `scripts/bc_then_rl.py` / `training/trainer.py` (one-time device setup).
**Why:** The T4's tensor cores are unused; `torch.backends.cuda.matmul.allow_tf32 = True` +
`torch.backends.cudnn.allow_tf32 = True` is free accuracy-safe speedup for the PPO update
matmuls. Modest (the update phase is a minority of wall-clock) — do it only because it's
two lines, and do it last so any numeric drift is attributable.
**Verify:** Loss curves on a 20-update CPU-vs-CUDA smoke remain within noise; no test
regressions.

---

## Phase P3 — Training quality (what makes the bot stronger)

### P3.1 — Mixed win-points training (kills the wp=41 OOD gap)

**Files:** `training/vec_env.py` (`create_vec_env`, `make_env`), `scripts/bc_then_rl.py`
(new flag), `scripts/kaggle_run.py` (`RunSpec`), `tests/`.
**Why:** (Fact 3 in §1.) All prior RL happened in single-round games: score features dead,
round one-hot stuck at slot 0, no multi-round strategy. Serving is wp=41. Mixing
game lengths *within each batch* teaches both regimes simultaneously; a hard curriculum
switch (train wp=5 then wp=41) risks forgetting the short-game skill the eval anchors
measure and adds a schedule hyperparameter for no benefit. `observation.py` normalizes
scores by each game's own `win_points`, so features stay in [0,1] per env.
**⚠ Confound trap (verified):** `bc_then_rl.py` assigns `learner_team_per_env = i % 2` and
a naive round-robin wp assignment is `win_points[i % len]`. With a 2-element mix these
alias PERFECTLY — the only (team, wp) pairs produced are {(0,5), (1,41)}: team 0 would
never train at wp=41 and vice versa. The wp index MUST be decoupled from the team index.
**Scale note:** the reward-scaling variance in `ReturnNormalizer` is a single global
`RunningMeanStd` (`normalization.py` — only the discounted-return accumulator is keyed
per-(env,seat)). wp=5 and wp=41 returns therefore share one blended scale. Accept this for
Run D (returns are already normalized to O(1) per round by the ±1 reward design; the
regimes differ in episode length more than reward magnitude), but log per-wp mean episode
return in metrics so the operator can see if one regime's gradient signal is being drowned
— if it is, per-wp normalizer buckets are the follow-up, not a blocker.
**Change:** `create_vec_env(win_points: int | list[int], ...)` — a list is distributed as
`win_points[(i // 2) % len(win_points)]` so consecutive team-0/team-1 env pairs share a wp
and every (team, wp) combination occurs (with num_envs=64 and len=2: 16 envs per
combination). An int keeps today's behaviour. New CLI flag `--wp-mix "5,41"` on
`bc_then_rl.py` (mutually exclusive with `--win-points`; parsed to the list) and a matching
`RunSpec` field rendered by `to_cli_args` (land both sides in one commit — the flag-mapping
test in `tests/test_kaggle_run.py` SystemExits on drift). Eval stays at
`--eval-win-points 41` — unchanged. BC collection stays at wp=5 (it's about action
imitation, not match management).
**Verify:** Tests: (1) **hard assertion, not a note** — for num_envs=64 and mix [5,41], the
set of (learner_team, wp) pairs is exactly {0,1}×{5,41} with equal counts; (2) a wp=41 env
after 2+ rounds produces `obs[432:434]` strictly in (0,1) and a round one-hot slot > 0
(this is the OOD probe — it would have caught the original gap); (3) int arg behaviour
byte-identical to today.

### P3.2 — Post-run checkpoint decision: large held-out re-score of best.pt vs last.pt (H7)

**Files:** `scripts/score_checkpoints.py` (new, small), `docs/TRAINING_RUNBOOK.md`.
**Why:** `best.pt` selection maximizes over ~600 noisy 200-game evals on the FROZEN block —
a winner's-curse machine. It already bit Run C: final (81.8% held-out) beat "best" (76.0%
held-out) and the shipped checkpoint had to be chosen manually. The decision needs a
scripted, held-out, high-N procedure instead of tribal knowledge.
**Change:** A CLI that takes N checkpoint paths and scores each on a HELD-OUT seed block,
mirrored team assignment — play each deal twice with teams swapped (this machinery does
NOT exist yet: `evaluate_against_heuristic` plays different deals per side; `elo_ladder`
has side-swap but not per-deal mirroring — build it in this script) at wp=41 with
`--games` (default 1000), printing win rates with Wilson intervals and a verdict line.
**Held-out block:** use `HELDOUT_SEED_BASE = EVAL_SEED_BASE + 1_000_000` (module constant),
with a comment documenting the three ranges it must clear: (a) the frozen block
`EVAL_SEED_BASE..+eval_games`, (b) the random-eval `EVAL_SEED_BASE+10000` offset, (c) the
training deal range `cfg.seed + games_total + i` (starts near 0; Run D reaches ~3M —
comfortably below `EVAL_SEED_BASE = 20,260,724`).
Runbook: "after every run, run this on best.pt + last.pt; ship the winner."
**Verify:** Test with two tiny nets (random vs BC-ish fixture or heuristic-vs-random
sanity): the known-stronger agent wins the verdict; mirroring is exercised (each seed
appears twice with swapped teams).

### P3.3 — (Experiment, optional) PIMC as the BC teacher

**Files:** `training/imitation.py` (`collect_heuristic_dataset` gains an agent parameter or
a sibling collector), `scripts/bc_then_rl.py` (`--bc-dataset PATH.npz` to load a
pre-collected dataset; collection itself happens offline).
**Why:** BC imitates the deterministic heuristic (97% match) — the warm-start ceiling is
the teacher. `inference/pimc.py`'s heuristic-rollout branch never touches a net and scores
~90% vs heuristic: a strictly stronger, already-in-repo teacher. BUT PIMC is orders of
magnitude slower per move; 6000 games of collection cannot fit a Kaggle session.
**Change:** (a) Add `--bc-dataset` (path to an `.npz` produced by the collector) so a
dataset collected overnight on a local machine can ship inside the code dataset (put it
under `data/`, which `STAGE_IGNORE` does not strip — verified). (b) A collection
script/flag that uses the PIMC agent (heuristic rollouts) as the acting policy, with signal
declarations from the same convention the heuristic uses. Caveat: `pimc_choose_action`
requires a `net` argument even on the heuristic-rollout branch (it calls `net.eval()` and
reads the device) — pass a small random-init net; it is never forwarded. (c) FIRST, a
10-minute timing measurement of PIMC moves/s to size the collection run — if collection
would exceed ~12h local CPU for 6000 games, reduce games or sims and note it.
**Gate:** run only if the operator green-lights after seeing the timing number. Everything
else in this plan is independent of it.
**Verify:** BC on a small PIMC dataset reaches a higher post-BC `vs heuristic` than the same-
size heuristic dataset (the printout in `phase1_bc` already reports this).

### P3.4 — Explicit non-goals (decided, do not implement)

- **Signal receiver/protocol redesign** — the honesty term grounds what signals *mean*, but
  no opponent/teacher reads them, so measured team value is ~0 (ablation: 83.0%→80.8%,
  overlapping CIs). A receiver needs either a signal-aware heuristic or population training
  — out of scope for this run. Keep the runc signal shaping as-is.
- **P100 / dual-T4 / DDP / AMP-in-rollout** — see §1 fact 2. The pin stays
  `MACHINE_SHAPE = "NvidiaTeslaT4"`.
- **MAPPO / league training / architecture growth** — separate research track
  (`becca_ai_plateau`), not a readiness item.

---

## Phase P4 — Execution protocol for the long run (operator, not agents)

1. **Resume drill (mandatory before spending quota):** launch `--preset smoke` with
   `--max-hours 0.05` (stops mid-run, writes `last.pt`) → `pull` → `push-state --create` →
   `launch --preset smoke --resume-state` with the SAME total steps (smoke didn't finish, so
   it continues) → verify in the log: resumed update number continues, anchors non-empty,
   metrics.csv has one header, deals differ from session 1. This exercises every P1 item on
   real Kaggle infrastructure for ~10 minutes of GPU.
2. **Run D spec:** `RUN_D_SPEC = replace(RUN_C_SPEC, wp_mix=[5, 41], total_rl_steps=60M,
   save_last_every=10)` — same network, critic, anchors, signal shaping as Run C, so the
   wp-mix effect is interpretable against Run C's 82%. `--total-rl-steps` is the FINAL
   target, set once in session 1; it and `num_envs`/`steps_per_env` never change on a
   resume (schedules key off them — P0.5).
3. **Budget arithmetic:** at ~760 sps, 60M steps ≈ 22h of RL — but session 1 also pays the
   BC phase, which runs BEFORE the `--max-hours` deadline starts (the deadline covers only
   the RL loop). Set session 1's `max_hours` to `11 − (observed BC hours + 0.5 margin)`
   (Run C's BC ≈ 1h → use 9.5–10.0) so BC + RL stays under the 12h hard kill. Plan for
   **3 sessions**, not 2: 760 sps is an average and a shortfall just rolls work forward,
   whereas a 2-session assumption blows the 30h-week arithmetic. Sessions 2+ launch with
   `--resume-state --total-rl-steps 60000000` (same value; the P0.5 guard is the safety
   net against resuming a finished run).
4. **Ship decision:** `python -m scripts.score_checkpoints best.pt last.pt --games 1000`
   (P3.2) at wp=41; ship the winner to `checkpoints/`; update serving tiers if it beats
   runC. **Acceptance bar:** ≥ Run C's 82% held-out vs heuristic at wp=41; the OOD probe
   features are exercised in training (assert via a sampled batch or the P3.1 test).
5. If Run D ≥ bar, evaluate continuing another 30M steps (week 2) before touching P3.3.

---

## Verification summary (run after each phase)

```bash
cd ai
pytest -x                          # all tests green
ruff check . && ruff format --check .
python -m scripts.gen_bot_fixtures && git diff --exit-code serving/fixtures/
```

Phase P1 additionally requires the Kaggle resume drill (P4.1) before being called done —
unit tests cannot prove the dataset round-trip against real Kaggle infrastructure.
