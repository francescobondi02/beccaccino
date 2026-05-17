"""Main training loop: self-play PPO for Beccaccino."""

from __future__ import annotations

import time
from pathlib import Path

import torch

from becca_env.env import BeccaEnv
from training.network import BeccaNet
from training.ppo import ppo_update
from training.rollout import collect_self_play_rollout


def train(
    total_timesteps: int = 1_000_000,
    rollout_steps: int = 2048,
    learning_rate: float = 3e-4,
    hidden_size: int = 256,
    num_layers: int = 3,
    num_epochs: int = 4,
    minibatch_size: int = 256,
    gamma: float = 0.99,
    lam: float = 0.95,
    clip_eps: float = 0.2,
    vf_coef: float = 0.5,
    ent_coef: float = 0.01,
    max_grad_norm: float = 0.5,
    win_points: int = 41,
    checkpoint_dir: str = "checkpoints",
    checkpoint_every: int = 50,
    log_every: int = 10,
    device_name: str = "cpu",
    seed: int = 0,
):
    """Run PPO self-play training.

    Args:
        total_timesteps: total environment steps to collect
        rollout_steps: steps per rollout before each PPO update
        learning_rate: optimizer learning rate
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
        log_every: print stats every N updates
        device_name: "cpu", "cuda", or "mps"
        seed: random seed
    """
    device = torch.device(device_name)
    ckpt_path = Path(checkpoint_dir)
    ckpt_path.mkdir(parents=True, exist_ok=True)

    net = BeccaNet(hidden_size=hidden_size, num_layers=num_layers).to(device)
    optimizer = torch.optim.Adam(net.parameters(), lr=learning_rate, eps=1e-5)

    env = BeccaEnv(seed=seed, win_points=win_points)

    total_updates = total_timesteps // rollout_steps
    timesteps_done = 0
    games_completed = 0
    start_time = time.time()

    print(f"Training config: {total_timesteps} steps, {rollout_steps}/rollout, device={device}")
    print(f"Network: {sum(p.numel() for p in net.parameters()):,} parameters")
    print(f"Win threshold: {win_points} points")
    print("-" * 60)

    for update in range(1, total_updates + 1):
        # Collect rollout
        buffer = collect_self_play_rollout(env, net, rollout_steps, device)
        timesteps_done += len(buffer)

        # Count completed games in this rollout
        games_in_rollout = sum(1 for t in buffer.transitions if t.done)
        games_completed += games_in_rollout

        # PPO update
        batch = buffer.to_tensors()
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
        buffer.clear()

        # Logging
        if update % log_every == 0:
            elapsed = time.time() - start_time
            sps = timesteps_done / elapsed
            print(
                f"Update {update}/{total_updates} | "
                f"Steps: {timesteps_done:,} | "
                f"Games: {games_completed} | "
                f"SPS: {sps:.0f} | "
                f"PL: {metrics['policy_loss']:.4f} | "
                f"VL: {metrics['value_loss']:.4f} | "
                f"Ent: {metrics['entropy']:.3f} | "
                f"Clip: {metrics['clip_fraction']:.3f}"
            )

        # Checkpoint
        if update % checkpoint_every == 0:
            path = ckpt_path / f"becca_ppo_{update:06d}.pt"
            torch.save({
                "model_state_dict": net.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "update": update,
                "timesteps": timesteps_done,
                "games": games_completed,
            }, path)
            print(f"  Saved checkpoint: {path}")

    # Final save
    final_path = ckpt_path / "becca_ppo_final.pt"
    torch.save({
        "model_state_dict": net.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "update": total_updates,
        "timesteps": timesteps_done,
        "games": games_completed,
    }, final_path)

    elapsed = time.time() - start_time
    print("-" * 60)
    print(f"Training complete: {timesteps_done:,} steps, {games_completed} games, {elapsed:.1f}s")
    print(f"Final checkpoint: {final_path}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train Beccaccino AI via PPO self-play")
    parser.add_argument("--steps", type=int, default=1_000_000)
    parser.add_argument("--rollout-steps", type=int, default=2048)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--layers", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--win-points", type=int, default=41)
    parser.add_argument("--device", type=str, default="cpu")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints")
    args = parser.parse_args()

    train(
        total_timesteps=args.steps,
        rollout_steps=args.rollout_steps,
        learning_rate=args.lr,
        hidden_size=args.hidden,
        num_layers=args.layers,
        num_epochs=args.epochs,
        minibatch_size=args.batch_size,
        win_points=args.win_points,
        device_name=args.device,
        seed=args.seed,
        checkpoint_dir=args.checkpoint_dir,
    )
