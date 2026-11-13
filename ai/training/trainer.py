"""Pure-PPO adapter over the canonical training engine."""

from __future__ import annotations

import time
from dataclasses import asdict
from pathlib import Path

import torch
from torch.utils.tensorboard import SummaryWriter

from training.checkpoint import load_checkpoint, seed_everything
from training.config import TrainConfig
from training.engine import (
    EvaluationStats,
    TrainingCallbacks,
    TrainingResult,
    UpdateStats,
    run_ppo,
)
from training.network import create_network

__all__ = ["train"]


def train(config: TrainConfig) -> TrainingResult:
    """Build a pure-PPO run and delegate its lifecycle to ``run_ppo``."""
    device = torch.device(config.device)
    Path(config.ckpt_dir).mkdir(parents=True, exist_ok=True)
    seed_everything(config.seed)
    net = create_network(**config.net_kwargs()).to(device)
    anchors = None
    if config.bc_anchor_path:
        anchors = [load_checkpoint(config.bc_anchor_path, map_location=device)["model"]]

    wandb_run = _start_wandb(config)
    run_name = f"ppo_{time.strftime('%Y%m%d_%H%M%S')}"
    writer = SummaryWriter(f"{config.log_dir}/{run_name}")

    def on_update(stats: UpdateStats) -> None:
        metrics = {
            "train/policy_loss": stats.policy_loss,
            "train/value_loss": stats.value_loss,
            "train/entropy": stats.entropy,
            "train/clip_frac": stats.clip_frac,
            "train/approx_kl": stats.approx_kl,
            "train/epochs_used": stats.epochs_used,
            "train/ent_coef": stats.ent_coef,
            "train/signal_honesty_coef": stats.signal_honesty_coef,
            "train/explained_variance": stats.explained_variance,
            "train/learning_rate": stats.learning_rate,
            "rollout/mean_reward": stats.mean_reward,
            "rollout/mean_return": stats.mean_return,
            "rollout/mean_episode_length": stats.mean_episode_length,
            "rollout/games_in_batch": stats.games_in_batch,
            "perf/sps": stats.sps,
            "perf/games_total": stats.games,
            "curriculum/stage": stats.curriculum_stage,
            "curriculum/win_points": stats.win_points,
            "selfplay/pool_size": stats.pool_size,
            "selfplay/opponent_is_pool": 1.0 if stats.opponent_source == "pool" else 0.0,
        }
        for name, value in metrics.items():
            writer.add_scalar(name, value, stats.step)
        if wandb_run:
            import wandb

            wandb.log(metrics, step=stats.step)
        if stats.update % 10 == 0 or stats.update == 1:
            print(
                f"[{stats.update}/{stats.total_updates}] steps={stats.step:,} "
                f"games={stats.games} SPS={stats.sps:.0f} "
                f"PL={stats.policy_loss:.4f} VL={stats.value_loss:.4f} "
                f"E={stats.entropy:.3f} EV={stats.explained_variance:.3f}"
            )

    def on_evaluation(stats: EvaluationStats) -> None:
        writer.add_scalar("eval/vs_random", stats.win_rate_random, stats.step)
        writer.add_scalar("eval/vs_heuristic", stats.win_rate_heuristic, stats.step)
        if wandb_run:
            import wandb

            wandb.log(
                {
                    "eval/vs_random": stats.win_rate_random,
                    "eval/vs_heuristic": stats.win_rate_heuristic,
                },
                step=stats.step,
            )
        print(
            f"  eval: {stats.win_rate_random:.1%} vs random | "
            f"{stats.win_rate_heuristic:.1%} vs heuristic "
            f"(win_points={stats.win_points})"
        )

    parameters = sum(parameter.numel() for parameter in net.parameters())
    print(
        f"PPO self-play | {parameters:,} params | batch={config.batch_size:,} | "
        f"updates={config.total_updates} | device={device}"
    )
    print("-" * 70)

    try:
        result = run_ppo(
            config,
            net,
            anchors=anchors,
            callbacks=TrainingCallbacks(
                on_update=on_update,
                on_evaluation=on_evaluation,
            ),
        )
    finally:
        writer.close()
        if wandb_run:
            import wandb

            wandb.finish()

    print("-" * 70)
    if result.stopped_early:
        print(f"Stopped: update {result.update}, {result.step:,} steps")
    else:
        print(f"Done: {result.step:,} steps, {result.games} games, {result.elapsed_seconds:.0f}s")
    return result


def _start_wandb(config: TrainConfig):
    if not config.use_wandb:
        return None
    try:
        import wandb

        return wandb.init(
            entity=config.wandb_entity,
            project=config.wandb_project,
            name=config.wandb_run_name or f"ppo_{time.strftime('%Y%m%d_%H%M%S')}",
            config=asdict(config),
            resume="allow",
        )
    except Exception as exc:
        print(f"wandb init failed ({exc}), falling back to tensorboard only")
        return None
