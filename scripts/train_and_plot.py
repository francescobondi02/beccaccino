"""End-to-end demo: train a fresh agent under the new pipeline, log per-update
metrics to a CSV, then plot eval curves vs both random and the heuristic
baseline.

This is a SHORTER training run than the production curriculum — sized to
finish in ~10-15 minutes on a laptop while still showing meaningful learning.

Usage:
    python -m scripts.train_and_plot \\
        --total-steps 1500000 --num-envs 8 --device mps

Outputs:
  - runs/demo/metrics.csv      per-update training & eval metrics
  - runs/demo/learning_curve.png   eval-vs-{random,heuristic} over steps
  - checkpoints/demo_final.pt
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

import numpy as np
import torch

from becca_env.env import BeccaEnv  # noqa: F401  triggers env registration
from evaluation.arena import evaluate_against_random
from evaluation.heuristic import evaluate_against_heuristic
from training.config import TrainConfig
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import create_network
from training.normalization import ReturnNormalizer
from training.ppo import ppo_update
from training.self_play import OpponentPool
from training.vec_env import create_vec_env


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--total-steps", type=int, default=1_500_000)
    p.add_argument("--num-envs", type=int, default=8)
    p.add_argument("--steps-per-env", type=int, default=512)
    p.add_argument(
        "--win-points", type=int, default=11, help="win_points used during TRAINING rollouts."
    )
    p.add_argument(
        "--eval-win-points",
        type=int,
        default=None,
        help="win_points used in eval matches. Defaults to --win-points. "
        "Set higher (e.g. 41) to evaluate at full game length even "
        "when training short.",
    )
    p.add_argument("--device", default="cpu")
    p.add_argument("--lr", type=float, default=2.5e-4)
    p.add_argument("--ent-coef", type=float, default=0.03)
    p.add_argument("--ent-coef-final", type=float, default=0.005)
    p.add_argument("--p-latest-opponent", type=float, default=0.5)
    p.add_argument("--eval-every", type=int, default=10)
    p.add_argument("--eval-games", type=int, default=80)
    p.add_argument("--pool-save-every", type=int, default=20)
    p.add_argument("--out-dir", default="runs/demo")
    p.add_argument("--ckpt-path", default="checkpoints/demo_final.pt")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--hidden", type=int, default=384)
    p.add_argument("--layers", type=int, default=3)
    return p.parse_args()


def main():
    args = parse_args()
    eval_wp = args.eval_win_points if args.eval_win_points is not None else args.win_points
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "metrics.csv"

    cfg = TrainConfig(
        num_envs=args.num_envs,
        steps_per_env=args.steps_per_env,
        win_points=args.win_points,
        lr=args.lr,
        ent_coef=args.ent_coef,
        ent_coef_final=args.ent_coef_final,
        hidden_size=args.hidden,
        num_layers=args.layers,
        total_timesteps=args.total_steps,
        device=args.device,
        seed=args.seed,
        p_latest_opponent=args.p_latest_opponent,
        use_wandb=False,
    )

    dev = torch.device(cfg.device)

    net = create_network(
        version=cfg.network_version,
        hidden_size=cfg.hidden_size,
        num_layers=cfg.num_layers,
        use_layer_norm=cfg.use_layer_norm,
    ).to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=cfg.lr, eps=1e-5)

    opponent_net = create_network(
        version=cfg.network_version,
        hidden_size=cfg.hidden_size,
        num_layers=cfg.num_layers,
        use_layer_norm=cfg.use_layer_norm,
    ).to(dev)
    opponent_net.load_state_dict(net.state_dict())

    vec = create_vec_env(
        num_envs=cfg.num_envs,
        seed=cfg.seed,
        win_points=cfg.win_points,
        sync=False,
        trick_shaping_coef=cfg.trick_shaping_coef,
    )

    learner_team_per_env = np.array([i % 2 for i in range(cfg.num_envs)], dtype=np.int64)
    pool = OpponentPool(max_size=cfg.opponent_pool_size)
    return_normalizer = ReturnNormalizer(gamma=cfg.gamma) if cfg.normalize_returns else None

    # CSV header
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "update",
                "steps",
                "games",
                "sps",
                "policy_loss",
                "value_loss",
                "entropy",
                "approx_kl",
                "explained_variance",
                "mean_reward",
                "opponent_source",
                "wr_random",
                "wr_heuristic",
            ]
        )

    n_params = sum(p.numel() for p in net.parameters())
    print(f"# params: {n_params:,}  | device: {dev}  | win_points: {cfg.win_points}")
    print(f"# batch: {cfg.batch_size:,}  | total updates: {cfg.total_updates}")

    step_count = 0
    games_total = 0
    t0 = time.time()
    last_wr_random = float("nan")
    last_wr_heur = float("nan")

    for update in range(1, cfg.total_updates + 1):
        # entropy + lr schedules
        frac = (update - 1) / max(cfg.total_updates - 1, 1)
        ent_coef = cfg.ent_coef + (cfg.ent_coef_final - cfg.ent_coef) * frac
        cos = 0.5 * (1 + np.cos(np.pi * frac))
        lr_now = cfg.lr * max(cos, 0.1)
        for pg in opt.param_groups:
            pg["lr"] = lr_now

        # Pick opponent
        sampled = pool.sample(p_latest=cfg.p_latest_opponent)
        if sampled is None:
            opponent_net.load_state_dict(net.state_dict())
            opp_source = "latest"
        else:
            opponent_net.load_state_dict(sampled)
            opp_source = "pool"

        buf = collect_self_play_rollout_vec(
            vec,
            net,
            opponent_net,
            learner_team_per_env,
            cfg.steps_per_env,
            dev,
        )
        step_count += buf.ptr
        games_total += buf.games_done

        batch = buf.get_batch(
            gamma=cfg.gamma, lam=cfg.gae_lambda, return_normalizer=return_normalizer
        )
        m = ppo_update(
            net,
            opt,
            batch,
            clip_eps=cfg.clip_eps,
            vf_coef=cfg.vf_coef,
            ent_coef=ent_coef,
            max_grad_norm=cfg.max_grad_norm,
            num_epochs=cfg.num_epochs,
            minibatch_size=cfg.minibatch_size,
            target_kl=cfg.target_kl,
            device=dev,
        )

        with torch.no_grad():
            vals = batch["values"].numpy()
            rets = batch["returns"].numpy()
            var_ret = rets.var()
            ev = (1 - (rets - vals).var() / (var_ret + 1e-8)) if var_ret > 0 else 0.0
        sps = step_count / (time.time() - t0)
        mean_reward = float(buf.rewards[: buf.ptr].mean())

        # Add to pool periodically
        if update % args.pool_save_every == 0:
            pool.add_policy(net.state_dict())

        # Eval
        if update % args.eval_every == 0 or update == 1:
            last_wr_random = evaluate_against_random(
                net, num_games=args.eval_games, device=dev, seed=cfg.seed + update
            )
            last_wr_heur = evaluate_against_heuristic(
                net,
                num_games=args.eval_games,
                device=dev,
                seed=cfg.seed + update,
                win_points=eval_wp,
            )

        # Persist
        with csv_path.open("a", newline="") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    update,
                    step_count,
                    games_total,
                    f"{sps:.0f}",
                    f"{m['policy_loss']:.5f}",
                    f"{m['value_loss']:.5f}",
                    f"{m['entropy']:.4f}",
                    f"{m['approx_kl']:.5f}",
                    f"{ev:.4f}",
                    f"{mean_reward:.4f}",
                    opp_source,
                    f"{last_wr_random:.4f}",
                    f"{last_wr_heur:.4f}",
                ]
            )

        if update % args.eval_every == 0 or update == 1:
            print(
                f"[{update:4d}/{cfg.total_updates}] steps={step_count:>9,} "
                f"sps={sps:5.0f} kl={m['approx_kl']:.4f} ev={ev:+.2f} "
                f"R̄={mean_reward:+.3f} pool={opp_source:>6} | "
                f"vs_rand={last_wr_random:.1%} vs_heur={last_wr_heur:.1%}"
            )

    # Save final checkpoint
    Path(args.ckpt_path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": net.state_dict(),
            "config": {
                "hidden_size": cfg.hidden_size,
                "num_layers": cfg.num_layers,
                "network_version": cfg.network_version,
                "use_layer_norm": cfg.use_layer_norm,
                "win_points": cfg.win_points,
            },
            "steps": step_count,
            "updates": cfg.total_updates,
        },
        args.ckpt_path,
    )
    print(f"Saved checkpoint to {args.ckpt_path}")

    vec.close()

    # Plot
    plot_curve(csv_path, out / "learning_curve.png")
    print(f"Saved plot to {out / 'learning_curve.png'}")


def plot_curve(csv_path: Path, out_path: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    steps, wr_r, wr_h, ent, kl, ev = [], [], [], [], [], []
    with csv_path.open() as f:
        r = csv.DictReader(f)
        for row in r:
            steps.append(int(row["steps"]))
            wr_r.append(float(row["wr_random"]))
            wr_h.append(float(row["wr_heuristic"]))
            ent.append(float(row["entropy"]))
            kl.append(float(row["approx_kl"]))
            ev.append(float(row["explained_variance"]))

    fig, axes = plt.subplots(2, 2, figsize=(12, 8))

    axes[0, 0].plot(steps, wr_r, label="vs random", color="tab:blue")
    axes[0, 0].plot(steps, wr_h, label="vs heuristic", color="tab:orange")
    axes[0, 0].axhline(0.5, color="grey", linestyle=":", alpha=0.5)
    axes[0, 0].set_ylim(0, 1)
    axes[0, 0].set_xlabel("env steps")
    axes[0, 0].set_ylabel("win rate")
    axes[0, 0].set_title("Eval win rates")
    axes[0, 0].legend()
    axes[0, 0].grid(alpha=0.3)

    axes[0, 1].plot(steps, ent, color="tab:green")
    axes[0, 1].set_xlabel("env steps")
    axes[0, 1].set_ylabel("entropy")
    axes[0, 1].set_title("Policy entropy (annealed)")
    axes[0, 1].grid(alpha=0.3)

    axes[1, 0].plot(steps, kl, color="tab:red")
    axes[1, 0].set_xlabel("env steps")
    axes[1, 0].set_ylabel("approx KL")
    axes[1, 0].set_title("PPO approx KL per update")
    axes[1, 0].grid(alpha=0.3)

    axes[1, 1].plot(steps, ev, color="tab:purple")
    axes[1, 1].set_xlabel("env steps")
    axes[1, 1].set_ylabel("explained variance")
    axes[1, 1].set_title("Value-fn explained variance")
    axes[1, 1].axhline(0.0, color="grey", linestyle=":", alpha=0.5)
    axes[1, 1].grid(alpha=0.3)

    fig.suptitle("Beccaccino RL — learning curves")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    main()
