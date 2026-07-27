# Training Runbook

How to run a training run for BECCA end to end, and how to tell whether the result
is any good. Written to be followed without prior context.

**Read this first if you are about to launch a GPU run.** The expensive mistakes in
this project have not been bad hyperparameters — they have been measuring the wrong
number, or shipping the wrong checkpoint file. §5 and §6 exist because of specific
past incidents, each named.

---

## 1. What the bot already knows, and what it doesn't

**Rules are not learned and cannot be broken.** `becca_env/game.py` enforces every
rule; `encode_action_mask` only ever exposes legal moves, and `game.step` raises on
anything else. Follow-suit, trick resolution, and scoring are engine invariants,
mirrored by the TypeScript backend and pinned by `tests/test_rules.py`. So "the bot
must learn the rules properly" is already true by construction — there is no
rule-learning failure mode to train away.

What is genuinely learned is *judgement*: which briscola to call, which card to
play, and — since Run C — what to say with a signal.

## 2. The pipeline

```
Phase 1  BC   collect heuristic self-play games -> masked cross-entropy on the policy
Phase 2  RL   PPO self-play from that warm start, with a CTDE critic + opponent pool
```

Both phases live in `scripts/bc_then_rl.py` (the recipe used for every real run).
`training/trainer.py` is the pure-PPO trainer; it shares the same schedules,
checkpoint format, and eval harness.

Why BC first: PPO from random init plateaus far below the heuristic. BC gets the
policy to "competent imitation" in minutes, and RL improves from there
(Run B: BC 28.5% -> RL 71% vs heuristic, +246 Elo).

Why a centralized critic: the value head is blind to the three hidden hands, which
pinned `explained_variance` at ~0.30 for entire runs. The CTDE critic sees the full
state at train time only (`FULL_STATE_SIZE = 582`); the policy never does, so
serving is unaffected. This is what broke the EV ceiling (0.30 -> 0.60 in Run B).

Why an opponent pool with anchors: pure latest-vs-latest self-play collapses toward
near-copies of itself. The pool keeps historical snapshots, and a permanent BC
anchor stays reachable so the policy cannot drift into a private equilibrium.

## 3. The signal channel (what Run C adds)

The action space is 40 cards × 4 signal slots (none / striscio / busso / volo). The
score never depended on which signal slot was chosen, so that dimension received no
gradient at all. Measured on the shipped Run B checkpoint over 410 lead decisions,
the mean probability over `[none, striscio, busso, volo]` was
`[0.12, 0.26, 0.31, 0.30]` — near-uniform across the three signals. The bot was not
bluffing; nothing had ever told it what a signal means.

Two fixes, both in place:

- **The BC teacher now signals.** `HeuristicAgent` used to return `(card, None)`
  unconditionally — 0 signals in 210 leads — so BC left those slots at
  initialization. `HeuristicAgent(declare_signals=True)` declares the honest signal.
  It is **opt-in on purpose**: the same agent is the frozen eval yardstick, and
  changing its play would make every historical "% vs heuristic" incomparable. BC
  collection opts in; `evaluate_against_heuristic` does not.
- **Reward shaping grounds the slots.** `--signal-honesty-coef` pays ±coef when a
  seat *declares* a signal, judged by `becca_env/signals.py`. Silence is always
  free.

The asymmetry is the important part:

| the seat… | reward |
|---|---|
| declares an honest signal | +coef |
| declares a dishonest signal | −coef |
| stays silent | 0 |

This fixes what a signal *means* while leaving *whether to signal* to the round
score. Penalising silence would settle that strategy question by fiat.

`--signal-honesty-coef-final 0.0` anneals the term to zero over
`--signal-honesty-frac` of the run: teach the convention early, then let results
decide. If the policy ends up signalling less than the convention would, that is a
finding, not a bug — the second half of the run is scored purely on winning.

`becca_env/signals.py` is the single definition of the convention, because reward
shaping, the BC teacher, and the audit must all agree. Previously only the audit had
one, so it was possible to train against one rule and measure another.

**Pre-flight evidence that this works.** Measured locally on CPU before committing GPU
time, with BC alone — no RL and no reward shaping, so this isolates the teacher fix:

| config | BC accuracy | declared | honest |
|---|---|---|---|
| shipped Run B checkpoint | — | 741/840 leads | 28–45% (**≈chance**) |
| V4 d=128 L=3, 2000 games, 8 ep | 95.2% | 699/820 leads | **96%** |
| V4 d=128 L=3, 2000 games (repeat) | 95.4% | 685/800 leads | **97%** |
| V4 d=192 L=4, 4000 games (Run C arch) | 97.4% | 664/790 leads | **97%** |

The warm-start alone already fixes the channel, at Run C's exact architecture; the
annealed reward term is what keeps it grounded once RL starts moving the policy.

Note a *too-small* net (13k params, 30 games) stayed at a uniform 0.25 per slot and
43% honesty. If a smoke shows ≈chance honesty, check scale before suspecting the
mechanism — a smoke's BC phase is deliberately tiny.

**The engine still does not enforce honesty.** A dishonest signal is a legal move
and stays legal; bluffing is part of the game.

## 4. Launching a run

Kaggle runs are fully server-side — launch, close the laptop, check back later.

```bash
cd ai
python -m scripts.kaggle_run push-code -m "run C: signal shaping"
python -m scripts.kaggle_run configure          # GPU + internet + dataset attach

# ALWAYS smoke first (~5 min, free). Exercises the full recipe.
python -m scripts.kaggle_run launch --preset smoke
python -m scripts.kaggle_run status
python -m scripts.kaggle_run pull -p checkpoints/kaggle-smoke

# Only after the smoke passes §5:
python -m scripts.kaggle_run launch --preset runc --confirm-cost
```

`--confirm-cost` is required above 1M steps and exists so a multi-hour run is never
launched by accident.

`runc` is `runb` with exactly one hyperparameter changed (`signal_honesty_coef`
0.0 → 0.05). Network size, step budget, critic, and anchors are held fixed on
purpose: Run B plateaued around update 300 of 915, so more identical steps buy
nothing, and holding everything else constant is what makes the comparison against
Run B's ~71% interpretable.

Why 0.05: a round-end reward spans ±1, so an honest signal is worth ~1/20 of a
round's swing — small enough that farming honesty bonuses can never beat winning
points.

### Multi-session protocol

Set the final step target in session 1. Every resumed session must keep the same
run ID, `--total-rl-steps`, `--num-envs`, `--steps-per-env`, and training
hyperparameters; the checkpoint manifest enforces this contract.

```bash
# Session 1: set the final target once.
python -m scripts.kaggle_run launch --preset rund \
  --total-rl-steps 60000000 --confirm-cost

# After each capped session:
python -m scripts.kaggle_run status
python -m scripts.kaggle_run pull -p checkpoints/kaggle-rund
python -m scripts.kaggle_run push-state \
  --from checkpoints/kaggle-rund -m "runD session N"
python -m scripts.kaggle_run launch --preset rund \
  --total-rl-steps 60000000 --resume-state --confirm-cost
```

Resume rebuilds the policy and critic from the checkpoint stamps. Explicit
architecture flags are accepted only when they match. Resuming a completed target
is a hard error instead of a successful no-op. The state dataset carries
`last.pt`, the prior `best.pt`, and `metrics.csv`; the generated kernel validates
the run manifest before restoring them. Resume trims any CSV rows newer than the
checkpoint (hard-preemption recovery) and reports SPS for the new session only.

Only `--resume-state` attaches the state dataset and carries `metrics.csv`/
`best.pt` forward. An explicit `--resume <path>` renders a kernel with the code
dataset only — a hand-written `/kaggle/input/...` path will not exist there. Use
`--resume-state` for every Kaggle resume; explicit paths are for local runs.

Before spending the long-run quota, perform the same sequence with `--preset
smoke --max-hours 0.05`. Create the state dataset on the first drill with
`push-state --create`; subsequent pushes version it without `--create`.
Run D remains blocked until that real dataset round-trip passes.

The first smoke session prints an end-to-end Run D rollout sweep for 8, 16, 32,
and 64 workers, including actor/opponent inference, the centralized critic,
encoding, IPC, and buffer storage. Select the highest env-SPS count before
Run D session 1 and adjust `steps_per_env` so the batch remains 32,768. Freeze
both values for every resume session; changing either one invalidates the
checkpoint's resume contract.

## 5. Verifying a smoke run before spending hours

A smoke is only useful if you check it. Confirm all five:

1. **It used the GPU.** Look for `device='cuda'` and a throughput around
   ~700–800 sps (Run C measured ~760). A silent CPU fallback shows up as ~34 sps.
   (Kaggle's default GPU is a P100 whose arch current stock torch dropped; the
   tool pins a T4 for this reason.)
2. **BC accuracy is sane** — roughly 60–95% on heuristic actions.
3. **`best.pt` exists** and its `best_update` is > 0.
4. **Signal shaping was active** — the rendered flags include
   `--signal-honesty-coef 0.05`.
5. **No crash in the last 20 log lines.**

## 6. Reading the results honestly

Two traps, both of which produced wrong conclusions on Run B:

**The final CSV row is not an eval of the shipped weights.** Eval runs every
`eval_every` updates; the rows after the last eval carry the previous value
forward. Run B's last row read 74.5% while the real number was ~71%. **Always score
the checkpoint file directly:**

```bash
# Final best.pt vs last.pt decision on 1,000 mirrored deals
# (2,000 games per checkpoint, wp=41).
python -m scripts.score_checkpoints \
  checkpoints/best.pt checkpoints/last.pt --games 1000

# Optional cross-checkpoint head-to-head ranking.
python -m scripts.elo_ladder <ckpt>... --num-games 100
```

The scoring command preserves each mirrored deal pair, prints pairing-aware 95%
intervals, and emits `ship` only when the leader's paired difference interval
clears zero. An `inconclusive` result means retain the current shipped model or
collect more held-out deals. `best.pt` is only a candidate selected on the noisy
frozen training-eval block.

**The `steps` column counts learner-team transitions, not env steps.** A team owns
2 of 4 seats, so only ~half of each batch is stored: the log shows ~15M while ~30M
env steps were simulated. The `sps` column is simulated env steps per second so it
matches the cost model. This 2× gap is units, not a bug.

Then audit behaviour, which win rate cannot show:

```bash
python -m scripts.watch_bots --tier forte --games 20          # briscola + signals
python -m scripts.watch_bots --tier forte --games 1 --trace   # move by move
```

Prefer `best.pt` over `final.pt` when it scores higher. Self-play is non-monotone
and, before Run C, only the final weights were kept — Run B's peak was around
update 300 of 915 and was unrecoverable.

## 7. Run C — results (completed 2026-07-26)

Kaggle T4, all 915 updates, GPU confirmed (~780 sps). BC: 246k samples, 97.4%
accuracy. Every number below was scored on the checkpoint FILE (per §6), 400 games
at wp=41, Wilson CIs; "held-out" is a deal block far from both the frozen eval
block and training seeds.

| Checkpoint | frozen block | held-out block |
|---|---|---|
| Run B final (baseline) | 71.8% [67.1, 75.9] | 71.0% [66.4, 75.2] |
| **Run C final (upd 915)** | **83.0% [79.0, 86.4]** | **81.8% [77.7, 85.2]** |
| Run C best.pt (upd 450) | 80.2% [76.1, 83.9] | 76.0% [71.6, 79.9] |

For scale: PIMC (`esperto`, 10 determinizations, heuristic rollouts) scores
**90.0% [82.6, 94.5]** on the same frozen block (100 games) — Run C's model-free
policy has nearly closed the gap to inference-time search, which revises the old
"the plateau is structural, only search gets past it" claim: better BC + a grounded
signal channel moved the model-free ceiling itself.

**Strength: +11 points over Run B, CIs non-overlapping, holds on unseen deals.**
Two honest observations the numbers force:
- The best.pt-selection eval (83.5% at 100–200 games) overstated update 450; on the
  held-out block the FINAL weights beat "best" (81.8% vs 76.0%). Exactly the
  winner's-curse behaviour SYSTEM_ANALYSIS H7 predicts — ship `runC_rl.pt`, and
  treat best.pt as a candidate to re-score, never as automatically superior.
- Run C also learned faster: it passed Run B's ~71% by update ~100.

**Signal honesty followed the anneal, then decayed** (20 games ≈ 1300 leads each):

| Checkpoint | declared | honest |
|---|---|---|
| BC warm-start (`runC_bc.pt`) | 85% of leads | **98%** |
| best.pt (upd 450, anneal just ended) | 94% | 52% |
| final (upd 915, coef=0 for half the run) | 89% | 43% |

So the convention WAS learned (98% post-BC), and once the honesty term annealed to
zero the policy drifted back toward arbitrary signals — while getting STRONGER.
A masked-signal ablation on the final weights (zeroing the signal-mask features)
moved the win rate 83.0% → 80.8% (CIs overlap): the signal channel carries little
measurable team value for this policy against a non-signalling opponent. Fair
conclusion: honesty-as-convention does not survive on score gradient alone; if the
product wants honest bots, hold the coefficient at a small non-zero floor
(`--signal-honesty-coef-final 0.02` or so) instead of annealing to zero — the +11pt
strength gain came from the better BC (97.4% vs ~93%) and the extra grounded
channel early, not from late-run dishonesty.

## 7b. What success looked like (the pre-run targets)

| Metric | Run B | target | Run C actual |
|---|---|---|---|
| vs heuristic (wp=41) | ~71% | ≥ 71% | **81.8–83.0%** ✅ |
| explained variance | 0.60 | ≥ 0.55 | 0.66 ✅ |
| signal honesty | ≈chance | > 80% declared | 98% post-BC, 43% final ⚠️ |
| signal usage | arbitrary | any, if honest | 89%, drifting ⚠️ |

The honesty target was met while the term was active and lost when it reached
zero — a finding about the anneal schedule, not the mechanism.

## 8. Known limitations

- **The plateau is structural.** Model-free PPO for 4-player imperfect-information
  card games tops out well below strong human play; this is consistent across the
  Skat / Schnapsen / Briscola literature. Beyond ~71%, the real lever is search at
  inference (PIMC, already implemented in `inference/` and served as the `esperto`
  tier), not more steps. See the plateau analysis in this repo's history.
- **Honesty is a convention we chose**, encoded in `becca_env/signals.py`. Real
  Beccaccino conventions vary by region, and expert play includes deliberate
  deception. This grounds a *baseline* meaning so signals are teachable; the
  annealed term then lets the policy deviate when deviating scores better.
