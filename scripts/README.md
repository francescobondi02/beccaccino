# scripts

## Overview

Operator command-line entry points for the `ai/` package, run as modules from
`ai/` (for example `python -m scripts.train`). They train policies, score and
promote checkpoints, export serving artifacts, regenerate cross-language
fixtures, drive Kaggle GPU runs, benchmark throughput, audit bot behavior,
and generate expert-annotation scenario batches. Scripts are thin adapters
over [`../training/README.md`](../training/README.md),
[`../evaluation/README.md`](../evaluation/README.md),
[`../serving/README.md`](../serving/README.md) and
[`../becca_env/README.md`](../becca_env/README.md). Kaggle operator notes live
in [`./kaggle_setup.md`](./kaggle_setup.md).

## Interface

- `train.py`: pure-PPO CLI; `build_parser`, `config_from_args`, `main`
  (`[train.py:config_from_args]`).
- `bc_then_rl.py`: behavioral cloning warm-start then PPO via `run_ppo`;
  `parse_args`, `phase1_bc`, `phase2_rl`, `train_config_from_args`,
  `make_net`, `plot_results`, `main`, `RESUME_CONTRACT_FORMAT = 1`
  (`[bc_then_rl.py:phase2_rl]`). Path defaults: `--out-dir runs/bc_rl`,
  `--bc-ckpt checkpoints/bc_initial.pt`, `--final-ckpt
  checkpoints/bc_rl_final.pt`; there is no `--ckpt-dir`
  (`[bc_then_rl.py:parse_args]`).
- `score_checkpoints.py`: mirrored held-out scoring against the heuristic and
  direct champion selection; `CheckpointScore`, `evaluate_mirrored`,
  `score_checkpoints`, `select_champion`, `verdict`, `format_score`,
  `paired_difference_interval`, `parse_args`, `DEFAULT_GAMES = 1_000`
  (`--games`, mirrored deals per checkpoint), `WIN_POINTS = 41`,
  `HELDOUT_SEED_BASE = EVAL_SEED_BASE + 1_000_000`; `--output` defaults to
  `score.jsonl` (`[score_checkpoints.py:select_champion]`,
  `[score_checkpoints.py:parse_args]`).
- `elo_ladder.py`: round-robin Elo over checkpoints (`[elo_ladder.py:main]`).
- `check_near_perfect.py`: validates a NearPerfect-v1 evidence JSON; exits 0
  only on pass (`[check_near_perfect.py:main]`).
- `export_inference_artifact.py`: strips a training checkpoint into a serving
  artifact; defaults `DEFAULT_OUTPUT = serving/models/run_d2_champion.pt` and
  `DEFAULT_SELECTION_PROTOCOL = "runD2-winner-vs-runC-20260825"`
  (`--selection-protocol`) (`[export_inference_artifact.py:main]`).
- `gen_bot_fixtures.py`: writes `serving/fixtures/bot_states.json`;
  `build_cases`, `FIXTURE_PATH`, `SEED = 7` (`[gen_bot_fixtures.py:build_cases]`).
- `kaggle_run.py`: Kaggle CLI driver with verbs `push-code`, `push-state`,
  `configure`, `launch`, `status`, `pull`; `RunSpec` (`to_cli_args`), presets
  `SMOKE_SPEC`, `RUN_B_SPEC`, `RUN_C_SPEC`, `RUN_D2_SPEC`,
  `HISTORICAL_RUN_D_SPEC`, `render_kernel_script`, `est_hours`
  (`[kaggle_run.py:build_parser]`).
  - Account and slugs: `KAGGLE_USER = "fbondi"`, `DATASET_SLUG`,
    `STATE_DATASET_SLUG`, `KERNEL_SLUG`; edit `KAGGLE_USER` for another
    account (`[kaggle_run.py:KAGGLE_USER]`).
  - Preset shaping: `SIGNAL_HONESTY_COEF = 0.05`, annealed to 0 over
    `SIGNAL_HONESTY_FRAC = 0.5` of the run (`[kaggle_run.py:SIGNAL_HONESTY_COEF]`).
  - `launch` accepts either `--resume <path>` or `--resume-state`, not both;
    `--resume-state` resumes from the state dataset and attaches it to the
    kernel (`[kaggle_run.py:build_parser]`, `[kaggle_run.py:launch]`).
  - `pull -p` defaults to `checkpoints/kaggle` (`[kaggle_run.py:PULL_DIR]`).
- `benchmark.py`: `play_random_game`, `benchmark_bare_engine`,
  `benchmark_training_rollout`, `RUN_D2_NETWORK`, `RUN_D2_CRITIC`
  (`[benchmark.py:benchmark_training_rollout]`).
- `watch_bots.py`: plays a serving tier and reports briscola calls and signal
  honesty; `SignalAudit`, `play_game`, `DEFAULT_GAMES = 20` (`--games`),
  `GAME_SEED_BASE = 5000`; flags `--tier` (default `forte`), `--temperature`
  (default `0.0`) and `--trace` (print every move)
  (`[watch_bots.py:SignalAudit]`, `[watch_bots.py:main]`).
- `make_summary_plot.py`: plots `runs/demo/metrics.csv` to
  `runs/demo/summary.png`; also exports `smooth(xs, window=5)`. The chart
  title hard-codes `win_points=5` whatever the run used
  (`[make_summary_plot.py:main]`, `[make_summary_plot.py:smooth]`).
- `generate_annotation_scenarios.py`: deterministic expert-annotation batch
  and manifest generator; `generate_batch_result`, `write_batch_outputs`,
  `validate_batch`, `validate_manifest`, `validate_output_bytes`,
  `build_manifest`, `public_state`, `derive_game_seed`, `seed_fingerprint`,
  `family_quotas`, `load_policy_score_scorer`, `canonical_json_bytes`
  (`[generate_annotation_scenarios.py:generate_batch_result]`).
  - Defaults: `DEFAULT_MODEL_ARTIFACT = serving/models/run_d2_champion.pt`,
    `DEFAULT_SOURCE_GAME_COUNT = 120`, `MIN_MASTER_SEED_BYTES = 32`.
  - Result types: `GenerationResult` (`scenarios`, `audit`),
    `GenerationAudit` (aggregate-only manifest metadata), `ModelMargins`
    (`action`, `card`, `signal`).
  - Public-state and scoring helpers: `briscola_public_state`,
    `play_card_public_state`, `risk_tradeoffs`,
    `briscola_strength_closeness`, `model_margins`, `candidate_quality`
    (`0.6 · ambiguity + 0.4 · impact`), and `predict_difficulty`
    (`easy` below 0.45, `medium` below 0.70, otherwise `hard`)
    (`[generate_annotation_scenarios.py:predict_difficulty]`).
- `annotation_scenario_constants.py`: `ANNOTATION_DIFFICULTIES`,
  `ANNOTATION_FAMILIES`, `ANNOTATION_TAGS`, `IMPORTANCE_STANDARD = 1`,
  `IMPORTANCE_USEFUL_UNCOMMON = 2`, `IMPORTANCE_CURATED_CORNER_CASE = 3`,
  `ANNOTATION_IMPORTANCE_VALUES`, `BRISCOLA_CLOSE_THRESHOLD = 0.8` (minimum
  closeness for a `borderline_briscola` scenario), `DIVERSITY_PENALTY = 0.12`
  (selection penalty per repeated feature signature),
  `MAX_SCENARIOS_PER_SOURCE_GAME`, `RULES_VERSION`, `METHOD_VERSION`
  (`[annotation_scenario_constants.py:METHOD_VERSION]`).

## Invariants

- `bc_then_rl` resume requires a resumable `last.pt` with optimizer state; the
  checkpoint must match the 518-feature `OBS_SIZE`, explicit architecture
  flags and `--centralized-critic`, and its `resume_contract` when present.
  A checkpoint without `resume_contract` is accepted without that check.
  Legacy V4 checkpoints with global signal heads are refused
  (`[bc_then_rl.py:_validate_resume_architecture]`,
  `[bc_then_rl.py:_validate_resume_contract]`, `[bc_then_rl.py:phase2_rl]`).
  `--save-last-every` must be positive and `--centralized-critic` requires
  `--num-envs > 1` (`[bc_then_rl.py:phase2_rl]`).
  `--win-points` and `--wp-mix` are mutually exclusive
  (`[bc_then_rl.py:parse_args]`); on resume, metrics rows after the
  checkpoint update are dropped (`[bc_then_rl.py:_reconcile_metrics_csv]`).
- `--bc-load` reads its file with `torch.load(weights_only=False)` and no
  checksum check; load only trusted files (`[bc_then_rl.py:phase1_bc]`).
- `best.pt` is a monitoring peak, never a champion without fresh held-out
  selection (`[bc_then_rl.py:phase2_rl]`).
- Held-out scoring uses `HELDOUT_SEED_BASE`, disjoint from training and
  selection seeds (`[score_checkpoints.py:HELDOUT_SEED_BASE]`). `verdict`
  ships only when every paired lead interval is above zero
  (`[score_checkpoints.py:verdict]`). Champion selection needs
  `--candidate`, `--incumbent`, `--protocol-id` and `--seed-base` together
  and cannot be mixed with positional checkpoints
  (`[score_checkpoints.py:main]`).
- Kaggle launches above `SMOKE_MAX_STEPS = 1_000_000` are refused without
  `--confirm-cost`; the `rund` preset is retired
  (`[kaggle_run.py:launch]`, `[kaggle_run.py:_RETIRED_PRESETS]`).
  `push-state` requires `last.pt` with a `resume_contract.run_id`
  (`[kaggle_run.py:push_state]`).
- Each fixture case pairs the state DTO from `game_to_state_dict` with the
  observation `encode_observation` must yield; cases target raw scores with
  figure remainders, signals, voids, seat rotation and Cricca
  (`[gen_bot_fixtures.py:_case]`, `[gen_bot_fixtures.py:build_cases]`).
- Annotation batches: master seed at least 32 bytes; batch ID matches
  `^[a-z0-9][a-z0-9-]{0,72}$`; only `win_points = 41` states; family quotas
  are near-equal across `borderline_briscola`, `lead`, `risk`; at most
  `MAX_SCENARIOS_PER_SOURCE_GAME = 2` per source game; hidden hands, seeds and
  model scores are forbidden in output; JSON is canonical and the manifest
  hashes the exact batch bytes; the raw master seed must never appear in
  output. Every V1 scenario uses `IMPORTANCE_USEFUL_UNCOMMON`, and play
  scenarios must offer more than one legal card
  (`[generate_annotation_scenarios.py:validate_batch]`,
  `[generate_annotation_scenarios.py:_validate_play_state]`,
  `[generate_annotation_scenarios.py:_reject_hidden_fields]`,
  `[generate_annotation_scenarios.py:write_batch_outputs]`).
- `watch_bots` grades signals with `becca_env.signals.signal_is_honest`, the
  same convention used by shaping and the BC teacher
  (`[watch_bots.py:SignalAudit.record]`).

## Side Effects

- `train` writes checkpoints to `--ckpt-dir` (default `checkpoints/`) and
  TensorBoard/W&B logs via `training.trainer` (`[train.py:main]`).
- `bc_then_rl` writes the BC snapshot to `--bc-ckpt`, the engine's `last.pt`
  and `best.pt` to the parent directory of `--final-ckpt`, and a flat final
  checkpoint to `--final-ckpt`
  (`[bc_then_rl.py:phase1_bc]`, `[bc_then_rl.py:phase2_rl]`). It writes
  `metrics.csv` and `learning_curve.png` under `--out-dir`; the module
  docstring's `summary.png` is never written (`[bc_then_rl.py:plot_results]`).
- `bc_then_rl.plot_results` and `make_summary_plot` need `matplotlib`, which
  is only in the `dev` extra, not `train` (`pyproject.toml`).
- `score_checkpoints --candidate ...` writes a new, non-overwritable JSONL
  score artifact (default `score.jsonl`) (`[score_checkpoints.py:select_champion]`).
- `export_inference_artifact` writes an artifact and `.sha256` sidecar
  (`[export_inference_artifact.py:main]`).
- `gen_bot_fixtures` overwrites `serving/fixtures/bot_states.json`
  (`[gen_bot_fixtures.py:main]`).
- `kaggle_run` stages files in a temporary directory and shells out to the
  authenticated `kaggle` CLI to create/version datasets, push kernels (which
  trigger GPU runs), poll status and download outputs
  (`[kaggle_run.py:_run]`, `[kaggle_run.py:push_code]`, `[kaggle_run.py:launch]`).
  `push-code` adds `.source-provenance.json` from
  `training.provenance.source_manifest` to the staged dataset, which runs `git`
  (`[kaggle_run.py:push_code]`). `launch` prints a warning when the estimate
  exceeds the 12-hour session cap. `pull` writes into `checkpoints/kaggle` by
  default (`[kaggle_run.py:pull]`).
- `generate_annotation_scenarios` reads the master seed file and model
  artifact and writes the batch and manifest files, each atomically. The pair
  is not written atomically: a failure between the two writes can leave a new
  batch next to a stale manifest
  (`[generate_annotation_scenarios.py:write_batch_outputs]`,
  `[generate_annotation_scenarios.py:_atomic_write]`).
- `watch_bots` loads the tier's model through `serving.tiers.get_agent`, which
  reads model files from disk (`[watch_bots.py:main]`).
- `make_summary_plot` writes `runs/demo/summary.png`
  (`[make_summary_plot.py:main]`); `benchmark` spawns vector-env subprocess
  workers (`[benchmark.py:benchmark_training_rollout]`).
- All scripts print progress to stdout.

## Verification

- Run: `cd ai && pytest tests/test_train_cli.py tests/test_bc_then_rl.py tests/test_score_checkpoints.py tests/test_kaggle_run.py tests/test_benchmark.py tests/test_bot_fixtures.py tests/test_annotation_scenarios.py tests/test_near_perfect.py tests/test_inference_artifact.py`
- Full suite: `cd ai && pytest`
