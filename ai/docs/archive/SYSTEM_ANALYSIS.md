# Archived: BECCA `ai/` System Analysis

> Historical audit snapshot. Finding status is preserved as written and is not
> current operator guidance.

*Consolidated findings from a full six-dimension senior review — architecture, engine/observation, evaluation, serving/inference, testing/ops, and RL training soundness (PPO/self-play/BC plus reward and credit assignment) — every finding adversarially verified against the code. This document is the standalone deliverable for the upcoming restructure.*

**Status note:** This document preserves the pre-implementation audit and its
historical measurements. Current implementation status supersedes the affected
findings:

- **A0 (2026-08-24):** vector deal seeds now use
  `base_seed + worker_id + game_index * num_workers`; the one-million-reset
  regression is collision-free. Checkpoints preserve each worker's live game,
  pending rewards, stream position, current observation, unfinished rollout
  carry, live normalizer chains, and global RNG. CPU snapshot/restore is tested
  to reproduce uninterrupted transitions and deal fingerprints exactly.
- **A1 (2026-08-24):** deferred reward is exposed as `prior_reward` and
  retro-credited to the previous transition for the same `(env, seat)`, rather
  than attached to the seat's next action.
- **A2 (2026-08-24):** the actor observation is 470 floats and the CTDE full
  state is 590. The unchanged 462-float prefix is followed by team captures
  (2), team trick counts (2), and a viewer-relative caller one-hot (4).
- **M21 (2026-07-27):** incomplete live chain tails are bootstrap-only states,
  excluded from PPO while their stored values bootstrap the preceding
  same-seat transitions.

A2 is implemented and parity-tested, but not empirically promoted. Its
fixed-budget three-seed ablation remains unrun; improvement in held-out
explained variance or paired playing strength, without slice regression, is
still an unproven promotion gate.

---

## 1. Executive Summary

**Historical overall verdict.** At audit time, the `ai/` module had an unusually strong *core* wrapped in a *training-orchestration layer that had fragmented*. The pure game engine, the observation/serving contract, the checkpoint provenance abstraction, and the per-`(env,seat)` GAE reconstruction were backed by strong tests. The training *loop* around that core, however, was not uniformly sound: the centralized critic's gradients were never clipped, the return normalizer's coupling to the loop leaked state across episodes and could not track curriculum shifts, and the GAE tail was bootstrapped from zero on window truncation. The audit also missed A1's temporal reward-attribution defect, later isolated by the A0-A2 review. The status note above records the completed corrections without rewriting the remaining historical findings.

No **critical** (results-corrupting-today) findings survived verification. The severity ceiling is **high**: design flaws and silent-instability risks with real ongoing cost.

**The five things that matter most:**

1. **Three PPO loops are copy-pasted and have drifted.** `trainer.py`, `bc_then_rl.py` (the shipping recipe), and `train_and_plot.py` each re-implement the same ~100-line rollout/update/eval/checkpoint body. They already disagree on RNG-restore-on-resume, `best.pt` tracking, LR/entropy schedules, and eval-seed policy. This is the root cause behind several other findings.
2. **The centralized critic's gradients are never clipped.** On CTDE runs — the machinery added specifically to break the ~0.60 explained-variance ceiling, and the path that produced the shipped Run B — the shared Adam optimizer updates the critic, but `clip_grad_norm_` bounds only the actor's parameters. The value clip does *not* bound the gradient (the unclipped squared-error branch wins in the high-error regime), so high-variance full-state value gradients can spike unbounded. This is silent, nothing errors, and it lands on exactly the metric CTDE was introduced to improve.
3. **Historical resume finding, resolved for current CPU checkpoints by A0.** The audit found that the shipping recipe did not restore RNG or checkpoint vector streams. Current checkpoints carry exact vector rollout state and restore RNG after construction; legacy checkpoints do not gain that guarantee.
4. **The headline "~71% vs heuristic" is a biased point estimate.** `best.pt` is the argmax over ~90 noisy 100-game evals against a single deterministic opponent that is *also the BC teacher*, with no confidence interval and no re-evaluation on a fresh deal block. The exact CI tooling exists but is never called from any training path. This matches the team's own 74.5%→71% audit.
5. **Historical observation finding, implemented by A2 but not promoted.** The old 462-float observation could not represent current-round captures, trick counts, or caller identity. The 470-float schema now appends those eight public features, but its strength benefit remains subject to the unrun three-seed ablation.

**What the restructure must preserve** (Section 3) is as important as what it must fix: the string-only enum wire contract, the three-layer serving parity guard, `checkpoint.py`'s `net.config` stamping, the frozen `EVAL_SEED_BASE` discipline, the leak-free reward-delivery + terminal-boundary machinery, and the tightly-pinned GAE/normalization test suite.

---

## 2. System Overview

The module trains Beccaccino bots by behavioral cloning (BC) warm-start followed by PPO self-play, then serves them to the game backend over HTTP.

- **`becca_env/`** — pure-Python game engine (`deck.py`, `rules.py`, `game.py`), the shared signal convention (`signals.py`), the 470-float observation + 160-slot action encoder (`observation.py`), and the Gymnasium wrapper + reward design (`env.py`).
- **`training/`** — `config.py` (TrainConfig), `network.py` (V1–V4 architectures; V4 is the shipped transformer), `ppo.py` (the update), `rollout.py`/`dual_rollout.py`, `trainer.py` (a pure-PPO loop), `imitation.py` (BC), `checkpoint.py`, `normalization.py`, self-play pool, curriculum, and vec-env.
- **`evaluation/`** — `arena.py` (`NeuralAgent`, eval-vs-random, frozen `EVAL_SEED_BASE`, Elo ladder), `heuristic.py` (scripted baseline = BC teacher = eval yardstick), `stats.py` (Wilson CI), `elo.py`.
- **`serving/`** — `app.py` (FastAPI `/predict` + `/act` + `/tiers`), `state_adapter.py` (backend JSON → `BeccaGame`), `tiers.py` (facile/medio/forte/esperto), committed fixtures, ONNX export.
- **`inference/`** — PIMC (perfect-information Monte Carlo) search + hand sampler; backs the `esperto` tier.
- **`scripts/`** — `bc_then_rl.py` (**the real training recipe for all GPU runs**), `kaggle_run.py` (drives Kaggle GPU runs), `watch_bots.py` (signal audit), `elo_ladder.py`, `train_and_plot.py` (demo), fixtures generator.
- **`tests/`** — 267 pytest test functions across 35 files.

Data flow at serving time: backend sends game state as **enum strings** to `/act`; `state_adapter` reconstructs a `BeccaGame` and recomputes trick winners itself; the tier agent picks a move; a runtime 409 legality gate cross-checks against the backend's own legal-move set.

---

## 3. What Is Done Well (preserve through the restructure)

These are load-bearing correctness seams. Breaking any of them silently corrupts training or serving.

- **String-only enum wire contract.** `state_adapter.py` crosses everything as enum strings, never indices, structurally neutralizing the `DENARA/SPADE/COPPE/BASTONI` (backend) vs `denara,spade,coppe,bastoni` (Python) suit-order transposition. It is documented (`state_adapter.py:7-16`) and defended by a regression test that fails if the two enum orders ever converge (`tests/test_state_adapter_parity.py:178-189`).
- **Python as single rules authority.** `_trick_record` recomputes each completed trick's winner via `determine_trick_winner` rather than trusting the backend (`state_adapter.py:128-146`), pinned by `test_completed_trick_winner_is_recomputed_not_trusted`.
- **Three-layer serving parity guard.** Python round-trip parity across all four viewer perspectives, committed `(state, expected_obs)` fixtures the TS serializer is asserted against with a "regeneration must be a no-op" contract, and the runtime 409 legality gate. The scope gaps of each layer are stated honestly rather than hidden.
- **Checkpoint provenance and exact CPU continuation.** `save_checkpoint` persists model, optimizer, normalizer, pool, RNG, config, and current vector `rollout_state`. The latter includes each live game/seed stream plus unfinished rollout carry. `net.config` stamps `obs_size`, while legacy widths are inferred for inference compatibility.
- **`signals.py` single convention.** The honesty convention (`BUSSO_STRENGTH_FLOOR`, `STRISCIO_MIN_REMAINING`, volo=void) is defined once and consumed by reward shaping (`env.py:191`), the BC teacher, and the audit, with `honest_signal_for` consistent with `signal_is_honest` by construction (`signals.py:34-65`). This eliminates the train-against-one-convention/measure-another failure mode.
- **Reward delivery and attribution are leak-free and double-count-free after A1.** `env.step` returns reward generated by the current action and surfaces older pending credit as `prior_reward`. Collectors retro-credit that value to the previous transition for the same `(env, seat)`. Terminal residual handling remains separate. Focused tests pin round-boundary attribution for all learner seats/teams and preserve per-game and zero-sum totals.
- **Opponent-ended-game terminal handling in the buffer is correct.** `compute_gae` resets all four seats of an env on any `done` (`rollout.py:86-92`), and `_mark_latest_transition_done` stamps `done` on the single most-recent learner transition when an opponent seat plays the final card (`dual_rollout.py:174-191`); because both learner seats' last transitions are at or before that index, the reverse-pass reset cuts *both* chains, so one stamp genuinely suffices. Terminal residuals are routed to each learner seat's own last transition, landing the boundary reward on the same transition GAE treats as terminal, and `_credit_terminal_residuals` skips the acting seat and near-zero residuals so no seat is credited twice (`rollout.py:159-171`). The SAME_STEP autoreset does not mispair obs/reward: the stored transition uses the pre-step obs with the same step's reward/done, and the reset obs is only consumed on the next iteration.
- **Frozen `EVAL_SEED_BASE`.** Every checkpoint is scored on an identical deal block (`arena.py:17-20`, `heuristic.py:260-261`), so win-rate curves track skill rather than deal luck. Correctly and consistently implemented in both `trainer.py` and `bc_then_rl.py`, and tested (`test_eval_against_random_is_deterministic_on_frozen_seed`).
- **Exemplary RL-math tests.** `tests/test_gae.py` includes real negative controls and per-(env,seat) isolation regressions with hand-computed expected values. A1 adds round-boundary retro-credit tests. `tests/test_normalization.py` pins Welford streaming-vs-oneshot equality, per-(env,seat) isolation, and round-tripping of live return chains required for exact CPU resume.
- **Correct PPO KL early-stop.** `ppo.py:58-120` compares each epoch's own mean divergence to `target_kl` (`epoch_kl_sum/epoch_mb_count`), with an explicit comment on why a cumulative accumulator would dilute epoch-0's near-zero KL and disable the brake — a fix many implementations get wrong.
- **BC warm-start masks illegal actions and leaves the value head untrained.** `forward()` adds `(1-mask)*(-1e8)` before `Categorical`, so illegal actions and follower signal slots get ~0 probability and zero gradient (`imitation.py:150-151`, `network.py:129,386`); only logits enter the loss, so the value head is correctly left cold while the shared trunk is warm-started.
- **CTDE value bookkeeping is self-consistent.** When a critic is supplied, the stored `old_values` (`dual_rollout.py:110-113`) and the refit `new_val` (`ppo.py:74`) both come from `critic(full_obs)` on the same per-transition `full_obs`, so the value clip is applied in one coherent value space rather than mixing critic and actor estimates.
- **CTDE critic kept separate from the actor trunk** to avoid leaking hidden-hand information into the policy (`network.py:143-150`, `observation.py:241-257`) — a correct, non-obvious choice.
- **`best.pt` resume-bar carry.** The resumed best bar prevents a resumed run from overwriting a better checkpoint with a mediocre first eval (`trainer.py:114-132`, `bc_then_rl.py:296-325`), tested by `test_resume_inherits_the_best_bar`. A `-1.0` sentinel ensures a genuine 0% eval still records a best.
- **Kaggle drift guard.** `test_runspec_cli_args_parse_through_bc_then_rl` feeds rendered flags through `bc_then_rl.parse_args()`, so a desynced RunSpec fails loudly rather than at hour 3 on the GPU; `test_launch_refuses_large_run_without_confirm` asserts no push happens without confirmation.

---

## 4. Findings by Severity

There are **no critical** findings. High findings follow, then medium, then low.

### HIGH

---

#### H1 — Three PPO training loops triplicate the core body and have already drifted in behavior

**Location:** `training/trainer.py:246-343`, `scripts/bc_then_rl.py:349-422`, `scripts/train_and_plot.py:138-212`

**Description.** The opponent-sampling / rollout-collect / `ppo_update` / explained-variance / sps / pool-add sequence is copy-pasted across all three loops (~100 near-identical lines each). Because they are independent copies, they have diverged in ways a reader cannot infer from one file, and the shipping recipe (`bc_then_rl.py`) is one of the divergent copies.

**Evidence.** All three files read in full. (a) RNG restore appears only in `trainer.py:133-134`; `bc_then_rl.py:298-314` never restores it (see H3). (b) `best.pt` tracking is present in `trainer.py:371-375` and `bc_then_rl.py:407-412` but entirely absent from `train_and_plot.py` (only a final `torch.save`). (c) The cosine-LR-with-0.1-floor and linear-entropy-anneal schedules are inlined at `trainer.py:77-84`, `bc_then_rl.py:350-354`, and `train_and_plot.py:140-143` — identical math in three places, so any schedule change propagates to one loop only. `trainer.py` factors schedules into helpers while the two scripts inline them.

**What better looks like.** One parameterized PPO engine in `training/` (e.g. `run_ppo(config, net, critic, hooks)`) owning the loop, schedules, eval cadence, and checkpoint policy. `trainer.py`, `bc_then_rl.py`'s phase 2, and the demo should all call it, differing only in setup and config. Behavior differences that must remain (e.g. wandb on/off) become config flags, not forked code — so drift becomes impossible rather than merely discouraged. This is the keystone workstream: it dissolves H3's RNG drift, M5, M6, M16, and L1 for free.

---

#### H2 — Centralized critic gradients are never clipped although the shared optimizer updates them

**Location:** `training/ppo.py:96-99`, `training/trainer.py:100-107`, `training/network.py:143`

**Description.** When CTDE is on, `trainer.py:100-107` builds `CentralizedCritic` (a separate `nn.Module`) and appends `critic.parameters()` to the same Adam optimizer as the actor. `ppo.py:95-99` backprops the combined loss (which includes `vf_coef*v_loss` computed from `new_val=critic(full_obs)`) and steps the optimizer over both nets — but the gradient-norm clip at `ppo.py:98` is `nn.utils.clip_grad_norm_(net.parameters(), max_grad_norm)`, which clips **only the actor's** parameters. The critic's gradients are entirely unclipped. Critically, the value clip at `ppo.py:85-90` does **not** bound the critic gradient: `v_loss = 0.5*max(unclipped, clipped)`, so when `new_val` diverges from `returns` the *unclipped* squared-error branch (full gradient) wins — the critic gradient is unbounded in exactly the high-error regime clipping is meant to guard. This is the shipped CTDE path, it silently defeats the `max_grad_norm` safety that *is* applied to the actor, and it lands on the high-variance full-state value fit that CTDE was introduced to improve.

**Evidence.** `ppo.py:98` clips only `net.parameters()`; `critic` params are in the optimizer (`trainer.py:100-107`) but absent from that clip call. CTDE default is `False` (`config.py:61`), so pure `trainer.py` runs without `--centralized-critic` are unaffected — the bug bites only CTDE runs, which is where the explained-variance metric it was meant to improve lives.

**What better looks like.** Clip the full set of trained parameters the optimizer owns — chain `net.parameters()` and `critic.parameters()` into a single `clip_grad_norm_` call, matching the param list built at `trainer.py:95-106`. Add a test asserting the critic's grad-norm is bounded so this cannot silently regress. Do this before any restructure touches `ppo.py`.

---

#### H3 — RESOLVED BY A0: shipping resume did not restore exact stochastic state

**Location:** `scripts/bc_then_rl.py:298-314`, `training/checkpoint.py:1-8`, `training/vec_env.py:25-46`, `becca_env/env.py:107-117`

**Historical finding.** Two independent mechanisms broke the "reproducible from
its seed / resumed byte-consistently" claim: the shipping recipe did not restore
parent RNG, and vector workers did not checkpoint their live deal streams.

**Current resolution.** Worker `i`, game `g`, now draws
`base_seed + i + g * num_workers`, which is collision-free across the vector
run. `rollout_state` snapshots each live game, pending rewards, game counter,
current seed/deal fingerprint, current observation, and unfinished rollout
carry. The return normalizer persists live per-seat chains, and global RNG is
restored only after constructors that consume it. The CPU regression compares
the complete resumed rollout with uninterrupted execution and then compares
the subsequent worker seed/fingerprint state.

Checkpoints predating `rollout_state` are rejected for exact resume. This is an
exact CPU guarantee, not a claim of bit-identical GPU continuation.

---

#### H4 — Both resume paths rebuild the network from CLI flags, not the checkpoint's stamped `net_config`

**Location:** `scripts/bc_then_rl.py:533-539`, `training/trainer.py:93-121`, `training/checkpoint.py:78-82`, `docs/TRAINING_RUNBOOK.md:148-150`

**Description.** `build_net()`/`net_config_of()` exist precisely so a loader never guesses architecture, yet neither resume path uses them. `bc_then_rl.main()` calls `make_net(args, …)` from CLI flags then `load_state_dict`; `trainer.train()` builds the net from `config.net_kwargs()` then `load_state_dict`. If a resume repeats the wrong `--d-model/--layers/--dim-feedforward`, `load_state_dict` crashes on a shape mismatch. Worse, forgetting `--centralized-critic` on resume **silently drops the critic** — the checkpoint's `critic` key is loaded only `if critic is not None`, and the critic is constructed only from the flag (`trainer.py:96/122`, `bc_then_rl.py:262/302`). `build_net` (`checkpoint.py:78-82`) reads the stamped `net_config` but is used only on eval/onnx/test paths.

**Evidence.** Read both resume paths as cited. The runbook itself documents this verbatim as the "resume landmine" — a warning rather than a fix. No test covers it.

**What better looks like.** On resume, reconstruct the network from the checkpoint's stamped `net_config` via `build_net`, and derive `centralized_critic` and other structural flags from what the checkpoint actually contains, treating CLI arch flags as overridden. This eliminates an entire class of resume-time crashes and silent critic-drops.

---

#### H5 — Checkpoint format duality: the shipping recipe emits both the unified format and flat legacy payloads in a single run

**Location:** `scripts/bc_then_rl.py:213-218`, `scripts/bc_then_rl.py:451-456`, `training/checkpoint.py:65-75`, `serving/tiers.py:62,68`

**Description.** `bc_then_rl.py` writes `best.pt`/`last.pt` via the unified `save_checkpoint` (format=2, with `net_config`/`step`/`rng`/`normalizer`/`pool`) but writes `bc_initial.pt` (`:213-218`, keys `config`/`phase`/`bc_games`) and the `--final-ckpt` (`:451-456`, keys `config`/`steps`/`phase`) as ad-hoc flat `torch.save` dicts with different key names. The `--final-ckpt` becomes the shipped `runB_rl.pt` tier file. `net_config_of()` exists solely to paper over this: it tries `net_config`, falls back to `config`, and renames a legacy `network_version`→`version`, warning in its own docstring that without the rename it "silently falls back to V2 and `load_state_dict` fails on a shape mismatch." The serving tiers load these flat files (`tiers.py:62,68`), so production depends on the tolerant reader absorbing a format the writer never should have produced.

**Evidence.** All three writers read and confirmed. **Correction to the original write-up:** `bc_then_rl`'s flat `config` comes from `_net_config_dict` (`:123-140`), which emits `version` (not `network_version`), so the rename branch does *not* fire for `runB_rl.pt`; the `network_version` key appears only in `train_and_plot.py:220`. The core defect stands: three on-disk formats, and the shipped serving path relies on a compatibility shim.

**What better looks like.** Make `save_checkpoint` the only writer. If a lightweight inference-only artifact is genuinely wanted, define it explicitly (one function, one documented schema) rather than hand-rolling `torch.save` at three call sites with drifting keys. Goal: exactly one on-disk format, so `net_config_of`'s shim can eventually be deleted rather than depended on. (Combined with L2's silent V2 default, a single field-name typo in a flat payload is a silent wrong-architecture load.)

---

#### H6 — IMPLEMENTED BY A2; PROMOTION ABLATION OPEN: current-round public state

**Location:** `becca_env/observation.py:148-238`, `becca_env/game.py:172,317-318`

**Historical finding.** The 462-float observation recorded who played each card
but could not recover which team won completed tricks, current-round captures,
trick counts, or caller identity.

**Current resolution.** `OBS_SIZE` is 470 and `FULL_STATE_SIZE` is 590. The
legacy prefix is unchanged. Offsets `462:464` encode team raw captures divided
by 35, `464:466` encode team trick counts divided by 10, and `466:470` encode
the caller seat relative to the viewer. State-collision tests prove that
changing only trick ownership changes the appended features, and serving
fixtures were regenerated.

**Open gate.** This proves representation and parity, not model quality. A
fixed-budget three-seed ablation must improve held-out explained variance or
paired playing strength without slice regression before the A2 architecture is
promoted. No such result exists yet.

---

#### H7 — `best.pt` is the argmax over ~90 noisy evals with no CI and no re-eval — the headline win rate is winner's-curse inflated

**Location:** `scripts/bc_then_rl.py:395-412`, `training/trainer.py:350-375`, `evaluation/stats.py:11`

**Description.** `best.pt` is saved whenever `last_wr_heuristic` exceeds the running max. The shipping recipe evals every 10 updates at `eval_games=100` (SE at n=100 for p≈0.71 is 4.5pts). Selecting the maximum over ~90+ such evals (Run B ran 915 updates → ~92 evals) is optimistically biased by construction; the peak is reported directly with no confidence interval and is **never re-evaluated on an independent deal block**. This is consistent with the team's own audit (final CSV said 74.5%, true ~71%). The exact CI tool (`wilson_interval`) and the `(wins, n)` plumbing (`return_counts`) both exist but are called only from `tests/test_stats.py`, never from any training or reporting path — every eval call site discards the counts and keeps the bare float.

**Evidence.** `eval_games` default 100 (`bc_then_rl.py:96`) / 200 (`config.py:104`); argmax at `bc_then_rl.py:407` and `trainer.py:371`; best-selection evals pass no seed, hitting the frozen block; no re-scoring of `best.pt` vs heuristic on an independent block. **Correction:** because every update is scored on the *same* frozen block, the per-update win rates are positively correlated, not near-i.i.d., so the original "+8 to +11pts" figure is a loose upper bound, not a tight estimate. The qualitative bias and its direction hold.

**What better looks like.** Report the selected checkpoint with a Wilson CI, and re-evaluate `best.pt` on a *second* frozen deal block before quoting any headline. Honest reporting: "`best.pt` scored X% [CI] on the selection block, Y% [CI] on a held-out block." Raise `eval_games` for the selection metric so a single eval's noise is smaller than the deltas being claimed (n=100 cannot resolve a 3.5pt improvement).

---

#### H8 — Selection relies on a single deterministic, self-referential opponent and no other signal (no PIMC ceiling, no per-role/seat, no signal/briscola quality)

**Location:** `evaluation/heuristic.py:81-92,243-278`, `scripts/bc_then_rl.py:175-179`, `training/trainer.py:350-375`, `scripts/watch_bots.py`, `evaluation/arena.py:64-79`

**Description.** `HeuristicAgent` is simultaneously the BC teacher (`collect_heuristic_dataset` trains the warm-start policy to imitate it) and the sole strength yardstick that selects `best.pt`. Three compounding biases: (1) beating the teacher partly measures "did RL diverge from BC" rather than "is the policy strong"; (2) the heuristic is deterministic (its `rng` is constructed but never read; tie-breaks use deterministic keys) and by design never counts cards cross-trick and never signals (`declare_signals=False`), so on the frozen block it plays fully-determined lines the policy can memorize and exploit without becoming generally stronger; (3) there is no second independent baseline. Compounding this, several things a design review would expect to gate selection are measured nowhere in the loop: **no eval vs PIMC** (even though PIMC is the team's stated lever beyond the ~71% plateau — the plateau is asserted structural without a PIMC number to bound it), **no per-seat/per-role breakdown** (caller vs non-caller, so a strong-declarer/weak-defender policy is invisible behind the average), and **briscola-call quality and signal honesty** live only in `watch_bots.py`, a standalone CLI never imported by any training loop.

**Evidence.** Same class used for BC dataset and for `evaluate_against_heuristic`; determinism at `heuristic.py:85-86`; behavioral limits documented at `heuristic.py:27-29,87-92`. `watch_bots.py` `main()` is standalone (grep: no import from `trainer.py`/`bc_then_rl.py`). `arena.MatchResult` tracks only team0/team1 game wins. No `PIMC`/`inference` grep hit in any eval or selection path.

**What better looks like.** Introduce at least one independent baseline the policy was *not* trained to imitate — the in-repo PIMC agent (already the `esperto` tier) is the obvious candidate — for selection/reporting, and add a periodic eval vs PIMC to bound the model-free ceiling and justify the "plateau is structural" claim with a number. Break win rate down by role (caller/non-caller) and side, and fold the `watch_bots` signal-honesty and briscola metrics into the logged eval so no checkpoint ships blind to how it actually plays. Keep the current heuristic as a regression tripwire; do not let it be the sole determinant.

---

#### H9 — The PPO clipped-surrogate and value-loss math have no correctness test

**Location:** `training/ppo.py:77-90`, `tests/test_ppo.py:1-82`, `tests/test_centralized_critic.py`

**Description.** The core PPO objective — clipped surrogate (`pi_loss = -torch.min(surr1, surr2).mean()`, `ppo.py:82`), clipped value loss (`:85-90`), and advantage normalization (`:47`) — is exercised by zero correctness assertions. `test_ppo.py` tests only KL early-stopping (`epochs_used`/`approx_kl`), which is invariant to gradient *direction*: a sign flip on `pi_loss`, an inverted clamp on `surr2`, or dropping advantage normalization would leave every test green while silently corrupting every training run. `test_centralized_critic.py::test_ppo_update_fits_critic_grad_flows` only checks that critic weights *change*, not that they move correctly. This is the one piece of RL math that is both central and unguarded, in sharp contrast to the tightly-pinned GAE/normalization suites.

**Evidence.** `ppo.py` read in full; grep of the PPO/critic tests for `policy_loss`/`surr`/`clip`/`value_loss` returns no assertions on loss sign or magnitude.

**What better looks like.** Unit tests that pin the objective's direction: a batch with a known positive advantage on one action must increase that action's log-prob after an update; a hand-constructed ratio outside `1±clip_eps` must produce the clipped (not unclipped) surrogate; value clipping must cap the value-loss contribution when `new_val` moves beyond `clip_eps`. These make a sign flip or clamp inversion fail immediately — essential before a restructure touches this file.

---

#### H10 — No CI: 267 tests and the parity-critical serving fixtures are gated only by developer discipline

**Location:** `ai/pyproject.toml:45-46` (config only); no `.github/workflows` anywhere in `ai/` or the parent repo

**Description.** Nothing automatically runs `pytest`, `ruff`, or — most importantly — the Python↔TypeScript serving-boundary parity checks on push. The three layers that guard the card-index boundary (state_adapter parity, committed `bot_states.json` fixtures, the `/act` legality gate) and the `gen_bot_fixtures` "must be a no-op" contract are all human-enforced. A silent drift in the observation encoder or suit ordering would corrupt served bots and is caught only if a human remembers to run both suites. For a project about to be restructured, the absence of a gate means refactors can break RL-math regressions or the serving boundary with no signal.

**Evidence.** `find` for `.github/workflows` returns nothing under `ai/` or repo root (the only hits are inside `frontend`/`backend` `node_modules`, i.e. third-party). Test count independently verified at 267 `def test` functions.

**What better looks like.** A minimal CI that on every push runs `ruff check`, the Python unit suite, and (cross-repo) the fixture-parity assertion — plus a check that `gen_bot_fixtures` is a no-op so a stale fixture fails the build. The single highest-leverage ops addition before restructuring.

---

#### H11 — The `esperto` PIMC tier is structurally signal-blind — it can never declare a signal

**Location:** `inference/pimc.py:213-257,115-133`, `becca_env/observation.py` (leader mask branch), `serving/tiers.py:29-33`

**Description.** When acting as trick leader, PIMC evaluates each legal flat action, but the four signal variants of the same card (no-signal/striscio/busso/volo) yield **byte-identical** rollout values, so `np.argmax` always returns the first (signal_idx=0, no signal). The rollout policy is `HeuristicAgent` (which ignores `trick_signals` entirely) and the terminal value is a pure score-delta (round-end scoring is signal-independent), so nothing in the PIMC value estimate can depend on the leader's signal. This silently negates the signal channel just added (2026-07-25) for the *strongest* tier: `esperto` is strictly a downgrade of `forte` on the signal dimension, and against humans who read signals it is behaviorally distinguishable and arguably weaker. It also does 4× redundant rollout work per leader action.

**Evidence.** Verified empirically: on a real leader position (`BeccaGame` seed=42 after briscola), the four variants of `card_idx 3` (flats 12/13/14/15) all returned `rollout_value = -0.542857` under the same determinization, and `pimc_choose_action` returned flat=12 (no signal). `net.forward` is called 0 times in the heuristic-rollout path. `forte`'s `NeuralAgent` argmax over logits *can* pick a signal slot; `esperto` cannot.

**What better looks like.** Decide explicitly whether `esperto` should signal. If yes, make the value estimator signal-aware (let rollout opponents condition on the declared signal, or fall back to the net's policy head for the signal choice while PIMC picks the card). If no, collapse the leader action set to the 10 distinct cards before search so the tie is not resolved arbitrarily and the 4× redundant work disappears — and document that `esperto` intentionally does not signal.

---

### MEDIUM

---

#### M1 — Briscola selection is overloaded onto card-0's token and the signal head in the V3/V4 action space

**Location:** `becca_env/observation.py:269-306`, `training/network.py:472-486,362-387`

The 160-slot action space is flat `card_idx*4 + signal_idx`. For `CHOOSE_BRISCOLA` the mask enables slots 0–3 (`observation.py:270-272`), which are `(card_idx=0, signal_idx=0..3)`, and `decode_action` maps 0–3 to the four suits. In the factorized V3/V4 heads, `logit[i] = card_logits[0] + signal_logits[i]`, so all four briscola options share `card_logits[0]` and the argmax is decided entirely by the signal head (trained mainly to mean striscio/busso/volo). Briscola-suit preference — which should weigh the whole hand's suit distribution — is expressed through the 4-wide signal head and card-0's arbitrary token (denara-asso). It works because the mask makes it legal and gradients flow, but it is hidden cross-phase coupling a restructure will trip over. **Downgraded to medium** (from high): the mechanism is correct and deterministic, and briscola is a once-per-round decision on disjoint-phase inputs the net can distinguish; the cost is design debt, not a silent-failure risk. **Better:** give briscola its own action region or a dedicated 4-way phase head reading a hand-suit summary, not sharing parameters with the signalling channel.

#### M2 — Relative-seat convention is inconsistent across observation features

**Location:** `becca_env/observation.py:88-145,194-224`

`void_mask` and `signal_mask` use viewer-relative rows (`rel=(s-viewer_seat)%4`) and `card_status` uses relative classes (mine/partner/left/right), but `my_seat` (`:204`), `trick_starter` (`:208`), and the score pair (`:223-224`) are absolute. To recover "did my partner lead this trick" or "am I ahead," the network must cross-reference the absolute `my_seat` one-hot against the absolute `trick_starter`/scores — wasting capacity and breaking the seat-rotation symmetry the relative masks were designed to give the transformer. **Better:** pick one frame (viewer-relative is natural given the masks and self-play symmetry) and apply it uniformly — encode `trick_starter` relative to the viewer and scores as `(my_team, opp_team)`.

#### M3 — RESOLVED BY A2: caller identity was dropped by the encoder

**Location:** `becca_env/observation.py:148-238`, `becca_env/game.py:176`

The audit found that `caller_seat` was public but absent from the legacy
observation and unrecoverable after `trick_starter` changed. A2 now appends a
4-slot viewer-relative caller one-hot at offsets `466:470`; observation and
serving-fixture tests pin the layout.

#### M4 — The backend-parity guarantee rests on a thin fixture set

**Location:** `ai/serving/fixtures/bot_states.json`, `ai/serving/state_adapter.py:165-196`

The committed `(state, expected_obs)` fixtures are the only cross-language check that the TS serializer matches the Python encoder byte-for-byte, and there are only 8 cases (1 `choose_briscola`, 7 `play_card`). **Correction to the original write-up:** cross-seat signals *are* covered (the `signals_and_void_mid_trick` case has a populated `signal_mask`) — that sub-claim is refuted. But three genuinely divergence-prone branches remain uncovered: (1) the void-*deduction* bit is never actually set (the "void" fixture's mask is all zeros because every seat followed suit); (2) the score `/max_raw` clip is never exercised (scores 37/14 → 0.30/0.11); (3) cricca is absent from the wire format entirely (`game_to_state_dict` emits no cricca field). A serializer bug in an uncovered path would pass CI and surface only as silently wrong bot play (or be caught late by the legality gate, which checks legality, not obs correctness). **Better:** add fixtures for a deduced void, a score near the clip boundary, and a completed-trick-heavy mid-round position; regeneration is a documented no-op-if-unchanged, so it is low-cost.

#### M5 — `train_and_plot.py` evaluates on a sliding per-update seed, contradicting the frozen-eval-block convention

**Location:** `scripts/train_and_plot.py:186-193`

This loop passes `seed=cfg.seed + update` to both eval functions (`:188`, `:191`), so every eval point uses a *different* deal set — mixing skill change with deal-luck noise, the exact failure the frozen block was introduced to eliminate. `trainer.py` and `bc_then_rl.py` deliberately pass no seed, hitting `EVAL_SEED_BASE`. It is a demo, which caps impact, but it renders an authoritative-looking `learning_curve.png`. **Better:** dissolves for free once the shared engine (H1) owns eval-seed policy; short of that, drop the `+update` term or annotate the axis as noisy.

#### M6 — Four overlapping run-configuration surfaces with disagreeing defaults

**Location:** `training/config.py:53`, `training/trainer.py:489`, `scripts/bc_then_rl.py:108`, `scripts/kaggle_run.py:70`

"What is a training run" is defined four times, with `network_version` defaulting to **2 / 2 / 3 / 4** across `TrainConfig`, the `trainer.py` argparse, the `bc_then_rl.py` argparse, and `kaggle_run.py`'s `RunSpec` respectively. A reader cannot tell what a bare invocation trains without tracing which surface it hits. The argparse surfaces are non-uniform subsets of `TrainConfig` (`bc_then_rl` exposes signal/critic/anchor flags but not curriculum/gamma/trick-shaping; `trainer` exposes curriculum but not centralized-critic/anchors). The version→kwargs "V4 gets transformer dims else MLP dims" rule is encoded in four places: `config.net_kwargs()` (`config.py:111-128`), `_net_config_dict` and `make_net` (`bc_then_rl.py:123-157`), and `create_network` (`network.py:181-213`). **Better:** `TrainConfig` should be the single run definition; scripts build a `TrainConfig` (preset + explicit overrides) and hand it to the shared engine. The version→kwargs mapping should exist only in `config.net_kwargs()`/`create_network`; the others should call through to it.

#### M7 — The shipping recipe hardcodes wandb off — GPU runs have the weakest observability

**Location:** `scripts/bc_then_rl.py:242,248-257`

`bc_then_rl.py` constructs `TrainConfig` with `use_wandb=False` unconditionally (`:242`) and has no flag to enable it, while `trainer.py` fully supports wandb (`--no-wandb` at `:527`) — but `trainer` is not the recipe that ships models. The only in-run record is `runs/bc_rl/metrics.csv`, and the CSV **forward-fills** the last eval value into every intermediate row (`last_wr_*` are written every update at `:421` but only updated inside the eval block at `:395-403`), silently misleading any offline curve reading it. **Downgraded to medium** (from high): `kaggle_run.py` has an explicit `pull` verb that fetches `/kaggle/working` outputs (best.pt/final.pt/metrics.csv), so persistence exists — it is just manual/post-run, making this observability debt rather than a data-loss risk. **Better:** give `bc_then_rl` the same `--wandb-*` wiring and default it on for GPU runs, or stream metrics+best.pt to durable storage from inside the run; mark forward-filled rows (NaN or a separate eval-only file) so offline plots do not read a carried-forward value as a measurement.

#### M8 — `evaluate_against_random`/`heuristic` use disjoint deals for the two seat-sides, confounding seat-swap with deal luck

**Location:** `evaluation/arena.py:180-188`, `evaluation/heuristic.py:268-278`

Both eval functions play half the games with the neural agent as team0 on seeds `[seed, seed+half)` and the other half as team1 on seeds `[seed+half, seed+2*half)`. The side swap is meant to cancel first-seat advantage, but because the two halves use *different* deals, seat effect and deal effect are confounded and the paired-comparison variance reduction of a mirrored design is lost. Notably `elo_ladder` gets this right (same `block_seed` in both orderings, `arena.py:149-152`), so two eval paths in the same module use inconsistent pairing — and the weaker one selects `best.pt`. **Better:** use the same deal seeds for both seat orderings (mirror the deal, swap only the side), as `elo_ladder` already does. This cuts eval variance for free at the same game count, directly shrinking the CI on the H7 selection metric.

#### M9 — Train/eval deal separation depends on a large magic constant, not a structural guard

**Location:** `evaluation/arena.py:20`, `becca_env/env.py:107-115`, `scripts/bc_then_rl.py:175-179`

After A0, training worker `i`, game `g`, draws
`base_seed + i + g * num_workers`, eliminating collisions between workers. The
BC dataset still starts at `args.seed=0`, while eval uses
`EVAL_SEED_BASE=20260724`. The worker fix does not reserve a separate eval
namespace: a sufficiently large run or raised base seed could still enter the
eval band. Reserve an eval range or assert non-overlap from the configured base
and maximum game count.

#### M10 — Malformed `/act` state returns an opaque 500, contradicting the documented 422 contract

**Location:** `serving/app.py:131-134`, `serving/state_adapter.py:87-98`

`state_dict_to_game` bare-subscripts several top-level keys (`win_points`, `total_scores`, `round_number`, `caller_seat`, `trick_starter`, `hands`). A missing key raises `KeyError`, which `/act` does not catch (it catches only `StateAdapterError`), so the caller gets a 500 with a stack trace instead of the documented "422 malformed game state." Separately, the adapter never checks hand-size consistency (`sum + played = 40`), so an inconsistent-but-well-formed state passes and then raises a bare `ValueError` deep in the PIMC hand sampler (`hand_sampler.py:142`) — again a 500, and only for `esperto`. The backend falls back to autoplay on any non-2xx, so functional impact is mainly noisy logs and poor debuggability. **Better:** validate required top-level keys in `state_dict_to_game` and raise `StateAdapterError`; add the hand-size conservation check there so inconsistent boards are rejected uniformly before any tier runs. Then all malformed input maps to 422 regardless of tier.

#### M11 — `/predict` + ONNX is a second, divergent inference stack that is effectively dead

**Location:** `serving/app.py:54-99`, `serving/export_onnx.py`, `serving/tiers.py:124-145`

The backend calls only `/act` (torch + tier agents). `/predict` runs a separate `onnxruntime` stack against `serving/model.onnx` (gitignored, never produced by any documented serving step), returns a `confidence` field `/act` does not, and has no parity test tying its output to the torch path actually served (`test_export_onnx` only checks ONNX==eager for a random throwaway net). Maintaining two inference implementations across the boundary the whole design keeps singular undercuts that goal. **Better:** pick one serving story — delete `/predict` + `export_onnx` and standardize on `/act` + torch, or make ONNX the actual serving backend and add a parity test to the served `.pt` path. Do not carry two encoders through a restructure.

#### M12 — Temperature plumbing is dead in production — all neural tiers are fully deterministic

**Location:** `serving/app.py:112`, `serving/tiers.py:108-131`, `backend/src/services/botClient.ts:56-66`

`ActRequest.temperature` defaults to 0.0 and the backend never sends it (the `turnTimer` caller also omits it), so every neural tier (facile, forte) runs argmax and `esperto`'s PIMC is fixed-seeded. A bot plays an identical move in an identical state every time — making weak bots perfectly predictable, the exact thing the temperature lever, `MAX_TEMPERATURE` bound, and per-temperature cache key were built to prevent. **Better:** either wire a per-tier default temperature through the backend (so lower tiers vary their play) or remove the machinery and document that tiers are deterministic. A plumbed-but-unreachable knob invites the next engineer to assume it works.

#### M13 — Curriculum: the tested module is unused, the production path is untested, and its `max_steps` safety valve is silently ignored

**Location:** `training/curriculum.py:23-64`, `training/trainer.py:378-407`, `training/config.py:86-91`, `tests/test_curriculum.py`

`CurriculumTracker` is fully unit-tested but never imported by `trainer.py` or `bc_then_rl.py`; the trainer reimplements advancement inline against `config.curriculum_stages` with a `curriculum_confirm` counter and a win-rate threshold. The two implementations **differ in a way that matters**: `config.curriculum_stages` defines a `max_steps` per stage (`config.py:87-90`), documented as a step-budget fallback, and `CurriculumTracker` honors it (`curriculum.py:48-49`: `if total_steps >= stage.max_steps: return self._advance()`) — but the inline trainer logic (`trainer.py:378-407`) references only `min_wr` plus the confirm counter and **never consults `max_steps`**. A stage whose `min_wr` is never met trains there indefinitely with no budget-based advance, and the `max_steps` config field implies a guarantee the running code does not honor. So the tests give false confidence about a path that never runs, while the curriculum that does run has zero coverage; `bc_then_rl` has no curriculum at all. **Better:** either route the trainer through `CurriculumTracker` (unifying the two divergent advance rules and enforcing `max_steps`, making the tests meaningful) or delete the unused module and the `max_steps` field and add a small test over the inline advancement.

#### M14 — The generated Kaggle kernel is only syntax-checked; its runtime failure modes are untested

**Location:** `scripts/kaggle_run.py:206-243`, `tests/test_kaggle_run.py:84-86`

`render_kernel_script` emits a kernel that (a) `pip install`s `gymnasium>=1.0` at runtime over the network, (b) auto-detects the code dir by walking `/kaggle/input` for a marker and taking the *first* match, and (c) probes CUDA and silently falls back to CPU. The only test asserts the string is valid Python — not that the marker walk picks the right directory when a pulled-output copy is also mounted, nor that the CPU fallback triggers correctly, nor that the runtime pip is resilient. These are exactly the paths that fail silently at hour 3 (a CPU fallback shows as ~34 sps per the runbook). The marker-collision risk is currently latent (`STAGE_IGNORE` excludes checkpoints/runs). **Better:** extract marker-detection and CUDA-fallback into importable helpers and assert first-marker-wins prefers the source tree and the device flag flips to cpu when the probe fails; consider vendoring gymnasium into the dataset to remove the network dependency.

#### M15 — Curriculum advancement gate is measured at 41 points regardless of the stage's `win_points`

**Location:** `training/trainer.py:355,378-380`, `evaluation/arena.py:82-86,165-171`

Curriculum advancement is gated on the vs-random win rate `wr` (`trainer.py:380`: `if wr >= stage['min_wr']`). But `wr` comes from `evaluate_against_random(net, num_games, device)` at `trainer.py:355`, and that function has **no `win_points` parameter** (`arena.py:165`) — it calls `play_match` with the default `win_points=41` (`arena.py:86`). So the win rate that decides stage advancement is always measured on full 41-point games, never at the stage's actual training length (e.g. `win_points=5` for stage 0). The heuristic eval on the very next lines (`trainer.py:356-358`) *does* thread `eval_win_points`/`win_points`, making the asymmetry explicit and unintentional-looking. Because a longer match against a random opponent *reduces* variance, a better-than-random agent's 41-point win rate is ≥ its short-game win rate, so the `min_wr` thresholds (0.70/0.70/0.65/0.60, `config.py:87-90`) are evaluated on an easier distribution than the stage trains at — the gate passes sooner than intended. **Better:** thread `win_points` into `evaluate_against_random` (as already done for `evaluate_against_heuristic`) and gate at the stage's own training length.

#### M16 — Schedules silently reshape on resume when `--steps` differs from the original run

**Location:** `training/trainer.py:37-84,125`, `training/config.py:130-136`

The LR (`_lr_schedule`), entropy (`_ent_coef_schedule`) and signal-honesty (`signal_honesty_schedule`) schedules are all parameterized by `config.total_updates`, derived at runtime as `total_timesteps // batch_size` (`config.py:135-136`), where `total_timesteps` comes straight from the CLI `--steps`. On resume `start_update` is restored correctly (`trainer.py:125`), but if the operator passes a different `--steps` than the original run (the runbook explicitly shows resume with a fresh `--steps` value), `total_updates` changes, so the cosine-LR denominator, the entropy anneal, and the signal-honesty ramp are all recomputed against a different horizon — a discontinuity at the resume boundary rather than a smooth continuation. A partial guardrail exists (`trainer.py:235-244` bails early if the new horizon implies `total_updates < start_update`), so the reshape bites only when the new horizon is *larger*. **Better:** persist the original `total_updates`/`total_timesteps` in the checkpoint and restore it on resume so the schedules keep their original horizon, or at minimum warn loudly when the resumed `--steps` implies a different `total_updates`. Dissolves naturally once the shared engine (H1) owns schedule horizon.

#### M17 — Value clipping reuses the policy `clip_eps` in normalized-return units and may cap the value fit

**Location:** `training/ppo.py:85-90`, `training/config.py:35,46`

The clipped value loss clamps `new_val - old_values` to `[-clip_eps, +clip_eps]` using the **same** `clip_eps=0.2` (`config.py:35`) that drives the multiplicative policy-ratio clip at `ppo.py:81`. Because returns are scaled by `ReturnNormalizer` to roughly unit std (`normalize_returns` default True, `config.py:46`), a ±0.2 clip is an aggressive per-update cap on value movement expressed in return-std units — coupled to a hyperparameter chosen for the semantically unrelated multiplicative policy ratio. The RL literature (Engstrom et al. 2020, Andrychowicz et al. 2021) finds PPO value clipping frequently provides no benefit and can impede value fitting. The code coupling is CONFIRMED; whether it *materially* caps the fit and contributes to the `explained_variance~0.60` plateau is an empirical question (see Unresolved Questions). **Better:** decouple the value clip from the policy clip (introduce a separate `clip_range_vf`, or make it `None`) and ablate value clipping entirely before concluding the plateau is structural.

#### M18 — BC dataset has no class balancing; followers (and rare high-value/signal actions) dominate cross-entropy

**Location:** `training/imitation.py:94-104,151`

`collect_heuristic_dataset` records one training sample per transition for every seat (`imitation.py:98-102`), and `behavioral_clone` uses plain `F.cross_entropy` with no class or sample weighting (`imitation.py:151`). Each trick has 1 leader and 3 followers, so follower transitions (which can only ever emit signal slot 0) outnumber leader transitions ~3:1, and the strategically important signal-bearing / high-card lead decisions are a minority of the 160-action target distribution. The loss is therefore dominated by the most common (often lowest-stakes) follow moves, and warm-start quality on the decisions PPO most needs a good prior on is diluted and invisible (no per-class accuracy reported). **Better:** consider class/importance weighting, or at least report per-action-class accuracy (leader vs follower, signal vs no-signal) so warm-start quality on the decisions that matter is visible.

#### M19 — ReturnNormalizer resets its per-seat return accumulator for only one seat per episode

**Location:** `training/normalization.py:94-101`, `training/rollout.py:174-191`, `training/dual_rollout.py:146`

`ReturnNormalizer.normalize` resets the running discounted return for a `(env,seat)` key only when that specific transition's `done` flag is True (`normalization.py:97-98`: `self._returns[key] = 0.0 if done else new_return`). But in `BeccaEnv` only ONE transition per game carries `done=1.0` (the acting/terminal seat), and in selective self-play storage `_mark_latest_transition_done` stamps `done` on just the single most-recent learner transition. Consequently the other learner seat (self-play: 1 of 2) — or 3 of 4 seats in the single-env `collect_rollout` path — never sees `done=True` in the buffer, so their discounted-return accumulators are never reset and leak across episode boundaries. With `gamma=0.995` and consecutive per-chain transitions, the leaked seat's return behaves as if consecutive games were one long episode, driving its return samples to a larger steady-state magnitude and inflating the shared running variance. The effect is silent and bounded — it distorts only the scalar reward scale, and `compute_gae` is unaffected because it independently resets all four seats on any env-level `done` — but it matters most for short `win_points=5` games where gamma-carryover across game boundaries is large. The cited test (`test_return_normalizer_resets_on_done`) passes `done=True` explicitly and never exercises the co-seat-never-reset reality. **Better:** reset `_returns` for ALL seats of an env when that env terminates (mirror the all-4-seats reset `compute_gae` already does), or drive the reset from the same episode-boundary signal `_mark_latest_transition_done` uses; add a test that feeds a single done for one seat and asserts the co-seat's chain also resets.

#### M20 — Running-std estimate never decays, so it cannot track curriculum reward-scale shifts

**Location:** `training/normalization.py:44-53,88-101`, `training/trainer.py:166-168,388-405`

`RunningMeanStd._update_from_moments` grows `count` monotonically (`total = self.count + batch_count`, `normalization.py:44-53`) with no windowing or exponential decay, so after millions of transitions the running variance is effectively frozen. The trainer creates one `ReturnNormalizer` at `__init__` (`trainer.py:168`, comment "kept across rollouts so the running std converges to a stable estimate") and deliberately keeps the same instance across curriculum env rebuilds (`trainer.py:388-405`), while the curriculum changes `win_points` (e.g. 5 → 11 → 41), which changes game length and therefore the magnitude/variance of discounted returns. When a later stage shifts the return distribution, the ossified std barely moves (a fresh ~32k-transition batch moves the variance by ~1e-3), so late-curriculum stages are scaled by a stale estimate dominated by early short-game statistics — defeating the normalizer's stated purpose of keeping value targets O(1) "regardless of game length." A silent rigor issue that degrades value-target conditioning in exactly the stages that matter most. **Better:** reset (or partially decay) the running stats when the curriculum advances to a new `win_points`, or switch `RunningMeanStd` to an exponentially-weighted moving variance with a bounded effective window; state the chosen half-life explicitly.

#### M21 — Truncated rollout tail is treated as terminal (bootstrap value = 0), biasing value targets

**Location:** `training/rollout.py:78-96`

**Resolved 2026-07-27.** `RolloutBuffer` now excludes each incomplete live chain tail from
the training batch and uses its stored value to bootstrap the preceding same-seat transition.
Terminal tails remain trainable with zero bootstrap. The original finding follows for
historical context.

`compute_gae` has no bootstrap-value input. On the reverse pass, the first time each `(env_idx, seat)` key is seen (which is that chain's LAST transition in forward time) `last_done.get(key, True)` defaults to True, forcing `next_nonterminal=0` and `next_value=0` (`rollout.py:96`). This is correct for transitions that actually carry `done=True`, but the code cannot distinguish a game-over terminal from a rollout-window truncation: when the fixed-size window closes mid-game (the common case, since games are variable-length and rarely align to the step budget), the last stored transition of every live `(env,seat)` chain is bootstrapped from 0 instead of from `V(next_obs)`. Its return (`returns = advantages + values`) collapses to just its own reward and its advantage to `r - V`, so both the advantage estimate and the critic's regression target for that transition are biased. No collection function (`collect_rollout`, `collect_rollout_vec`, `collect_self_play_rollout_vec`) computes a bootstrap value for the post-window observation; each starts from a fresh `vec_env.reset()`. This is a genuine deviation from standard PPO/GAE, but scoped: it zeroes ~`num_envs × learner_seats` tail transitions per rollout (order ~1% of the buffer), so it degrades rather than corrupts. **Better:** capture the value of the final `next_obs` per live `(env,seat)` at window close (one extra critic/actor forward on the last obs) and seed `last_value`/`last_done` from it for non-done tails; at minimum, document that this systematically zeroes the tail transitions and quantify the bias.

---

### LOW

- **L1 — Scripts import a private helper from `training.trainer`.** `bc_then_rl.py:51` imports `_apply_signal_honesty_coef` (underscore-private) and `signal_honesty_schedule` (defined at `trainer.py:43-68`) — an inverted dependency and a direct symptom of the missing shared engine (H1). **Better:** move the schedule and env-coefficient application into a shared module with public names when extracting the engine.
- **L2 — `network.py` carries V1–V4 but only V4 ships, and `create_network`'s silent V2 fallback is a footgun.** Versions 1/3/4 have explicit branches; V2 is the unguarded `else` (`network.py:204-209`), so any unrecognized/misspelled version silently builds a V2 net (the hazard `checkpoint.py:70` warns about). **Better:** make `create_network` raise on an unknown version; mark or archive unused architectures — but confirm no committed checkpoint (facile loads `runB_bc.pt`) needs V1/V2/V3 before removing, and flag for the owner.
- **L3 — Cumulative-score encoding is coarse; round index saturates at 10.** `observation.py:222-224` clips scores to 1.0; `:217` caps `round_idx` at 9. **Correction:** the clip's stated consequence is overstated — norm reaches 1.0 exactly at game-over, so the decision region up to the win threshold is preserved and only post-win overshoot is discarded (irrelevant, the game has ended). The genuine (minor) loss is the round-cap: 41-point serving games routinely run past round 10, collapsing late rounds into one slot. **Better:** widen or continuous-encode the round index; encode scores seat-relative.
- **L4 — Redundant card features inflate the observation and are triple-fed into V4.** `my_hand` (40 floats) is fully redundant with `STATUS_MINE`; current-trick cards appear in both `card_status` and the 160-slot block; V4 re-feeds `my_hand` as its own channel (`network.py:349-357`). Harmless for correctness; encoding debt worth noting for a lean-transformer restructure. **Better:** pick one canonical source per fact and re-benchmark.
- **L5 — `encode_observation` makes three passes over trick history per env step.** `card_status`, `_compute_void_mask`, and `_compute_signal_mask` each loop `tricks_played` separately (`observation.py:171,102,135`), on every step of 64 vec envs. Not a correctness issue; the network forward pass dominates wall-clock. **Better:** fold into a single pass only if a profiler shows it matters.
- **L6 — Elo ladder solver is an ad-hoc order-dependent fixed point, not a Bradley-Terry fit.** 20 in-place sequential Elo updates in dict order (`arena.py:156-161`) with no convergence check; all pairings share one 100-game/side block, so precision is bounded by the block, not by iterations. Acceptable for coarse ranking; **better:** fit logistic/Bradley-Terry ratings (order-independent) or document it as a coarse ordinal ranking.
- **L7 — Dead/loosely-wired Elo code and off-block final eval.** `EloTracker` is used only in tests (implying an over-training Elo story that is never produced) and `update_from_winrate` floors wins via `int()` (`elo.py:39`); `trainer.py:428`'s final eval is vs-random at `seed=99999` (off the frozen block) and near-saturated, yet it is the run's terminal headline. **Better:** wire `EloTracker` in or remove it; make the final summary evaluate `best.pt` vs heuristic (and PIMC) on the frozen block with a CI.
- **L8 — The 409 legality gate is opt-in and silently self-disables if the field is omitted.** `app.py:165` early-returns when `expected_legal_cards` is None or phase ≠ PLAY_CARD, and the backend types it optional; it also compares only `(suit,value)` sets, so no role/briscola-phase desync detection. The only caller always populates it for play_card, so this is hardening rather than a live defect. **Better:** make the legality set required for PLAY_CARD (422 if absent); consider extending to briscola phase and role agreement.
- **L9 — FastAPI concurrency: lazy caches and a shared model mutated across threadpool workers without a lock.** `_session`/`_agent_cache` have unlocked check-then-set (`app.py:54-62`, `tiers.py:119-121`) and PIMC calls `net.eval()` on the shared cached net per request; endpoints are plain `def` so they run in the anyio threadpool. Race is wasteful, not corrupting; `net.eval()` is idempotent. **Better:** warm the tier agents/session at startup or guard lazy init with a lock.
- **L10 — Dead PIMC config fields and a non-deterministic default reseed.** `PIMCConfig.rollout_depth_tricks` and `.discount` are never read (rollout is hard-bounded by `max_steps=80`), misrepresenting the tunable surface; `determinize()` falls back to `random.Random(id(clone) & 0xFFFFFFFF)` when `clone_seed` is None (unreachable today since PIMC always passes a seed, but a trap for the next caller). **Better:** remove the unused fields; make the default reseed deterministic or require `clone_seed`.
- **L11 — Documentation has drifted from code.** `README.md:26` says "~200 tests", `CLAUDE.md` says "292", actual is 267; `bc_then_rl.py`'s docstring describes Phase 1 as "V3 (factorized head)" on "~250k transitions" and defaults `--network-version` to 3, while real runs and the runbook use V4. **Better:** reconcile the test count to a single computed source (or drop the number) and update the recipe's self-description to reflect V4 as canonical.
- **L12 — OpponentPool snapshots are deep-copied and retained on the training device (GPU).** `add_policy` and the anchor constructor use `copy.deepcopy` on state_dicts (`self_play.py:29,33`); since `net.state_dict()` tensors are on `config.device` and `deepcopy` preserves device, up to `opponent_pool_size=10` (`config.py:64`) FIFO snapshots plus anchors sit in VRAM for the whole run. Negligible at current sizes (~290k V4 params) but scales with `pool_size × model_size` and would matter for the larger nets the code invites (`network.py:254` "bump d_model=256, layers=4 for GPU runs"). **Better:** move pooled snapshots to CPU on insertion and load back to device only when sampled — cheap insurance for the scale-up path.
- **L13 — `self_play_env.py` is dead relative to the production trainer and carries a vestigial always-zero reward path.** The trainer collects self-play via `collect_self_play_rollout_vec` (`dual_rollout.py`); `SelfPlayEnv` is imported only by tests. Within it, `_play_opponent_turns` initializes `extra_reward = 0.0` and never increments it (`self_play_env.py:79-90` — the comment says opponent-step rewards are deferred via `_pending_rewards`), yet it is returned and added at `step()`, so `reward += extra_reward` is always `+= 0.0`. A plausible-looking reward-accumulation mechanism that does nothing — a trap for a future reader who assumes it is the live self-play path. **Better:** mark it legacy/test-only (or remove it) and drop the vestigial `extra_reward` plumbing.
- **L14 — Dead/overloaded config knobs: `activation` is never read; `num_layers` drives two unrelated depths.** `config.activation` ('relu') is consumed nowhere — V2/V3 hardcode `nn.ReLU` and V4 hardcodes `gelu` (`network.py:299`), so the knob is inert and misleading. Separately, `config.num_layers` is overloaded: for V4 it is the transformer encoder-layer count (`network.py:199,303`), but the `CentralizedCritic` built in the same run reuses `config.num_layers` as its residual-block count (`trainer.py:102-105`), so one `--layers` value silently sets both the actor transformer depth and the critic MLP depth, which are unrelated. (Widths are independent — actor uses `d_model`, critic uses `hidden_size` — only depth is shared.) **Better:** remove the unused `activation` field (or thread it into construction); give the critic its own depth config so V4 runs can size it independently of the transformer.
- **L15 — KL early stop acts at epoch granularity, so a single epoch can overshoot `target_kl`.** The early-stop check runs only after a full epoch of minibatch updates completes (`ppo.py:117-120`); epoch 0 always runs fully and KL can climb across all ~8 minibatches before the brake is evaluated (`target_kl=0.02`, `config.py:42`). A defensible design choice, but it makes `target_kl` a coarse per-epoch guard rather than a tight per-update bound. **Better:** if tighter control is wanted, evaluate `approx_kl` per minibatch and break within the epoch (spinningup/CleanRL style). Low priority given `target_kl=0.02` and small batches.
- **L16 — "Terminal-dominated" reward characterization does not hold for full-length games.** The `env.py:6` docstring describes the reward design as "v3 — round-end shaping, terminal-dominated", but `_distribute_round_end` fires on every `round_end` with magnitude clipped to ±1 per seat (`env.py:206-217`) while `_distribute_game_terminal` delivers a single ±1.0 (`env.py:219-221`), and nothing scales the terminal by round count. For full `win_points=41` games (many rounds) cumulative same-sign round-end shaping exceeds the lone ±1 terminal, so "terminal-dominated" is inaccurate; even for default short `win_points=5` games the terminal is at best comparable, not dominant. Docstring-accuracy nit with no runtime effect. **Better:** reword to reflect that the terminal dominates only for short games, or scale the terminal magnitude with round count if terminal dominance is intended across all settings.
- **L17 — Per-termination backward scan is O(buffer) worst case across interleaved envs.** `_credit_terminal_residuals` walks the whole buffer backward from `ptr-1` for each terminated env (`rollout.py:163`), skipping other envs, until it locates each needed seat's last transition; the earliest-acting learner seat's last transition can be ~one game back = ~`game_length × num_envs` entries in the globally interleaved buffer, with per-iteration `int()` casts. Called once per terminated env per rollout — bounded and dominated by inference cost today, but O(steps_per_env × num_envs) per termination rather than local. **Better:** if profiling ever shows it on the hot path, maintain a per-`(env_idx, seat)` "last stored index" map updated in `store()` so residual crediting is O(1) per seat.
- **L18 — `RolloutBuffer.store` has no capacity guard.** `store()` writes at `self.ptr` and unconditionally increments it (`rollout.py:46-60`) with no check against `self.size` (stored at `:40` but never referenced in `store()`). Buffers are sized exactly today (`collect_rollout_vec`: `steps_per_env*num_envs`), so no overflow occurs, but any future mis-sizing surfaces as a raw `IndexError` deep in a numpy assignment rather than a clear error. **Better:** add an `assert self.ptr < self.size` (or a clear `ValueError`) at the top of `store()` to fail fast on mis-sizing.
- **L19 — Dead defensive branch for `current_seat == -1` under SAME_STEP autoreset.** The `dual_rollout.py:83-90` loop guards against `seats_np[i] == -1` when computing `acting_team`, but `create_vec_env` always uses `AutoresetMode.SAME_STEP` (`vec_env.py:44-46`), under which a terminated sub-env resets in-step and returns a valid seat 0–3; `env._terminal_obs` (`current_seat=-1`, `env.py:232-238`) is placed in `final_obs` and never surfaced as the next obs the loop consumes. The guard and its comment describe an unreachable state — harmless but misleading. **Better:** drop the `-1` branch (and comment), or assert seats are in `[0,4)` to document the invariant; keep the guard only if a non-SAME_STEP autoreset mode is ever intended.

---

## 5. Thematic Analysis

### 5.1 The training-pipeline restructuring question (three-loop duplication)

The single most consequential structural fact is that **three PPO driver loops re-implement the same body** (`trainer.py`, the shipping `bc_then_rl.py`, and the `train_and_plot.py` demo), and they have already drifted (H1). This caused the historical H3 RNG discrepancy; A0 fixed exact vector/RNG resume in the live training paths, but duplication still leaves M5, M7, M16, and future drift risks.

**What a consolidated architecture should own:** one parameterized PPO engine in `training/` that is the *sole* implementation of the loop, the LR/entropy schedules and their **resume horizon**, the eval cadence and **eval-seed policy**, `best.pt`/`last.pt` selection, RNG restore-on-resume, and the checkpoint-write policy. The three entry points become thin config-assembly front-ends differing only in setup (BC warm-start, plotting) and a single `TrainConfig`. Behavior differences that must persist (wandb on/off, curriculum on/off) become config flags, not forked code. Two invariants must move *into* the engine so they can never be re-decided per script: (1) resume reconstructs the network from the checkpoint's stamped `net_config` (H4), and (2) there is exactly one on-disk checkpoint format (H5). The engine consolidation and the checkpoint/config unification (M6) are the two changes that make an entire class of silent inequivalence structurally impossible.

**What the engine must not absorb blindly:** the frozen `EVAL_SEED_BASE` discipline, the leak-free reward-delivery + terminal-boundary machinery, and the `net.config` stamping are correct and must be carried forward verbatim.

### 5.2 Training-loop soundness (new dimension)

The core game engine and A1 reward-attribution/GAE machinery are now
well-tested, but the PPO *loop* still has independent open findings. The
centralized critic's gradients are never clipped (H2), the
`ReturnNormalizer` has the M19/M20 episode and curriculum concerns, and the
value clip may cap value fit (M17). M21's rollout-tail bias is resolved by
carrying bootstrap-only live tails across windows.

### 5.3 Observability

Observability is the weakest for the runs that matter most. The shipping recipe's only durable in-run artifact is a CSV whose eval columns are forward-filled (M7), there is no automated gate on any test or the parity fixtures (H10), and the selection metric is logged as a bare float with the CI tooling that exists never called (H7). The `watch_bots` behavioral audit — signal honesty and briscola quality, i.e. exactly what the recent work targeted — is a standalone CLI that never feeds the training log (H8). The result is that a checkpoint can be selected as "best" while signalling at chance, and the headline number is quoted with no interval and no held-out confirmation. Restoring observability is cheap relative to its leverage: CI, W&B/artifact persistence for GPU runs, CIs on the selection metric, and folding the ancillary behavioral metrics into the per-checkpoint log.

### 5.4 Evaluation rigor

The evaluation stack has good bones — a frozen deal block, a correct Wilson helper, a properly mirrored Elo ladder — but the numbers that drive decisions come from its weakest part. The compounding issues: selection is winner's-curse-biased and never re-checked on a held-out block (H7); the sole yardstick is the deterministic BC teacher, so win rate partly measures divergence-from-BC and exploitation of a memorizable opponent rather than general strength (H8); no PIMC ceiling number backs the "plateau is structural" claim (H8); the selection eval uses un-mirrored disjoint deals while the ladder in the same module mirrors correctly (M8); the curriculum advancement gate is measured at the wrong game length (M15); and train/eval deal disjointness is an accident of a large constant rather than an enforced invariant (M9). The through-line: **the frozen-seed design is right and must be protected; everything built on top of it needs a CI, a mirror, a held-out block, a gate measured at the training length, and at least one non-self-referential opponent.**

---

## 6. Prioritized Roadmap

Ordered by leverage against risk. Effort: S ≈ hours–1 day, M ≈ several days, L ≈ 1–2+ weeks. Recommendations only.

1. **CI gate (S) — do first.** Run `ruff`, the full pytest suite, and the cross-repo parity-fixture assertion (plus a `gen_bot_fixtures` no-op check) on every push. *Fixes H10.* Rationale: every other workstream is a refactor; without a gate, the refactor can silently break the RL math or the serving boundary. Highest leverage per hour.

2. **PPO/GAE training-soundness correctness (S–M).** Clip the critic's gradients together with the actor's (H2); pin the objective's loss direction, clip activation, and value-clip behavior with unit tests (H9); bootstrap the truncated rollout tail from `V(next_obs)` instead of zero (M21); and ablate/decouple value clipping from the policy `clip_eps` (M17). *Fixes H2, H9, M21; addresses M17.* Rationale: these are the live training-soundness defects on the shipped CTDE path; they and their tests must land before anyone restructures `ppo.py`/`rollout.py`, otherwise a sign flip or an unclipped critic ships green.

3. **Consolidate the three PPO loops into one parameterized engine (L) — the keystone.** *Fixes H1 and reduces recurrence risk after A0; dissolves M5, M6, M16, L1.* Rationale: root cause of the most findings; makes drift structurally impossible rather than discouraged. Sequence after (1)–(2) so the new engine is guarded by tests and CI.

4. **Unify checkpoint I/O and resume-from-`net_config` (M).** One writer (`save_checkpoint`), one on-disk format, resume reconstructs the net and structural flags from the stamped config, and persist the original schedule horizon so resume is continuous. *Fixes H4, H5, M16; enables deleting the `net_config_of` shim and L2's silent-V2 risk.* Rationale: eliminates the silent-critic-drop, wrong-architecture-load, and schedule-discontinuity classes of bugs; naturally folds into (3).

5. **Evaluation rigor pass (M).** CI on the selection metric, `best.pt` re-eval on a held-out frozen block, mirror the deals in the two eval functions, gate curriculum advancement at the stage's own `win_points`, add a periodic PIMC eval to bound the ceiling, and log per-role/side + signal-honesty/briscola + per-class BC accuracy per checkpoint. *Fixes H7, H8, M8, M15, M18; substantiates the "plateau is structural" claim.* Rationale: makes shipped numbers honest and gives selection more than one self-referential signal.

6. **A2 observation redesign — implementation complete, promotion open (M–L).** Captured points, trick counts, and caller identity are now appended to actor and critic inputs, and fixtures are regenerated. H6 and M3 are implemented; M2's broader seat-frame inconsistency remains. Run the fixed-budget three-seed ablation before promotion.

7. **Serving cleanup (M).** Decide and implement `esperto`'s signal policy (either make PIMC signal-aware or collapse the tied action set and document no-signal), pick one inference stack (`/act`+torch or ONNX+parity test), decide the temperature policy, add 422 validation + hand-size conservation to the adapter, and make the legality gate required for PLAY_CARD. *Fixes H11, M10, M11, M12; addresses L8, L9, L10.* Rationale: H11 is a live behavioral regression on the flagship tier; the rest reduce the serving surface before a restructure.

8. **Observability persistence for GPU runs (S).** Wire `--wandb-*` into `bc_then_rl` (default on for GPU) or stream metrics+best.pt to durable storage; mark forward-filled CSV rows. *Fixes M7.* Rationale: cheap, and it makes future runs auditable without relying on manual `kaggle pull`.

9. **Coverage and hygiene cleanup (S).** Expand parity fixtures (void-deduction, score-clip, cricca), add Kaggle-kernel decision-logic tests, unify or delete the curriculum module and enforce (or delete) its `max_steps` valve, reset/decay the return normalizer on curriculum advance and fix its per-seat reset, reconcile the drifted docs, and address the remaining lows opportunistically. *Fixes M4, M13, M14, M20; addresses L5–L7, L11, L12–L19.* Rationale: closes the residual silent-divergence windows and illusory-coverage traps once the larger refactors land.

---

## 7. Unresolved Questions

Every finding produced across all six review dimensions resolved to **CONFIRMED** or **REFUTED** under adversarial verification — none remained UNCERTAIN, so there are no open verdicts to escalate. (One finding, "the `/act` endpoint has zero endpoint-level tests," was **refuted**: `tests/test_act_endpoint.py` posts to `/act` across wrong-seat 409, unknown-tier 422, malformed-state 422, the legality gate, briscola phase, and temperature bounds — it is dropped from this document.)

Three empirical questions are *created by* the confirmed findings and should gate their respective workstreams rather than being taken on faith:

- **Does A2 improve value estimation or playing strength? (promotion gate.)** The 470-feature implementation exists, but no three-seed result does. Compare fixed-budget 462-prefix and 470-feature runs across three seeds using held-out explained variance and paired playing strength; promote only with improvement and no slice regression.
- **Where is the model-free ceiling relative to PIMC? (settles the "plateau is structural" claim underlying H8.)** Experiment: run the existing `esperto` PIMC agent against the same frozen block used for heuristic eval and report the win rate with a Wilson CI, then compare `best.pt` (`forte`) against PIMC head-to-head. A large PIMC>forte gap bounds how much headroom remains inside model-free training versus what only inference-time search can recover.
- **Does the shared policy/value clip materially cap the value fit? (settles the harm magnitude of M17.)** Experiment: train with `clip_range_vf=None` (or a decoupled value clip) versus the current `clip_eps=0.2` on the same frozen block and compare `explained_variance`. Given ~0.60 is the stated bottleneck and CTDE was added specifically to raise it, an over-tight value clip is a plausible contributor worth ruling out before concluding the plateau is structural — and this ablation should run alongside the H2 critic-gradient fix, since both touch the same value-fit path.
