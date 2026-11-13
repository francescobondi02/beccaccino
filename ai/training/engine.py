"""Canonical PPO training lifecycle."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import torch
import torch.nn as nn

import evaluation.arena
import evaluation.heuristic
from becca_env.env import BeccaEnv
from becca_env.observation import FULL_STATE_SIZE, OBS_SIZE
from training.checkpoint import (
    load_resumable_checkpoint,
    net_config_of,
    restore_rng,
    save_checkpoint,
)
from training.config import TrainConfig
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import CentralizedCritic, create_network
from training.normalization import ReturnNormalizer
from training.ppo import ppo_update
from training.rollout import collect_rollout
from training.self_play import OpponentPool
from training.vec_env import (
    create_vec_env,
    learner_team_per_env,
    snapshot_vec_env_state,
    win_points_per_env,
)

SECONDS_PER_HOUR = 3600
ENGINE_CONTRACT_FORMAT = 1


@dataclass(frozen=True)
class EvaluationStats:
    update: int
    step: int
    win_rate_random: float
    win_rate_heuristic: float
    win_points: int


@dataclass(frozen=True)
class UpdateStats:
    update: int
    total_updates: int
    step: int
    games: int
    sps: float
    policy_loss: float
    value_loss: float
    entropy: float
    clip_frac: float
    approx_kl: float
    epochs_used: float
    ent_coef: float
    signal_honesty_coef: float
    explained_variance: float
    learning_rate: float
    mean_reward: float
    mean_return: float
    mean_episode_length: float
    games_in_batch: int
    opponent_source: str
    pool_size: int
    curriculum_stage: int
    win_points: int
    mean_returns_by_win_points: dict[int, float]
    last_win_rate_random: float
    last_win_rate_heuristic: float
    evaluated: bool


@dataclass(frozen=True)
class TrainingResult:
    net: nn.Module
    critic: CentralizedCritic | None
    step: int
    environment_step: int
    games: int
    update: int
    best_win_rate_heuristic: float
    best_update: int
    last_win_rate_random: float
    last_win_rate_heuristic: float
    stopped_early: bool
    elapsed_seconds: float


def _ignore_update(stats: UpdateStats) -> None:
    del stats


def _ignore_evaluation(stats: EvaluationStats) -> None:
    del stats


def _ignore_complete(result: TrainingResult) -> None:
    del result


@dataclass
class TrainingCallbacks:
    on_update: Callable[[UpdateStats], None] = _ignore_update
    on_evaluation: Callable[[EvaluationStats], None] = _ignore_evaluation
    on_complete: Callable[[TrainingResult], None] = _ignore_complete


def entropy_coefficient(config: TrainConfig, update: int) -> float:
    frac = (update - 1) / max(config.total_updates - 1, 1)
    return config.ent_coef + (config.ent_coef_final - config.ent_coef) * frac


def signal_honesty_schedule(config: TrainConfig, update: int) -> float:
    """Anneal the signal convention reward, then hold its final value."""
    progress = (update - 1) / max(config.total_updates - 1, 1)
    ramp = (
        min(progress / config.signal_honesty_frac, 1.0) if config.signal_honesty_frac > 0 else 1.0
    )
    return (
        config.signal_honesty_coef
        + (config.signal_honesty_coef_final - config.signal_honesty_coef) * ramp
    )


def apply_signal_honesty_coef(env, coef: float, use_vec: bool) -> None:
    if use_vec:
        env.call("set_signal_honesty_coef", coef)
    else:
        env.set_signal_honesty_coef(coef)


def apply_learning_rate(config: TrainConfig, optimizer: torch.optim.Optimizer, update: int) -> None:
    denom = max(config.total_updates - 1, 1)
    if config.lr_schedule == "linear":
        multiplier = 1.0 - (update - 1) / denom
    elif config.lr_schedule == "cosine":
        multiplier = max(0.5 * (1 + math.cos(math.pi * (update - 1) / denom)), 0.1)
    else:
        return
    for parameter_group in optimizer.param_groups:
        parameter_group["lr"] = config.lr * multiplier


def run_ppo(
    config: TrainConfig,
    net: nn.Module,
    *,
    critic: CentralizedCritic | None = None,
    resume_checkpoint: dict | None = None,
    anchors: list[dict] | None = None,
    checkpoint_extra: dict | None = None,
    callbacks: TrainingCallbacks | None = None,
) -> TrainingResult:
    """Run the single PPO lifecycle used by every training entry point."""
    callbacks = callbacks or TrainingCallbacks()
    device = torch.device(config.device)
    checkpoint_dir = Path(config.ckpt_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    _validate_config(config)

    if resume_checkpoint is None and config.resume_from:
        resume_checkpoint = load_resumable_checkpoint(config.resume_from, map_location=device)
    if resume_checkpoint is not None:
        _validate_resume_checkpoint(resume_checkpoint, config)
        net.load_state_dict(resume_checkpoint["model"])
        if anchors is None and resume_checkpoint.get("anchors") is not None:
            anchors = resume_checkpoint["anchors"]

    critic = _prepare_critic(config, device, resume_checkpoint, critic)
    parameters = list(net.parameters())
    if critic is not None:
        parameters += list(critic.parameters())
    optimizer = torch.optim.Adam(parameters, lr=config.lr, eps=1e-5)
    if resume_checkpoint is not None:
        if resume_checkpoint.get("optimizer") is None:
            raise SystemExit("resume checkpoint has no optimizer state")
        optimizer.load_state_dict(resume_checkpoint["optimizer"])

    start_update = (resume_checkpoint.get("update", 0) + 1) if resume_checkpoint else 1
    step_count = resume_checkpoint.get("step", 0) if resume_checkpoint else 0
    environment_step_count = (
        resume_checkpoint.get("environment_step", 0) if resume_checkpoint else 0
    )
    games_total = resume_checkpoint.get("games", 0) if resume_checkpoint else 0
    curriculum_stage = resume_checkpoint.get("curriculum_stage", 0) if resume_checkpoint else 0
    best_wr_heuristic = (
        resume_checkpoint.get("best_wr_heuristic", -1.0) if resume_checkpoint else -1.0
    )
    best_update = resume_checkpoint.get("best_update", 0) if resume_checkpoint else 0
    last_wr_random = (
        resume_checkpoint.get("last_wr_random", float("nan")) if resume_checkpoint else float("nan")
    )
    last_wr_heuristic = (
        resume_checkpoint.get("last_wr_heuristic", float("nan"))
        if resume_checkpoint
        else float("nan")
    )
    if start_update > config.total_updates:
        raise SystemExit(
            f"resume checkpoint is already at update {start_update - 1} of "
            f"{config.total_updates}: this run is complete"
        )

    win_points = config.win_points
    if config.use_curriculum and config.curriculum_stages:
        win_points = config.curriculum_stages[curriculum_stage]["win_points"]
    training_win_points = config.wp_mix or win_points
    env_win_points = win_points_per_env(config.num_envs, training_win_points)

    use_vec = config.num_envs > 1
    rollout_state = resume_checkpoint.get("rollout_state") if resume_checkpoint else None
    if use_vec and resume_checkpoint is not None and rollout_state is None:
        raise SystemExit(
            "checkpoint predates exact vector-state resume; start a new run from its policy weights"
        )

    vec_env = None
    single_env = None
    if use_vec:
        vec_env = create_vec_env(
            num_envs=config.num_envs,
            seed=config.seed,
            win_points=training_win_points,
            sync=False,
            trick_shaping_coef=config.trick_shaping_coef,
            signal_honesty_coef=signal_honesty_schedule(config, start_update),
            include_full_obs=critic is not None,
            rollout_state=rollout_state,
        )
    else:
        single_env = BeccaEnv(
            seed=config.seed,
            win_points=win_points,
            trick_shaping_coef=config.trick_shaping_coef,
            signal_honesty_coef=signal_honesty_schedule(config, start_update),
            include_full_obs=False,
        )

    pool = OpponentPool(max_size=config.opponent_pool_size, anchors=anchors)
    if resume_checkpoint is not None and resume_checkpoint.get("pool"):
        pool = OpponentPool.from_serialized(
            resume_checkpoint["pool"],
            max_size=config.opponent_pool_size,
            anchors=anchors,
        )
    opponent_net = create_network(**net.config).to(device)
    opponent_net.load_state_dict(net.state_dict())
    return_normalizer = ReturnNormalizer(gamma=config.gamma) if config.normalize_returns else None
    if (
        resume_checkpoint is not None
        and return_normalizer is not None
        and resume_checkpoint.get("normalizer") is not None
    ):
        return_normalizer.from_dict(resume_checkpoint["normalizer"])
    if resume_checkpoint is not None and resume_checkpoint.get("rng") is not None:
        restore_rng(resume_checkpoint["rng"])

    teams = (
        learner_team_per_env(config.num_envs)
        if config.balance_learner_teams and use_vec
        else np.zeros(config.num_envs, dtype=np.int64)
    )
    checkpoint_metadata = dict(checkpoint_extra or {})
    start_time = time.time()
    session_steps = 0
    deadline = (
        time.monotonic() + config.max_hours * SECONDS_PER_HOUR
        if config.max_hours is not None
        else None
    )
    curriculum_confirm = resume_checkpoint.get("curriculum_confirm", 0) if resume_checkpoint else 0
    stopped_early = False
    completed_update = start_update - 1

    def save(path: Path, update: int) -> None:
        extra = {
            **checkpoint_metadata,
            "engine_contract": _engine_contract(config),
            "games": games_total,
            "environment_step": environment_step_count,
            "curriculum_stage": curriculum_stage,
            "curriculum_confirm": curriculum_confirm,
            "best_wr_heuristic": best_wr_heuristic,
            "best_update": best_update,
            "last_wr_random": last_wr_random,
            "last_wr_heuristic": last_wr_heuristic,
            "anchors": pool.anchors,
        }
        if critic is not None:
            extra["critic"] = critic.state_dict()
        if use_vec:
            extra["rollout_state"] = snapshot_vec_env_state(vec_env)
        save_checkpoint(
            path,
            net=net,
            optimizer=optimizer,
            config=config,
            step=step_count,
            update=update,
            normalizer=return_normalizer,
            pool=pool,
            extra=extra,
        )

    try:
        for update in range(start_update, config.total_updates + 1):
            completed_update = update
            apply_learning_rate(config, optimizer, update)
            ent_coef = entropy_coefficient(config, update)
            signal_coef = signal_honesty_schedule(config, update)
            if config.signal_honesty_coef != 0.0 or config.signal_honesty_coef_final != 0.0:
                apply_signal_honesty_coef(vec_env if use_vec else single_env, signal_coef, use_vec)

            if use_vec:
                sampled = pool.sample(p_latest=config.p_latest_opponent)
                if sampled is None:
                    opponent_net.load_state_dict(net.state_dict())
                    opponent_source = "latest"
                else:
                    opponent_net.load_state_dict(sampled)
                    opponent_source = "pool"
                buffer = collect_self_play_rollout_vec(
                    vec_env,
                    net,
                    opponent_net,
                    teams,
                    config.steps_per_env,
                    device,
                    critic=critic,
                )
                session_steps += config.batch_size
                environment_step_count += config.batch_size
            else:
                buffer = collect_rollout(single_env, net, config.batch_size, device)
                opponent_source = "self"
                session_steps += buffer.collected_steps
                environment_step_count += buffer.collected_steps

            step_count += buffer.collected_steps
            games_total += buffer.games_done
            batch = buffer.get_batch(
                gamma=config.gamma,
                lam=config.gae_lambda,
                return_normalizer=return_normalizer,
            )
            ppo_metrics = ppo_update(
                net,
                optimizer,
                batch,
                clip_eps=config.clip_eps,
                vf_coef=config.vf_coef,
                ent_coef=ent_coef,
                max_grad_norm=config.max_grad_norm,
                num_epochs=config.num_epochs,
                minibatch_size=config.minibatch_size,
                target_kl=config.target_kl,
                device=device,
                critic=critic,
            )

            values = batch["values"].numpy()
            returns = batch["returns"].numpy()
            return_variance = returns.var()
            explained_variance = (
                1 - (returns - values).var() / (return_variance + 1e-8)
                if return_variance > 0
                else 0.0
            )
            mean_reward = float(buffer.rewards[: buffer.ptr].mean())
            mean_returns_by_wp = _mean_episode_returns_by_win_points(buffer, env_win_points)
            if update % config.pool_save_every == 0:
                pool.add_policy(net.state_dict())

            evaluated = update % config.eval_every == 0 or (config.eval_at_start and update == 1)
            if evaluated:
                last_wr_random = evaluation.arena.evaluate_against_random(
                    net, num_games=config.eval_games, device=device
                )
                eval_win_points = (
                    config.eval_win_points
                    if config.eval_win_points is not None
                    else max(config.wp_mix)
                    if config.wp_mix
                    else win_points
                )
                last_wr_heuristic = evaluation.heuristic.evaluate_against_heuristic(
                    net,
                    num_games=config.eval_games,
                    device=device,
                    win_points=eval_win_points,
                )
                if last_wr_heuristic > best_wr_heuristic:
                    best_wr_heuristic = last_wr_heuristic
                    best_update = update
                    save(checkpoint_dir / "best.pt", update)
                callbacks.on_evaluation(
                    EvaluationStats(
                        update=update,
                        step=step_count,
                        win_rate_random=last_wr_random,
                        win_rate_heuristic=last_wr_heuristic,
                        win_points=eval_win_points,
                    )
                )

                if config.use_curriculum and curriculum_stage < len(config.curriculum_stages) - 1:
                    stage = config.curriculum_stages[curriculum_stage]
                    if last_wr_random >= stage["min_wr"]:
                        curriculum_confirm += 1
                        if curriculum_confirm >= config.curriculum_confirm_count:
                            curriculum_stage += 1
                            curriculum_confirm = 0
                            win_points = config.curriculum_stages[curriculum_stage]["win_points"]
                            vec_env, single_env, env_win_points = _advance_curriculum(
                                config,
                                vec_env,
                                single_env,
                                use_vec=use_vec,
                                win_points=win_points,
                                signal_coef=signal_coef,
                                critic=critic,
                                normalizer=return_normalizer,
                            )
                    else:
                        curriculum_confirm = 0

            elapsed = max(time.time() - start_time, 1e-9)
            callbacks.on_update(
                UpdateStats(
                    update=update,
                    total_updates=config.total_updates,
                    step=step_count,
                    games=games_total,
                    sps=session_steps / elapsed,
                    policy_loss=ppo_metrics["policy_loss"],
                    value_loss=ppo_metrics["value_loss"],
                    entropy=ppo_metrics["entropy"],
                    clip_frac=ppo_metrics["clip_frac"],
                    approx_kl=ppo_metrics["approx_kl"],
                    epochs_used=ppo_metrics["epochs_used"],
                    ent_coef=ent_coef,
                    signal_honesty_coef=signal_coef,
                    explained_variance=float(explained_variance),
                    learning_rate=optimizer.param_groups[0]["lr"],
                    mean_reward=mean_reward,
                    mean_return=float(returns.mean()),
                    mean_episode_length=buffer.ptr / max(buffer.games_done, 1),
                    games_in_batch=buffer.games_done,
                    opponent_source=opponent_source,
                    pool_size=len(pool),
                    curriculum_stage=curriculum_stage,
                    win_points=win_points,
                    mean_returns_by_win_points=mean_returns_by_wp,
                    last_win_rate_random=last_wr_random,
                    last_win_rate_heuristic=last_wr_heuristic,
                    evaluated=evaluated,
                )
            )

            if config.ckpt_every and update % config.ckpt_every == 0:
                save(checkpoint_dir / f"ckpt_{update:06d}.pt", update)
            if config.save_last_every and update % config.save_last_every == 0:
                save(checkpoint_dir / "last.pt", update)
            if deadline is not None and time.monotonic() >= deadline:
                save(checkpoint_dir / "last.pt", update)
                stopped_early = True
                break

        if not stopped_early:
            if config.write_final_checkpoint:
                save(checkpoint_dir / "final.pt", completed_update)
            save(checkpoint_dir / "last.pt", completed_update)
            if config.final_eval:
                last_wr_random = evaluation.arena.evaluate_against_random(
                    net,
                    num_games=config.eval_games * 2,
                    device=device,
                    seed=99999,
                )
    finally:
        if vec_env is not None:
            vec_env.close()

    result = TrainingResult(
        net=net,
        critic=critic,
        step=step_count,
        environment_step=environment_step_count,
        games=games_total,
        update=completed_update,
        best_win_rate_heuristic=best_wr_heuristic,
        best_update=best_update,
        last_win_rate_random=last_wr_random,
        last_win_rate_heuristic=last_wr_heuristic,
        stopped_early=stopped_early,
        elapsed_seconds=time.time() - start_time,
    )
    callbacks.on_complete(result)
    return result


def _validate_config(config: TrainConfig) -> None:
    if config.total_updates < 1:
        raise SystemExit(
            f"total_timesteps {config.total_timesteps} is below one batch "
            f"({config.batch_size}); no update would run"
        )
    for name in ("pool_save_every", "eval_every"):
        if getattr(config, name) <= 0:
            raise ValueError(f"{name} must be positive")
    for name in ("ckpt_every", "save_last_every"):
        value = getattr(config, name)
        if value is not None and value <= 0:
            raise ValueError(f"{name} must be positive when set")
    if config.wp_mix is not None and config.num_envs <= 1:
        raise ValueError("wp_mix requires vector training with num_envs > 1")
    if config.wp_mix is not None and config.use_curriculum:
        raise ValueError("wp_mix and curriculum are mutually exclusive")


def _validate_resume_checkpoint(checkpoint: dict, config: TrainConfig) -> None:
    checkpoint_net_config = net_config_of(checkpoint)
    if checkpoint_net_config["obs_size"] != OBS_SIZE:
        raise SystemExit(
            f"checkpoint observation width is {checkpoint_net_config['obs_size']}, "
            f"current training requires {OBS_SIZE}"
        )
    if (
        checkpoint_net_config["version"] == 4
        and not checkpoint_net_config["card_conditioned_signals"]
    ):
        raise SystemExit("legacy V4 global signal heads are inference-only")
    checkpoint_has_critic = checkpoint.get("critic") is not None
    if checkpoint_has_critic != config.centralized_critic:
        state = "has" if checkpoint_has_critic else "has no"
        raise SystemExit(f"checkpoint {state} critic; resume configuration disagrees")
    saved_contract = checkpoint.get("engine_contract")
    if saved_contract is None:
        return
    current_contract = _engine_contract(config)
    if saved_contract == current_contract:
        return
    saved_config = saved_contract.get("config", {})
    current_config = current_contract["config"]
    changed = [
        field
        for field in sorted(saved_config.keys() | current_config.keys())
        if saved_config.get(field) != current_config.get(field)
    ]
    raise SystemExit("resume configuration differs from checkpoint for: " + ", ".join(changed))


def _engine_contract(config: TrainConfig) -> dict:
    immutable_fields = (
        "num_envs",
        "steps_per_env",
        "win_points",
        "wp_mix",
        "eval_win_points",
        "trick_shaping_coef",
        "signal_honesty_coef",
        "signal_honesty_coef_final",
        "signal_honesty_frac",
        "lr",
        "lr_schedule",
        "gamma",
        "gae_lambda",
        "clip_eps",
        "vf_coef",
        "ent_coef",
        "ent_coef_final",
        "max_grad_norm",
        "num_epochs",
        "minibatch_size",
        "target_kl",
        "normalize_returns",
        "network_version",
        "hidden_size",
        "num_layers",
        "use_layer_norm",
        "d_model",
        "nhead",
        "dim_feedforward",
        "centralized_critic",
        "opponent_pool_size",
        "pool_save_every",
        "p_latest_opponent",
        "balance_learner_teams",
        "total_timesteps",
        "seed",
        "use_curriculum",
        "curriculum_stages",
        "curriculum_confirm_count",
        "eval_every",
        "eval_games",
        "eval_at_start",
    )
    return {
        "format": ENGINE_CONTRACT_FORMAT,
        "config": {field: getattr(config, field) for field in immutable_fields},
    }


def _prepare_critic(
    config: TrainConfig,
    device: torch.device,
    checkpoint: dict | None,
    critic: CentralizedCritic | None,
) -> CentralizedCritic | None:
    if not config.centralized_critic:
        if critic is not None:
            raise ValueError("critic supplied while centralized_critic is disabled")
        return None
    if config.num_envs <= 1:
        raise ValueError("centralized_critic requires num_envs > 1")
    if critic is None:
        critic = CentralizedCritic(
            input_size=FULL_STATE_SIZE,
            hidden_size=config.hidden_size,
            num_layers=config.num_layers,
            use_layer_norm=config.use_layer_norm,
        ).to(device)
    if checkpoint is not None and critic is not None:
        critic.load_state_dict(checkpoint["critic"])
    return critic


def _mean_episode_returns_by_win_points(buffer, env_win_points: list[int]) -> dict[int, float]:
    completed_returns: dict[int, list[float]] = {
        win_points: [] for win_points in sorted(set(env_win_points))
    }
    if not hasattr(buffer, "env_idx"):
        return {win_points: float("nan") for win_points in completed_returns}
    running = np.zeros(len(env_win_points), dtype=np.float64)
    for index in range(buffer.ptr):
        env_index = int(buffer.env_idx[index])
        running[env_index] += float(buffer.rewards[index])
        if buffer.dones[index]:
            completed_returns[env_win_points[env_index]].append(running[env_index])
            running[env_index] = 0.0
    return {
        win_points: float(np.mean(returns)) if returns else float("nan")
        for win_points, returns in completed_returns.items()
    }


def _advance_curriculum(
    config: TrainConfig,
    vec_env,
    single_env,
    *,
    use_vec: bool,
    win_points: int,
    signal_coef: float,
    critic: CentralizedCritic | None,
    normalizer: ReturnNormalizer | None,
):
    if use_vec:
        seed_counts = [
            state["game_count"] for state in snapshot_vec_env_state(vec_env)["env_states"]
        ]
        vec_env.close()
        vec_env = create_vec_env(
            num_envs=config.num_envs,
            seed=config.seed,
            win_points=win_points,
            sync=False,
            trick_shaping_coef=config.trick_shaping_coef,
            signal_honesty_coef=signal_coef,
            include_full_obs=critic is not None,
            initial_game_counts=seed_counts,
        )
        observations, _ = vec_env.reset()
        vec_env._becca_rollout_obs = observations
        vec_env._becca_rollout_carry = []
        if normalizer is not None:
            normalizer.reset_returns()
        return vec_env, single_env, win_points_per_env(config.num_envs, win_points)
    return (
        vec_env,
        BeccaEnv(
            seed=config.seed,
            win_points=win_points,
            trick_shaping_coef=config.trick_shaping_coef,
            signal_honesty_coef=signal_coef,
            include_full_obs=False,
        ),
        [win_points],
    )
