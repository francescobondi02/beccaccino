"""Main training loop: self-play PPO for Beccaccino with vectorized envs."""

from __future__ import annotations

import time
from pathlib import Path

import torch
from torch.utils.tensorboard import SummaryWriter

from becca_env.env import BeccaEnv
from training.network import BeccaNet
from training.ppo import ppo_update
from training.rollout import collect_rollout_single, collect_rollout_vec
from training.vec_env import create_vec_env


def train(
    total_timesteps: int = 2_000_000,
    num_envs: int = 8,
    steps_per_env: int = 256,
    learning_rate: float = 3e-4,
    lr_schedule: str = "linear",
    hidden_size: int = 256,
    num_layers: int = 3,
    num_epochs: int = 4,
    minibatch_size: int = 512,
    gamma: float = 0.99,
    lam: float = 0.95,
    clip_eps: float = 0.2,
    vf_coef: float = 0.5,
    ent_coef: float = 0.01,
    max_grad_norm: float = 0.5,
    win_points: int = 41,
    checkpoint_dir: str = "checkpoints",
    checkpoint_every: int = 50,
    eval_every: int = 25,
    eval_games: int = 100,
    log_dir: str = "runs",
    device_name: str = "cpu",
    seed: int = 0,
    sync_envs: bool = False,
):
    """Run PPO self-play training with vectorized environments.

    Args:
        total_timesteps: total environment steps to collect
        num_envs: number of parallel environments
        steps_per_env: steps per env per rollout (batch = num_envs * steps_per_env)
        learning_rate: peak optimizer learning rate
        lr_schedule: "linear" (decay to 0) or "constant"
        hidden_size: network hidden layer width
        num_layers: number of hidden layers
        num_epochs: PPO epochs per update
        minibatch_size: minibatch size for PPO
        gamma: discount factor
        lam: GAE lambda
        clip_eps: PPO clipping epsilon
        vf_coef: value function loss coefficient
        ent_coef: entropy bonus coefficient
        max_grad_norm: gradient clipping norm
        win_points: points to win a game
        checkpoint_dir: where to save model checkpoints
        checkpoint_every: save checkpoint every N updates
        eval_every: evaluate vs random every N updates
        eval_games: number of games per evaluation
        log_dir: TensorBoard log directory
        device_name: "cpu", "cuda", or "mps"
        seed: random seed
        sync_envs: use SyncVectorEnv (no subprocesses, easier to debug)
    """
    device = torch.device(device_name)
    ckpt_path = Path(checkpoint_dir)
    ckpt_path.mkdir(parents=True, exist_ok=True)

    # Network
    net = BeccaNet(hidden_size=hidden_size, num_layers=num_layers).to(device)
    optimizer = torch.optim.Adam(net.parameters(), lr=learning_rate, eps=1e-5)

    # Vectorized env
    batch_size = num_envs * steps_per_env
    total_updates = total_timesteps // batch_size

    if num_envs > 1:
        vec_env = create_vec_env(
            num_envs=num_envs, seed=seed, win_points=win_points, sync=sync_envs
        )
    else:
        single_env = BeccaEnv(seed=seed, win_points=win_points)

    # TensorBoard
    run_name = f"becca_ppo_{time.strftime('%Y%m%d_%H%M%S')}"
    writer = SummaryWriter(log_dir=f"{log_dir}/{run_name}")
    writer.add_text("hyperparams", str({
        "total_timesteps": total_timesteps,
        "num_envs": num_envs,
        "steps_per_env": steps_per_env,
        "batch_size": batch_size,
        "lr": learning_rate,
        "hidden_size": hidden_size,
        "num_layers": num_layers,
        "num_epochs": num_epochs,
        "minibatch_size": minibatch_size,
        "gamma": gamma,
        "lam": lam,
        "clip_eps": clip_eps,
        "win_points": win_points,
        "device": device_name,
    }))

    param_count = sum(p.numel() for p in net.parameters())
    print(f"Training: {total_timesteps:,} steps, batch={batch_size}, "
          f"updates={total_updates}, device={device}")
    print(f"Network: {param_count:,} parameters ({hidden_size}x{num_layers})")
    print(f"Envs: {num_envs} {'sync' if sync_envs else 'async'}, "
          f"win_points={win_points}")
    print(f"Logging to: {log_dir}/{run_name}")
    print("-" * 60)

    timesteps_done = 0
    games_completed = 0
    start_time = time.time()

    for update in range(1, total_updates + 1):
        # Linear LR decay
        if lr_schedule == "linear":
            frac = 1.0 - (update - 1) / total_updates
            for pg in optimizer.param_groups:
                pg["lr"] = learning_rate * frac

        # Collect rollout
        if num_envs > 1:
            buffer = collect_rollout_vec(vec_env, net, steps_per_env, device)
        else:
            buffer = collect_rollout_single(single_env, net, batch_size, device)

        timesteps_done += buffer.ptr
        games_completed += buffer.games_completed

        # PPO update
        batch = buffer.to_tensors(gamma, lam)
        metrics = ppo_update(
            net, optimizer, batch,
            clip_eps=clip_eps,
            vf_coef=vf_coef,
            ent_coef=ent_coef,
            max_grad_norm=max_grad_norm,
            num_epochs=num_epochs,
            minibatch_size=minibatch_size,
            device=device,
        )

        # TensorBoard logging
        writer.add_scalar("train/policy_loss", metrics["policy_loss"], timesteps_done)
        writer.add_scalar("train/value_loss", metrics["value_loss"], timesteps_done)
        writer.add_scalar("train/entropy", metrics["entropy"], timesteps_done)
        writer.add_scalar("train/clip_fraction", metrics["clip_fraction"], timesteps_done)
        writer.add_scalar("train/learning_rate", optimizer.param_groups[0]["lr"], timesteps_done)
        writer.add_scalar("perf/games_completed", games_completed, timesteps_done)

        elapsed = time.time() - start_time
        sps = timesteps_done / elapsed
        writer.add_scalar("perf/steps_per_second", sps, timesteps_done)

        # Console logging
        if update % 10 == 0 or update == 1:
            print(
                f"[{update}/{total_updates}] "
                f"steps={timesteps_done:,} | "
                f"games={games_completed} | "
                f"SPS={sps:.0f} | "
                f"PL={metrics['policy_loss']:.4f} | "
                f"VL={metrics['value_loss']:.4f} | "
                f"Ent={metrics['entropy']:.3f} | "
                f"Clip={metrics['clip_fraction']:.3f}"
            )

        # Evaluation
        if update % eval_every == 0:
            winrate = _evaluate(net, device, eval_games, seed + update * 1000)
            writer.add_scalar("eval/winrate_vs_random", winrate, timesteps_done)
            print(f"  -> Eval: {winrate:.1%} win rate vs random")

        # Checkpoint
        if update % checkpoint_every == 0:
            path = ckpt_path / f"becca_ppo_{update:06d}.pt"
            _save_checkpoint(path, net, optimizer, update, timesteps_done, games_completed)
            print(f"  -> Saved: {path.name}")

    # Final save
    final_path = ckpt_path / "becca_ppo_final.pt"
    _save_checkpoint(final_path, net, optimizer, total_updates, timesteps_done, games_completed)

    # Final eval
    winrate = _evaluate(net, device, eval_games * 2, seed + 999999)
    writer.add_scalar("eval/winrate_vs_random", winrate, timesteps_done)

    writer.close()
    if num_envs > 1:
        vec_env.close()

    elapsed = time.time() - start_time
    print("-" * 60)
    print(f"Done: {timesteps_done:,} steps, {games_completed} games, {elapsed:.1f}s")
    print(f"Final win rate vs random: {winrate:.1%}")
    print(f"Checkpoint: {final_path}")
    print(f"TensorBoard: tensorboard --logdir {log_dir}")


def _evaluate(
    net: BeccaNet, device: torch.device, num_games: int, seed: int
) -> float:
    """Quick evaluation against random baseline."""
    from evaluation.arena import evaluate_against_random
    return evaluate_against_random(net, num_games=num_games, device=device, seed=seed)


def _save_checkpoint(path, net, optimizer, update, timesteps, games):
    torch.save({
        "model_state_dict": net.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "update": update,
        "timesteps": timesteps,
        "games": games,
    }, path)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train Beccaccino AI via PPO self-play")
    parser.add_argument("--steps", type=int, default=2_000_000,
                        help="Total environment steps")
    parser.add_argument("--num-envs", type=int, default=8,
                        help="Parallel environments")
    parser.add_argument("--steps-per-env", type=int, default=256,
                        help="Steps per env per rollout")
    parser.add_argument("--lr", type=float, default=3e-4,
                        help="Learning rate")
    parser.add_argument("--lr-schedule", choices=["linear", "constant"], default="linear")
    parser.add_argument("--hidden", type=int, default=256,
                        help="Hidden layer size")
    parser.add_argument("--layers", type=int, default=3,
                        help="Number of hidden layers")
    parser.add_argument("--epochs", type=int, default=4,
                        help="PPO epochs per update")
    parser.add_argument("--batch-size", type=int, default=512,
                        help="Minibatch size")
    parser.add_argument("--win-points", type=int, default=41,
                        help="Points to win a game")
    parser.add_argument("--device", type=str, default="cpu",
                        help="Device: cpu, cuda, mps")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints")
    parser.add_argument("--log-dir", type=str, default="runs")
    parser.add_argument("--eval-every", type=int, default=25,
                        help="Evaluate every N updates")
    parser.add_argument("--eval-games", type=int, default=100)
    parser.add_argument("--checkpoint-every", type=int, default=50)
    parser.add_argument("--sync-envs", action="store_true",
                        help="Use synchronous envs (no subprocesses)")
    args = parser.parse_args()

    train(
        total_timesteps=args.steps,
        num_envs=args.num_envs,
        steps_per_env=args.steps_per_env,
        learning_rate=args.lr,
        lr_schedule=args.lr_schedule,
        hidden_size=args.hidden,
        num_layers=args.layers,
        num_epochs=args.epochs,
        minibatch_size=args.batch_size,
        win_points=args.win_points,
        device_name=args.device,
        seed=args.seed,
        checkpoint_dir=args.checkpoint_dir,
        log_dir=args.log_dir,
        eval_every=args.eval_every,
        eval_games=args.eval_games,
        checkpoint_every=args.checkpoint_every,
        sync_envs=args.sync_envs,
    )
