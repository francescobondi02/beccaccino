# training

## Overview

PPO self-play training for the Beccaccino policy. `engine.run_ppo` owns the
whole lifecycle: vector environments, learner/opponent rollouts, per-seat GAE,
return normalization, PPO updates, schedules, curriculum, evaluation,
checkpoints, wall-clock deadlines and exact resume. `trainer.train` adapts a
`TrainConfig` to the engine with TensorBoard/W&B logging. The package also
holds the V1–V4 networks, the centralized (CTDE) critic, behavioral cloning on
the heuristic teacher, and the atomic checkpoint format. Depends on
[`../becca_env/README.md`](../becca_env/README.md) and
[`../evaluation/README.md`](../evaluation/README.md).

## Interface

- `engine.py`: `run_ppo(config, net, *, critic, resume_checkpoint, anchors,
  checkpoint_extra, callbacks)`, `TrainingCallbacks` (`on_update`,
  `on_evaluation`, `on_complete`), `UpdateStats`, `EvaluationStats`,
  `TrainingResult`, `entropy_coefficient`, `signal_honesty_schedule`,
  `apply_signal_honesty_coef`, `apply_learning_rate`,
  `ENGINE_CONTRACT_FORMAT = 1`, `SECONDS_PER_HOUR = 3600` (`max_hours`
  conversion) (`[engine.py:run_ppo]`).
- `trainer.py`: `train(config)` (only export) (`[trainer.py:__all__]`).
- `config.py`: `TrainConfig` dataclass with `net_kwargs()`, `batch_size`,
  `total_updates` (`[config.py:TrainConfig]`).
- `network.py`: `BeccaNet` (V1), `BeccaNetV2`, `BeccaNetV3`, `BeccaNetV4`,
  `ResidualBlock`, `CentralizedCritic`, `create_network(version, **kwargs)`
  which stamps `net.config`; all policies expose `forward(obs, action_mask)`
  and `get_action_and_value(obs, action_mask, action=None)`;
  `ACTION_SIZE = 160`, plus the card-conditioned V4 head sizes
  `CARD_HEAD_SIZE = 40` and `SIGNAL_HEAD_SIZE = 4` (`[network.py:create_network]`).
  `ACTION_SIZE` is defined only here; `rollout.py` imports it.
- `checkpoint.py`: `save_checkpoint`, `save_checkpoint_payload`,
  `load_checkpoint`, `load_resumable_checkpoint`, `checkpoint_sha256`,
  `net_config_of`, `build_net`, `seed_everything`, `rng_state`,
  `restore_rng`, `CheckpointIntegrityError`, `CKPT_FORMAT = 3`
  (`[checkpoint.py:save_checkpoint]`).
- `provenance.py`: `checkpoint_provenance`, `source_manifest`,
  `runtime_manifest`, `SOURCE_MANIFEST_FILENAME = ".source-provenance.json"`
  (`[provenance.py:checkpoint_provenance]`).
- `rollout.py`: `RolloutBuffer` (`store`, `compute_gae`, `get_batch`,
  `live_tail_transitions`), `collect_rollout`, `collect_rollout_vec`
  (`[rollout.py:RolloutBuffer]`).
- `dual_rollout.py`: `collect_self_play_rollout_vec(vec_env, learner_net,
  opponent_net, learner_team_per_env, steps_per_env, device, critic=None)`
  (`[dual_rollout.py:collect_self_play_rollout_vec]`).
- `vec_env.py`: `learner_team_per_env`, `win_points_per_env`, `deal_seed`,
  `make_env`, `create_vec_env`, `snapshot_vec_env_state`,
  `restore_vec_env_state` (`[vec_env.py:create_vec_env]`).
- `ppo.py`: `ppo_update(...)` returning loss, entropy, clip fraction, KL and
  `epochs_used` metrics (`[ppo.py:ppo_update]`).
- `normalization.py`: `RunningMeanStd`, `ReturnNormalizer`
  (`[normalization.py:ReturnNormalizer]`).
- `self_play.py`: `OpponentPool` (`add_policy`, `sample`, `serialize`,
  `from_serialized`) (`[self_play.py:OpponentPool]`).
- `imitation.py`: `ImitationDataset`, `collect_heuristic_dataset`,
  `behavioral_clone` (`[imitation.py:behavioral_clone]`).

## Invariants

- `run_ppo` is the single PPO lifecycle used by every training entry point
  (`[engine.py:run_ppo]`).
- Config validation: at least one update must run; `pool_save_every` and
  `eval_every` must be positive; `ckpt_every`/`save_last_every` positive when
  set; `wp_mix` requires `num_envs > 1` and excludes curriculum
  (`[engine.py:_validate_config]`); `centralized_critic` requires
  `num_envs > 1` (`[engine.py:_prepare_critic]`).
- Resume fails closed: checkpoint must be format 3 with a `.sha256` sidecar and
  source/runtime provenance (`[checkpoint.py:load_resumable_checkpoint]`);
  its `obs_size` must equal the current `OBS_SIZE` (518); legacy V4 global
  signal heads are inference-only; critic presence must match, and every
  immutable `engine_contract` field must match when the checkpoint has one. A
  checkpoint without `engine_contract` skips that comparison. A completed run
  or a vector checkpoint without `rollout_state` is rejected
  (`[engine.py:_validate_resume_checkpoint]`, `[engine.py:_engine_contract]`,
  `[engine.py:run_ppo]`).
- Checkpoint saves are atomic (temp file, `fsync`, `os.replace`, directory
  `fsync`). The existing file is copied to `<stem>.prev<suffix>` only when it
  already verifies (`[checkpoint.py:_atomic_torch_save]`). Loads fall back to
  the `.prev` copy when the primary is unusable and emit a `RuntimeWarning`
  (`[checkpoint.py:_load_with_fallback]`).
- `load_checkpoint` accepts files without a `.sha256` sidecar and unpickles
  with `torch.load(weights_only=False)`; use it only on trusted files.
  `load_resumable_checkpoint` requires the sidecar
  (`[checkpoint.py:_load_verified]`).
- `create_network(**net.config)` must rebuild the exact architecture;
  `net_config_of` normalizes legacy `network_version` keys and infers missing
  `obs_size` (`[network.py:create_network]`, `[checkpoint.py:net_config_of]`).
- `BeccaNetV4` hard-codes observation offsets (`OBS_STATUS_END = 240`,
  `OBS_TRICK_END = 400`, `OBS_GLOBAL_START = 400`) that must change together
  with `becca_env/observation.py` (`[network.py:BeccaNetV4]`).
- Illegal actions are masked with `-1e8` before sampling in every network
  (`[network.py:BeccaNetV2.forward]`).
- The centralized critic is train-time only and never shares the actor trunk
  (`[network.py:CentralizedCritic]`).
- GAE chains are isolated per `(env, seat)` and cut at game boundaries; a
  chain's last live transition is bootstrap-only and carried to the next
  window (`[rollout.py:RolloutBuffer._compute_gae]`,
  `[rollout.py:RolloutBuffer.live_tail_transitions]`).
- `info["prior_reward"]` is credited to the seat's previous transition and
  terminal residuals to each seat's last transition
  (`[rollout.py:_credit_previous_transition]`,
  `[rollout.py:_credit_terminal_residuals]`). A non-zero reward with no
  previous transition for that `(env, seat)` raises `RuntimeError`
  (`[rollout.py:_credit_previous_transition]`). `get_batch` raises
  `ValueError` when no complete transitions remain after trimming live tails
  (`[rollout.py:RolloutBuffer.get_batch]`).
- Vector envs use `AutoresetMode.SAME_STEP`; terminal-info extraction depends
  on it (`[vec_env.py:create_vec_env]`, `[rollout.py:_extract_terminal_info]`).
  `run_ppo` always builds them with `sync=False` (`AsyncVectorEnv`)
  (`[engine.py:run_ppo]`).
- Production self-play stores only learner-team transitions and stamps
  `done` on the learner's latest transition when an opponent ends the game
  (`[dual_rollout.py:collect_self_play_rollout_vec]`,
  `[rollout.py:_mark_latest_transition_done]`).
- Learner teams alternate by env index and win-point values are assigned in
  team-balanced pairs (`[vec_env.py:learner_team_per_env]`,
  `[vec_env.py:win_points_per_env]`).
- Return normalization scales rewards by running return std without mean
  subtraction and resets an env's chains on `done`
  (`[normalization.py:ReturnNormalizer.normalize]`).
- PPO KL early stopping compares each epoch's own mean KL to `target_kl`
  (`[ppo.py:ppo_update]`).
- Behavioral cloning trains the policy only, and requires 518-feature
  datasets (`[imitation.py:behavioral_clone]`); the teacher declares honest
  signals by default (`[imitation.py:collect_heuristic_dataset]`).
- `best.pt` is written only when the heuristic win rate improves
  (`[engine.py:run_ppo]`).
- Evaluation schedule in `run_ppo` (`[engine.py:run_ppo]`):
  - Runs every `eval_every` updates, plus update 1 when `eval_at_start` is set.
  - Plays `eval_games` against random and against the heuristic. The heuristic
    games use `eval_win_points`, else `max(wp_mix)`, else the current
    `win_points`.
  - With `use_curriculum`, the stage advances after
    `curriculum_confirm_count` consecutive evaluations whose win rate against
    random reaches the stage's `min_wr`. Advancing rebuilds the vector env at
    the new `win_points` and resets the return normalizer's chains
    (`[engine.py:_advance_curriculum]`).
  - When `final_eval` is set, a run that was not stopped early plays a final
    `2 * eval_games` against random with `seed=99999`.

## Side Effects

- Creates `config.ckpt_dir` and writes `best.pt`, `ckpt_{update:06d}.pt`
  (every `ckpt_every` updates, when set) and `last.pt`, with `.sha256`
  sidecars and `.prev` copies. `final.pt` is written only when
  `write_final_checkpoint` is set; `scripts.bc_then_rl` turns it off
  (`[engine.py:run_ppo]`, `[checkpoint.py:_write_checksum]`).
- Every checkpoint save calls `checkpoint_provenance()`, which runs several
  `git` subprocesses and enumerates installed packages each time
  (`[checkpoint.py:save_checkpoint_payload]`,
  `[provenance.py:runtime_manifest]`).
- `trainer.train` writes TensorBoard logs under `config.log_dir` and, when
  `use_wandb` is set, logs to Weights & Biases (network)
  (`[trainer.py:train]`, `[trainer.py:_start_wandb]`).
- `create_vec_env` spawns subprocess workers via `AsyncVectorEnv` unless
  `sync=True` (`[vec_env.py:create_vec_env]`); vector envs are closed on exit
  (`[engine.py:run_ppo]`).
- `seed_everything` and `restore_rng` mutate global Python, NumPy and torch
  RNG state (`[checkpoint.py:seed_everything]`, `[checkpoint.py:restore_rng]`).
- `source_manifest` runs `git` subprocesses and may read
  `.source-provenance.json` (`[provenance.py:_git]`,
  `[provenance.py:source_manifest]`).
- `RolloutBuffer` collectors store `_becca_rollout_obs` and
  `_becca_rollout_carry` attributes on the env object
  (`[rollout.py:_save_rollout_carry]`).
- `OpponentPool.sample` uses the global `random` module
  (`[self_play.py:OpponentPool.sample]`).
- `collect_heuristic_dataset` and `behavioral_clone` print progress to stdout
  when verbose (`[imitation.py:behavioral_clone]`).

## Verification

- Run: `cd ai && pytest tests/test_trainer.py tests/test_checkpoint.py tests/test_gae.py tests/test_dual_rollout.py tests/test_ppo.py tests/test_vec_env.py tests/test_normalization.py tests/test_imitation.py tests/test_network_v3.py tests/test_network_v4.py tests/test_centralized_critic.py tests/test_opponent_pool.py tests/test_provenance.py tests/test_best_checkpoint.py tests/test_signal_schedule.py`
- Full suite: `cd ai && pytest`
