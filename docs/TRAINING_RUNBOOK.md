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
time — BC alone (no RL, no reward shaping), V4 d=128/3-layer, 2000 teacher games,
8 epochs:

| | BC accuracy | declared | honest |
|---|---|---|---|
| shipped Run B checkpoint | — | 741/840 leads | 28–45% (≈chance) |
| BC with a signalling teacher | 95.2% | 699/820 leads | **674/699 = 96%** |

So the warm-start alone already fixes the channel; the annealed reward term is what
keeps it grounded once RL starts moving the policy. Note a smaller net (13k params,
30 games) stayed at a uniform 0.25 per slot — if a smoke shows ~chance honesty, check
scale before suspecting the mechanism.

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

Resuming across Kaggle's 12h session cap:

```bash
python -m scripts.kaggle_run launch --preset runc --confirm-cost \
  --resume /kaggle/input/<dataset>/checkpoints/last.pt
```

⚠️ Resume rebuilds the network from **CLI flags, not the checkpoint**, so a resume
must repeat the architecture flags exactly or it crashes (or silently drops the
critic). The presets already carry them; hand-rolled resumes are the risk.

## 5. Verifying a smoke run before spending hours

A smoke is only useful if you check it. Confirm all five:

1. **It used the GPU.** Look for `device='cuda'` and a throughput around
   ~700–1150 sps. A silent CPU fallback shows up as ~34 sps. (Kaggle's default GPU
   is a P100 whose arch current stock torch dropped; the tool pins a T4 for this
   reason.)
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
python -m evaluation.arena --help          # or use evaluate_against_heuristic
python -m scripts.elo_ladder <ckpt>...     # cross-checkpoint ranking
```

**The `steps` column counts learner-team transitions, not env steps.** A team owns
2 of 4 seats, so only ~half of each batch is stored: the log shows ~15M while ~30M
env steps were simulated. This 2× gap is units, not a bug.

Then audit behaviour, which win rate cannot show:

```bash
python -m scripts.watch_bots --tier forte --games 20          # briscola + signals
python -m scripts.watch_bots --tier forte --games 1 --trace   # move by move
```

Prefer `best.pt` over `final.pt` when it scores higher. Self-play is non-monotone
and, before Run C, only the final weights were kept — Run B's peak was around
update 300 of 915 and was unrecoverable.

## 7. What success looks like for Run C

| Metric | Run B | Run C target | How to check |
|---|---|---|---|
| vs heuristic (wp=41) | ~71% | ≥ 71% (must not regress) | score `best.pt` directly |
| explained variance | 0.60 | ≥ 0.55 | metrics.csv |
| signal honesty | 28–45% (≈chance) | **> 80% on declared signals** | `watch_bots` |
| signal usage | 88% of leads, arbitrary | any rate, as long as honest | `watch_bots` |

The headline question is honesty, not usage rate. A policy that signals on 30% of
leads and is honest 90% of the time is a *better* result than one that signals
always — it means the shaping taught the convention and the score then decided when
the convention is worth invoking.

**Strength must not regress.** If vs-heuristic drops materially below Run B, the
shaping is distorting play and the coefficient is too high.

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
- **`last.pt`'s `train_config` records the wrong architecture** for provenance
  (the accurate one is in `net_config`). Cosmetic, but do not trust that field.
