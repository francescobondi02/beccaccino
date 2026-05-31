"""PPO self-play trainer for Beccaccino (v2).

Integrates: per-seat GAE, BeccaNetV2, opponent pool, curriculum, wandb logging,
entropy annealing, checkpoint resume.
"""

from __future__ import annotations

import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch
from torch.utils.tensorboard import SummaryWriter

from becca_env.env import BeccaEnv
from training.config import TrainConfig
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import create_network
from training.normalization import ReturnNormalizer
from training.ppo import ppo_update
from training.rollout import collect_rollout
from training.self_play import OpponentPool
from training.vec_env import create_vec_env


def _ent_coef_schedule(config: TrainConfig, update: int) -> float:
    """Linear annealing from ent_coef to ent_coef_final."""
    frac = (update - 1) / max(config.total_updates - 1, 1)
    return config.ent_coef + (config.ent_coef_final - config.ent_coef) * frac


def _lr_schedule(config: TrainConfig, optimizer: torch.optim.Optimizer, update: int):
    """Apply learning rate schedule."""
    if config.lr_schedule == "linear":
        frac = 1.0 - (update - 1) / config.total_updates
        new_lr = config.lr * frac
    elif config.lr_schedule == "cosine":
        import math
        frac = 0.5 * (1 + math.cos(math.pi * (update - 1) / config.total_updates))
        new_lr = config.lr * max(frac, 0.1)
    else:
        return
    for pg in optimizer.param_groups:
        pg["lr"] = new_lr


def train(config: TrainConfig):
    dev = torch.device(config.device)
    Path(config.ckpt_dir).mkdir(parents=True, exist_ok=True)

    # Network
    net = create_network(
        version=config.network_version,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        use_layer_norm=config.use_layer_norm,
    ).to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=config.lr, eps=1e-5)

    # Resume from checkpoint
    start_update = 1
    step_count = 0
    game_count = 0
    curriculum_stage = 0
    if config.resume_from:
        ckpt = torch.load(config.resume_from, map_location=dev, weights_only=False)
        net.load_state_dict(ckpt["model"])
        opt.load_state_dict(ckpt["optimizer"])
        start_update = ckpt.get("update", 0) + 1
        step_count = ckpt.get("steps", 0)
        game_count = ckpt.get("games", 0)
        curriculum_stage = ckpt.get("curriculum_stage", 0)
        print(f"Resumed from {config.resume_from} (update {start_update}, {step_count:,} steps)")

    # Curriculum
    win_points = config.win_points
    if config.use_curriculum and config.curriculum_stages:
        win_points = config.curriculum_stages[curriculum_stage]["win_points"]

    # Environment
    use_vec = config.num_envs > 1
    if use_vec:
        vec_env = create_vec_env(
            num_envs=config.num_envs, seed=config.seed, win_points=win_points, sync=False,
            trick_shaping_coef=config.trick_shaping_coef,
        )
    else:
        single_env = BeccaEnv(seed=config.seed, win_points=win_points,
                              trick_shaping_coef=config.trick_shaping_coef)

    # Opponent pool + a frozen opponent net we reload on each rollout
    pool = OpponentPool(max_size=config.opponent_pool_size)
    opponent_net = create_network(
        version=config.network_version,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        use_layer_norm=config.use_layer_norm,
    ).to(dev)
    opponent_net.load_state_dict(net.state_dict())  # start as a copy of learner

    # Reward / return normalizer (kept across rollouts so the running std
    # converges to a stable estimate)
    return_normalizer = ReturnNormalizer(gamma=config.gamma) if config.normalize_returns else None

    # Per-env learner team assignment (balanced)
    if config.balance_learner_teams and use_vec:
        learner_team_per_env = np.array(
            [i % 2 for i in range(config.num_envs)], dtype=np.int64
        )
    else:
        learner_team_per_env = np.zeros(config.num_envs, dtype=np.int64)

    # Logging
    wandb_run = None
    if config.use_wandb:
        try:
            import wandb
            wandb_run = wandb.init(
                entity=config.wandb_entity,
                project=config.wandb_project,
                name=config.wandb_run_name or f"ppo_{time.strftime('%Y%m%d_%H%M%S')}",
                config=asdict(config),
                resume="allow",
            )
        except Exception as e:
            print(f"wandb init failed ({e}), falling back to tensorboard only")

    run_name = f"ppo_{time.strftime('%Y%m%d_%H%M%S')}"
    writer = SummaryWriter(f"{config.log_dir}/{run_name}")

    params = sum(p.numel() for p in net.parameters())
    print(f"PPO self-play v2 | {params:,} params | batch={config.batch_size:,} | "
          f"updates={config.total_updates} | device={dev} | win_points={win_points}")
    print("-" * 70)

    t0 = time.time()
    curriculum_confirm = 0

    for update in range(start_update, config.total_updates + 1):
        # Schedules
        _lr_schedule(config, opt, update)
        ent_coef = _ent_coef_schedule(config, update)

        # Pick opponent for this rollout. p_latest -> use current learner
        # (vanilla self-play); else sample a frozen historical policy.
        if use_vec:
            sampled = pool.sample(p_latest=config.p_latest_opponent)
            if sampled is None:
                opponent_net.load_state_dict(net.state_dict())
                opponent_source = "latest"
            else:
                opponent_net.load_state_dict(sampled)
                opponent_source = "pool"
            buf = collect_self_play_rollout_vec(
                vec_env, net, opponent_net, learner_team_per_env,
                config.steps_per_env, dev,
            )
        else:
            buf = collect_rollout(single_env, net, config.batch_size, dev)
            opponent_source = "self"

        step_count += buf.ptr
        game_count += buf.games_done

        # PPO update with per-seat GAE; rewards normalized in-flight for stability.
        batch = buf.get_batch(gamma=config.gamma, lam=config.gae_lambda,
                              return_normalizer=return_normalizer)
        m = ppo_update(
            net, opt, batch,
            clip_eps=config.clip_eps,
            vf_coef=config.vf_coef,
            ent_coef=ent_coef,
            max_grad_norm=config.max_grad_norm,
            num_epochs=config.num_epochs,
            minibatch_size=config.minibatch_size,
            target_kl=config.target_kl,
            device=dev,
        )

        # Explained variance
        with torch.no_grad():
            vals = batch["values"].numpy()
            rets = batch["returns"].numpy()
            var_ret = rets.var()
            explained_var = 1 - (rets - vals).var() / (var_ret + 1e-8) if var_ret > 0 else 0.0

        # Rollout statistics
        n = buf.ptr
        mean_reward = float(buf.rewards[:n].mean())
        mean_return = float(rets.mean())
        mean_ep_len = n / max(buf.games_done, 1)
        current_lr = opt.param_groups[0]["lr"]

        # Log metrics
        sps = step_count / (time.time() - t0)
        metrics = {
            "train/policy_loss": m["policy_loss"],
            "train/value_loss": m["value_loss"],
            "train/entropy": m["entropy"],
            "train/clip_frac": m["clip_frac"],
            "train/approx_kl": m["approx_kl"],
            "train/epochs_used": m["epochs_used"],
            "train/ent_coef": ent_coef,
            "train/explained_variance": explained_var,
            "train/learning_rate": current_lr,
            "rollout/mean_reward": mean_reward,
            "rollout/mean_return": mean_return,
            "rollout/mean_episode_length": mean_ep_len,
            "rollout/games_in_batch": buf.games_done,
            "perf/sps": sps,
            "perf/games_total": game_count,
            "curriculum/stage": curriculum_stage,
            "curriculum/win_points": win_points,
            "selfplay/pool_size": len(pool),
            "selfplay/opponent_is_pool": 1.0 if opponent_source == "pool" else 0.0,
        }

        for k, v in metrics.items():
            writer.add_scalar(k, v, step_count)
        if wandb_run:
            import wandb
            wandb.log(metrics, step=step_count)

        if update % 10 == 0 or update == start_update:
            print(
                f"[{update}/{config.total_updates}] steps={step_count:,} games={game_count} "
                f"SPS={sps:.0f} PL={m['policy_loss']:.4f} VL={m['value_loss']:.4f} "
                f"E={m['entropy']:.3f} EV={explained_var:.3f}"
            )

        # Save to opponent pool
        if update % config.pool_save_every == 0:
            pool.add_policy(net.state_dict())

        # Evaluation
        if update % config.eval_every == 0:
            from evaluation.arena import evaluate_against_random
            from evaluation.heuristic import evaluate_against_heuristic
            wr = evaluate_against_random(net, num_games=config.eval_games, device=dev,
                                         seed=config.seed + update)
            eval_wp = config.eval_win_points if config.eval_win_points is not None else win_points
            wr_h = evaluate_against_heuristic(net, num_games=config.eval_games, device=dev,
                                              seed=config.seed + update,
                                              win_points=eval_wp)
            writer.add_scalar("eval/vs_random", wr, step_count)
            writer.add_scalar("eval/vs_heuristic", wr_h, step_count)
            if wandb_run:
                import wandb
                wandb.log({"eval/vs_random": wr, "eval/vs_heuristic": wr_h}, step=step_count)
            print(f"  eval: {wr:.1%} vs random | {wr_h:.1%} vs heuristic "
                  f"(win_points={win_points})")

            # Curriculum advancement
            if config.use_curriculum and curriculum_stage < len(config.curriculum_stages) - 1:
                stage = config.curriculum_stages[curriculum_stage]
                if wr >= stage["min_wr"]:
                    curriculum_confirm += 1
                    if curriculum_confirm >= config.curriculum_confirm_count:
                        curriculum_stage += 1
                        curriculum_confirm = 0
                        new_wp = config.curriculum_stages[curriculum_stage]["win_points"]
                        print(f"  CURRICULUM: advancing to stage {curriculum_stage} "
                              f"(win_points={new_wp})")
                        win_points = new_wp
                        if use_vec:
                            vec_env.close()
                            vec_env = create_vec_env(
                                num_envs=config.num_envs, seed=config.seed,
                                win_points=win_points, sync=False,
                                trick_shaping_coef=config.trick_shaping_coef,
                            )
                        else:
                            single_env = BeccaEnv(
                                seed=config.seed, win_points=win_points,
                                trick_shaping_coef=config.trick_shaping_coef,
                            )
                else:
                    curriculum_confirm = 0

        # Checkpoint
        if update % config.ckpt_every == 0:
            p = Path(config.ckpt_dir) / f"ckpt_{update:06d}.pt"
            torch.save({
                "model": net.state_dict(),
                "optimizer": opt.state_dict(),
                "update": update,
                "steps": step_count,
                "games": game_count,
                "curriculum_stage": curriculum_stage,
                "config": asdict(config),
            }, p)
            print(f"  saved: {p.name}")

    # Final save
    fp = Path(config.ckpt_dir) / "final.pt"
    torch.save({
        "model": net.state_dict(),
        "optimizer": opt.state_dict(),
        "update": config.total_updates,
        "steps": step_count,
        "games": game_count,
        "curriculum_stage": curriculum_stage,
        "config": asdict(config),
    }, fp)

    from evaluation.arena import evaluate_against_random
    wr = evaluate_against_random(net, num_games=config.eval_games * 2, device=dev, seed=99999)
    writer.add_scalar("eval/vs_random", wr, step_count)
    writer.close()
    if use_vec:
        vec_env.close()
    if wandb_run:
        import wandb
        wandb.log({"eval/vs_random_final": wr}, step=step_count)
        wandb.finish()

    elapsed = time.time() - t0
    print("-" * 70)
    print(f"Done: {step_count:,} steps, {game_count} games, {elapsed:.0f}s")
    print(f"Final: {wr:.1%} vs random | {fp}")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Train Beccaccino AI via PPO self-play")
    p.add_argument("--steps", type=int, default=100_000_000)
    p.add_argument("--num-envs", type=int, default=64)
    p.add_argument("--steps-per-env", type=int, default=512)
    p.add_argument("--lr", type=float, default=2.5e-4)
    p.add_argument("--lr-schedule", choices=["constant", "linear", "cosine"], default="cosine")
    p.add_argument("--hidden", type=int, default=512)
    p.add_argument("--layers", type=int, default=3)
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--minibatch", type=int, default=2048)
    p.add_argument("--gamma", type=float, default=0.995)
    p.add_argument("--gae-lambda", type=float, default=0.95)
    p.add_argument("--ent-coef", type=float, default=0.03)
    p.add_argument("--ent-coef-final", type=float, default=0.005)
    p.add_argument("--win-points", type=int, default=41)
    p.add_argument("--trick-shaping-coef", type=float, default=0.0,
                   help="0.0 = round-end only (default). >0 adds biased per-trick "
                        "shaping; only useful as a curriculum hint.")
    p.add_argument("--p-latest-opponent", type=float, default=0.5,
                   help="Probability that opponent is current learner (vanilla "
                        "self-play). 1-p draws from historical opponent pool.")
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-every", type=int, default=25)
    p.add_argument("--eval-games", type=int, default=200)
    p.add_argument("--ckpt-every", type=int, default=50)
    p.add_argument("--ckpt-dir", default="checkpoints")
    p.add_argument("--log-dir", default="runs")
    p.add_argument("--resume", type=str, default=None)
    p.add_argument("--curriculum", action="store_true")
    p.add_argument("--no-wandb", action="store_true")
    p.add_argument("--wandb-entity", default="francesco-bondi02-eth-z-rich")
    p.add_argument("--wandb-project", default="BECCACCINO-RL")
    p.add_argument("--network-version", type=int, default=2, choices=[1, 2])
    a = p.parse_args()

    cfg = TrainConfig(
        total_timesteps=a.steps,
        num_envs=a.num_envs,
        steps_per_env=a.steps_per_env,
        lr=a.lr,
        lr_schedule=a.lr_schedule,
        hidden_size=a.hidden,
        num_layers=a.layers,
        num_epochs=a.epochs,
        minibatch_size=a.minibatch,
        gamma=a.gamma,
        gae_lambda=a.gae_lambda,
        ent_coef=a.ent_coef,
        ent_coef_final=a.ent_coef_final,
        win_points=a.win_points,
        trick_shaping_coef=a.trick_shaping_coef,
        p_latest_opponent=a.p_latest_opponent,
        device=a.device,
        seed=a.seed,
        eval_every=a.eval_every,
        eval_games=a.eval_games,
        ckpt_every=a.ckpt_every,
        ckpt_dir=a.ckpt_dir,
        log_dir=a.log_dir,
        resume_from=a.resume,
        use_curriculum=a.curriculum,
        use_wandb=not a.no_wandb,
        wandb_entity=a.wandb_entity,
        wandb_project=a.wandb_project,
        network_version=a.network_version,
    )

    train(cfg)
