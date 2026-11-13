"""CLI adapter for pure PPO training."""

from __future__ import annotations

import argparse

from training.config import TrainConfig
from training.trainer import train


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train Beccaccino AI via PPO self-play")
    parser.add_argument("--steps", type=int, default=100_000_000)
    parser.add_argument("--num-envs", type=int, default=64)
    parser.add_argument("--steps-per-env", type=int, default=512)
    parser.add_argument("--lr", type=float, default=2.5e-4)
    parser.add_argument("--lr-schedule", choices=["constant", "linear", "cosine"], default="cosine")
    parser.add_argument("--hidden", type=int, default=512)
    parser.add_argument("--layers", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--minibatch", type=int, default=2048)
    parser.add_argument("--gamma", type=float, default=0.995)
    parser.add_argument("--gae-lambda", type=float, default=0.95)
    parser.add_argument("--ent-coef", type=float, default=0.03)
    parser.add_argument("--ent-coef-final", type=float, default=0.005)
    parser.add_argument("--win-points", type=int, default=41)
    parser.add_argument("--trick-shaping-coef", type=float, default=0.0)
    parser.add_argument("--signal-honesty-coef", type=float, default=0.0)
    parser.add_argument("--signal-honesty-coef-final", type=float, default=0.0)
    parser.add_argument("--signal-honesty-frac", type=float, default=0.5)
    parser.add_argument("--p-latest-opponent", type=float, default=0.5)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--eval-every", type=int, default=25)
    parser.add_argument("--eval-games", type=int, default=200)
    parser.add_argument("--ckpt-every", type=int, default=50)
    parser.add_argument("--ckpt-dir", default="checkpoints")
    parser.add_argument("--log-dir", default="runs")
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--curriculum", action="store_true")
    parser.add_argument("--no-wandb", action="store_true")
    parser.add_argument("--wandb-entity", default="francesco-bondi02-eth-z-rich")
    parser.add_argument("--wandb-project", default="BECCACCINO-RL")
    parser.add_argument("--network-version", type=int, default=2, choices=[1, 2, 3, 4])
    parser.add_argument("--d-model", type=int, default=128)
    parser.add_argument("--nhead", type=int, default=4)
    parser.add_argument("--dim-feedforward", type=int, default=256)
    parser.add_argument("--max-hours", type=float, default=None)
    return parser


def config_from_args(args: argparse.Namespace) -> TrainConfig:
    return TrainConfig(
        total_timesteps=args.steps,
        num_envs=args.num_envs,
        steps_per_env=args.steps_per_env,
        lr=args.lr,
        lr_schedule=args.lr_schedule,
        hidden_size=args.hidden,
        num_layers=args.layers,
        num_epochs=args.epochs,
        minibatch_size=args.minibatch,
        gamma=args.gamma,
        gae_lambda=args.gae_lambda,
        ent_coef=args.ent_coef,
        ent_coef_final=args.ent_coef_final,
        win_points=args.win_points,
        trick_shaping_coef=args.trick_shaping_coef,
        signal_honesty_coef=args.signal_honesty_coef,
        signal_honesty_coef_final=args.signal_honesty_coef_final,
        signal_honesty_frac=args.signal_honesty_frac,
        p_latest_opponent=args.p_latest_opponent,
        device=args.device,
        seed=args.seed,
        eval_every=args.eval_every,
        eval_games=args.eval_games,
        ckpt_every=args.ckpt_every,
        ckpt_dir=args.ckpt_dir,
        log_dir=args.log_dir,
        resume_from=args.resume,
        use_curriculum=args.curriculum,
        use_wandb=not args.no_wandb,
        wandb_entity=args.wandb_entity,
        wandb_project=args.wandb_project,
        network_version=args.network_version,
        d_model=args.d_model,
        nhead=args.nhead,
        dim_feedforward=args.dim_feedforward,
        max_hours=args.max_hours,
    )


def main(argv: list[str] | None = None) -> None:
    train(config_from_args(build_parser().parse_args(argv)))


if __name__ == "__main__":
    main()
