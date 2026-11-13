# Experiment Ledger

Append-only record of completed training runs, ablations, and operational
drills. Current procedures are in [TRAINING_RUNBOOK.md](TRAINING_RUNBOOK.md);
binding promotion rules are in
[EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md).

Implementation work is not experimental evidence. The A0-A12 refactor added
correctness tests and protocols, but did not rerun the strength gates unless an
entry below says otherwise.

## Artifact Policy

Kaggle pulls are ignored by Git and may exist only in the local checkout. The
retained checkpoint, metric, log, and plot hashes are recorded in
[experiments/legacy-kaggle-artifacts.sha256](experiments/legacy-kaggle-artifacts.sha256).
Copied `ai/` source trees were removed from those pulls after this manifest was
written; the source commits remain in Git.

Historical summary-only evaluations below predate the current persisted
`score.jsonl` protocol. They are useful context, but cannot promote a new
champion under the current gate without rerunning on a fresh block.

## Run A - 2026-05-31

Purpose: establish the first V4 behavioral-cloning plus PPO baseline before
signals and the centralized critic were added.

| Field | Result |
|---|---|
| PPO | 76 updates, 2,490,341 learner transitions |
| Final logged EV | 0.2784 |
| Final monitoring score | 95% vs random, 60% vs heuristic at `win_points=41` |
| Status | completed historical baseline |

Artifacts:

- `checkpoints/kaggle/v4_runA_bc.pt`
- `checkpoints/kaggle/v4_runA_rl.pt`
- `checkpoints/kaggle/metrics.csv`

These monitoring scores have no retained per-deal outcomes or confidence
intervals and predate the current observation and evaluation contracts. They
are historical context only.

## Run B - 2026-07-25

Purpose: first full V4 BC plus PPO run with a centralized critic and permanent
BC anchor.

| Field | Result |
|---|---|
| BC data | 6,000 games, 246,000 actions |
| BC accuracy | 96.8% |
| PPO | 915 updates, 14,992,143 learner transitions |
| Final logged EV | 0.5959 |
| Direct historical score vs heuristic | about 71%; 566/800, Wilson 67.5%-73.8% |
| Status | completed historical baseline |

Artifacts:

- `checkpoints/kaggle-runb/checkpoints/runB_bc.pt`
- `checkpoints/kaggle-runb/checkpoints/runB_rl.pt`
- `checkpoints/kaggle-runb/runs/runB/metrics.csv`
- `checkpoints/kaggle-runb/becca-training-cli.log`

The CSV's final 74.5% heuristic value was forward-filled from the last scheduled
evaluation and was not a score of final weights.

## Run C - 2026-07-26

Purpose: hold Run B architecture and budget fixed while adding an honest-signal
BC teacher and annealed signal-honesty shaping.

| Field | Result |
|---|---|
| BC data | 6,000 games, 246,000 actions |
| BC accuracy | 97.4% |
| PPO | 915 updates, 14,992,198 learner transitions |
| Final logged EV | 0.6142 |
| Final vs heuristic, frozen block | 83.0% [79.0%, 86.4%], 400 games |
| Final vs heuristic, held-out block | 81.8% [77.7%, 85.2%], 400 games |
| best.pt held-out | 76.0% [71.6%, 79.9%], 400 games |
| Status | completed; final historically selected over best.pt |

Artifacts:

- `checkpoints/kaggle-runc/checkpoints/runC_bc.pt`
- `checkpoints/kaggle-runc/checkpoints/runC_rl.pt`
- `checkpoints/kaggle-runc/checkpoints/best.pt`
- `checkpoints/kaggle-runc/runs/runC/metrics.csv`
- `checkpoints/kaggle-runc/becca-training-cli.log`

Signal audit:

| Checkpoint | Declared | Honest |
|---|---:|---:|
| BC warm start | 85% of leads | 98% |
| best.pt, update 450 | 94% | 52% |
| final, update 915 | 89% | 43% |

The convention was learned while supervised/shaped and decayed after the
coefficient reached zero, while playing strength continued to improve. A
masked-signal summary moved 83.0% to 80.8% with overlapping intervals.

Historical PIMC on the Run C network scored 90.0% [82.6%, 94.5%] over 100 games
against the heuristic. This predates the repaired A6 search contract and is not
the current PIMC promotion experiment.

## Kaggle Resume Drill - 2026-07-28

Purpose: prove stop, pull, state-dataset push, and resume across two real Kaggle
sessions.

| Session | Evidence |
|---|---|
| 1 | stopped at update 28, 114,686 learner transitions |
| 2 | loaded state dataset, resumed at update 29, stopped at update 56 and 229,403 transitions |
| Result | historical dataset round-trip succeeded |

Artifacts:

- `checkpoints/kaggle-drill/checkpoints/last.pt`
- `checkpoints/kaggle-drill/runs/smoke/metrics.csv`
- `checkpoints/kaggle-drill2/checkpoints/last.pt`
- `checkpoints/kaggle-drill2/runs/smoke/metrics.csv`
- both `becca-training-cli.log` files

This drill predates format-3 provenance, atomic generations, hash sidecars, and
exact vector rollout state. It must not be cited as proof of the current A8
bundle; the current-format drill in the runbook remains required.

## Run D - 2026-07-28

Purpose: 60M-step mixed `win_points=5,41` training using the pre-A0-A8 pipeline.

| Field | Result |
|---|---|
| Last update | 1,579 |
| Learner transitions | 25,871,953 |
| Logged EV | 0.6745 |
| Logged heuristic value | 82.5%, forward-filled monitoring value |
| Status | incomplete and retired |

Artifacts:

- `checkpoints/kaggle-rund/checkpoints/runD_bc.pt`
- `checkpoints/kaggle-rund/checkpoints/best.pt`
- `checkpoints/kaggle-rund/checkpoints/last.pt`
- `checkpoints/kaggle-rund/runs/runD/metrics.csv`
- `checkpoints/kaggle-rund/becca-training-cli.log`

The audit's best-versus-last score was inconclusive and no current-format
per-deal result was retained. Run D must not resume; the `rund` preset fails
closed. Run D2 is a fresh run identity.

## Run D2 - 2026-08-25

Purpose: rerun the 60M-step mixed `win_points=5,41` recipe from a fresh
post-A0-A12 identity, then select a checkpoint and compare it directly with the
deployed Run C policy on predeclared held-out deals.

| Field | Result |
|---|---|
| Source | `22cd0dc6720733c8862074117cb8e699f6a32bbc`, clean tree |
| Recipe | V4 `192/6/4/384`, CTDE critic, BC anchor, signal shaping `0.05 -> 0`, 64 envs x 512 steps |
| BC data | 6,000 games, 246,000 actions, 97.9% final accuracy |
| PPO | 1,831 updates, 29,999,925 learner transitions, 59,998,208 environment steps |
| Resume | session 2 resumed at update 1,432; all 1,431 prior metric rows were preserved |
| Final training state | 841,256 games; EV 0.6996 at update 1,831 |
| Final vs monitoring-best | 50.50% [48.89%, 52.11%], 1,000 mirrored deals; retained `best.pt` from update 1,200 |
| Selected Run D2 vs Run C | 62.90% [61.15%, 64.65%], 1,000 mirrored deals; promote |
| Status | seed-0 champion gate passed; NearPerfect-v1 remains unproven |

Selected checkpoint:

- `checkpoints/kaggle-rund2-session2/checkpoints/best.pt`
- SHA-256: `2d281bf0d1150c7629c33360c840b5c3e051599c2a977801a29d8eac79407775`

Evaluation artifacts:

- `runs/runD2-final-vs-best-20260825/score.jsonl`
  (`c0dbe3edf765b082e9722faa9b0e06fac3568d2895ae2f66775c703c89fff3c9`)
- `runs/runD2-winner-vs-runC-20260825/score.jsonl`
  (`d11072c9cac30e43c5a15d1a160f6fd9b5d6e1f36ade5a5e5161d2357f0e5f4a`)

The two gates used disjoint seed blocks frozen before the final checkpoint was
read. The 95% heuristic monitoring peak was not used as promotion evidence.
The next training step is two exact-recipe replications with distinct seeds;
do not extend seed 0 or tune the recipe before replication.

## Open Experiments

These gates are defined but unrun:

| Experiment | Required decision evidence |
|---|---|
| Run D2 replication | seed 0 completed; repeat the frozen recipe with seeds 1 and 2 |
| 518-feature observation | three seeds, fixed budget, paired strength or EV improvement, no slice regression |
| Card-conditioned signal head | targeted response improvement, no card-only or paired-strength regression |
| Repaired PIMC | at least +2 points and positive paired lower bound; CPU p95 below 1s and max below 5s |
| Search teacher | equal-size heuristic BC versus PIMC BC, rare-action accuracy and paired post-BC strength |
| Reward shaping | terminal-only versus shaped, one factor at a time |
| Value clipping | `clip_range_vf=None` or a decoupled value clip versus the current shared `clip_eps=0.2`, comparing held-out EV and paired strength |
| Capacity | only after data, observation, evaluation, and search gates |
| NearPerfect-v1 | every gate and artifact in the evaluation protocol |

## Adding An Entry

Append a dated section. Record:

1. immutable run/protocol identity and source commit;
2. exact configuration and changed factor;
3. checkpoint and dataset hashes;
4. seed blocks and sample counts;
5. persisted metric/per-deal artifact paths;
6. confidence intervals and predeclared decision;
7. failures, inconclusive results, and deviations.

Do not rewrite an old result when a protocol changes. Add a new entry explaining
why the old evidence no longer satisfies the current gate.
