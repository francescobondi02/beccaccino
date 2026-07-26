"""End-to-end Stage 2 pipeline: behavioral cloning warm-start + PPO RL.

Phase 1 — IMITATION
  - Self-play with HeuristicAgent on both teams to build a (obs, action,
    return) dataset of ~250k transitions.
  - Train V3 (factorized head) policy & value network with masked CE +
    value MSE for a few epochs.
  - Snapshot the warm-started checkpoint.

Phase 2 — RL
  - Continue training the same network with the existing PPO self-play
    pipeline (return normalization on, opponent pool, balanced learner
    teams).
  - Eval vs random AND vs heuristic at potentially-different win_points
    (--eval-win-points) so we can train short and evaluate at full length.
  - Plot the curves.

Usage:
    python -m scripts.bc_then_rl --device cpu --total-rl-steps 4000000 \
        --bc-games 1500 --bc-epochs 4 --win-points 5 --eval-win-points 41

Outputs:
  - runs/bc_rl/metrics.csv         per-update training metrics
  - runs/bc_rl/learning_curve.png  4-panel diagnostics
  - runs/bc_rl/summary.png         smoothed eval curves
  - checkpoints/bc_initial.pt      snapshot after BC (before RL)
  - checkpoints/bc_rl_final.pt     final RL-fine-tuned checkpoint
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

import numpy as np
import torch

from becca_env.observation import FULL_STATE_SIZE
from evaluation.arena import evaluate_against_random
from evaluation.heuristic import evaluate_against_heuristic
from training.checkpoint import load_checkpoint, save_checkpoint, seed_everything
from training.config import TrainConfig
from training.dual_rollout import collect_self_play_rollout_vec
from training.imitation import behavioral_clone, collect_heuristic_dataset
from training.network import CentralizedCritic, create_network
from training.normalization import ReturnNormalizer
from training.ppo import ppo_update
from training.self_play import OpponentPool
from training.trainer import _apply_signal_honesty_coef, signal_honesty_schedule
from training.vec_env import create_vec_env

SECONDS_PER_HOUR = 3600


def parse_args():
    p = argparse.ArgumentParser()
    # BC phase
    p.add_argument(
        "--bc-games",
        type=int,
        default=1500,
        help="Heuristic-vs-heuristic games to collect for BC dataset.",
    )
    p.add_argument("--bc-epochs", type=int, default=4)
    p.add_argument("--bc-batch-size", type=int, default=512)
    p.add_argument("--bc-lr", type=float, default=3e-4)
    p.add_argument(
        "--bc-win-points",
        type=int,
        default=5,
        help="win_points used to collect BC dataset (short = fast).",
    )
    p.add_argument(
        "--bc-skip", action="store_true", help="Skip BC entirely (start from random init)."
    )
    p.add_argument(
        "--bc-load",
        type=str,
        default=None,
        help="If set, load this BC checkpoint instead of training one.",
    )

    # RL phase
    p.add_argument("--total-rl-steps", type=int, default=4_000_000)
    p.add_argument("--num-envs", type=int, default=16)
    p.add_argument("--steps-per-env", type=int, default=256)
    p.add_argument("--win-points", type=int, default=5)
    p.add_argument(
        "--eval-win-points",
        type=int,
        default=None,
        help="Defaults to --win-points. Set 41 for full-game eval.",
    )
    p.add_argument("--device", default="cpu")
    p.add_argument("--lr", type=float, default=2.5e-4)
    p.add_argument("--ent-coef", type=float, default=0.02)
    p.add_argument("--ent-coef-final", type=float, default=0.005)
    p.add_argument(
        "--signal-honesty-coef",
        type=float,
        default=0.0,
        help="Reward for an honest signal (penalty if it lies; silence is "
        "free). 0.0 = off. Grounds the signal action slots, which "
        "the round score alone never touches.",
    )
    p.add_argument(
        "--signal-honesty-coef-final",
        type=float,
        default=0.0,
        help="Value the honesty coefficient anneals TO (default 0.0).",
    )
    p.add_argument(
        "--signal-honesty-frac",
        type=float,
        default=0.5,
        help="Fraction of the RL phase over which to anneal (default 0.5).",
    )
    p.add_argument(
        "--bc-no-signals",
        action="store_true",
        help="Collect the BC dataset from a SILENT teacher (the old "
        "behaviour). Default teaches honest signalling.",
    )
    p.add_argument("--p-latest-opponent", type=float, default=0.5)
    p.add_argument("--eval-every", type=int, default=10)
    p.add_argument("--eval-games", type=int, default=100)
    p.add_argument("--pool-save-every", type=int, default=20)
    p.add_argument(
        "--hidden",
        type=int,
        default=256,
        help="V2/V3: hidden_size of MLP. Unused for V4 (use --d-model).",
    )
    p.add_argument("--layers", type=int, default=3)
    p.add_argument("--d-model", type=int, default=128, help="V4 only.")
    p.add_argument("--nhead", type=int, default=4, help="V4 only.")
    p.add_argument("--dim-feedforward", type=int, default=256, help="V4 only.")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out-dir", default="runs/bc_rl")
    p.add_argument("--bc-ckpt", default="checkpoints/bc_initial.pt")
    p.add_argument("--final-ckpt", default="checkpoints/bc_rl_final.pt")
    p.add_argument("--network-version", type=int, default=3, choices=[2, 3, 4])
    # Strengtheners / long-run survival (parity with training/trainer.py)
    p.add_argument(
        "--centralized-critic",
        action="store_true",
        help="Fit a CTDE critic over the full state (targets low EV).",
    )
    p.add_argument(
        "--anchor-bc",
        action="store_true",
        help="Seed a permanent opponent-pool anchor from the BC snapshot.",
    )
    p.add_argument(
        "--max-hours",
        type=float,
        default=None,
        help="Graceful wall-clock stop for the RL phase; writes last.pt "
        "and exits so --resume continues (Kaggle 12h cap).",
    )
    p.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Resume the RL phase from a last.pt written by a prior run (skips BC).",
    )
    return p.parse_args()


def _net_config_dict(args) -> dict:
    """Snapshot of network hyperparams. Saved alongside checkpoints so
    later loaders can reconstruct the architecture without guessing. Keys must
    match create_network's kwargs exactly so build_net can splat this dict."""
    if args.network_version == 4:
        return {
            "version": 4,
            "d_model": args.d_model,
            "nhead": args.nhead,
            "num_layers": args.layers,
            "dim_feedforward": args.dim_feedforward,
        }
    return {
        "version": args.network_version,
        "hidden_size": args.hidden,
        "num_layers": args.layers,
        "use_layer_norm": True,
    }


def make_net(args, device):
    if args.network_version == 4:
        return create_network(
            version=4,
            d_model=args.d_model,
            nhead=args.nhead,
            num_layers=args.layers,
            dim_feedforward=args.dim_feedforward,
        ).to(device)
    return create_network(
        version=args.network_version,
        hidden_size=args.hidden,
        num_layers=args.layers,
        use_layer_norm=True,
    ).to(device)


def phase1_bc(args, device) -> torch.nn.Module:
    """Either load a saved BC ckpt, train a new one, or skip BC entirely."""
    if args.bc_load:
        net = make_net(args, device)
        ckpt = torch.load(args.bc_load, map_location=device, weights_only=False)
        net.load_state_dict(ckpt["model"])
        print(f"Loaded BC checkpoint from {args.bc_load}")
        return net

    if args.bc_skip:
        print("Skipping BC (starting RL from random init)")
        return make_net(args, device)

    print(f"Phase 1: collecting BC dataset ({args.bc_games} heuristic games)…")
    t0 = time.time()
    ds = collect_heuristic_dataset(
        num_games=args.bc_games,
        win_points=args.bc_win_points,
        seed=args.seed,
        verbose=True,
        declare_signals=not args.bc_no_signals,
    )
    dt = time.time() - t0
    print(f"  collected {len(ds):,} samples in {dt:.1f}s")

    # Quick eval BEFORE BC to see the lift
    net = make_net(args, device)
    pre_wr_h = evaluate_against_heuristic(
        net,
        num_games=80,
        device=device,
        seed=args.seed + 9999,
        win_points=args.eval_win_points or args.win_points,
    )
    print(f"  pre-BC: vs heuristic = {pre_wr_h:.1%}")

    print(f"Phase 1: behavioral cloning ({args.bc_epochs} epochs)…")
    behavioral_clone(
        net,
        ds,
        epochs=args.bc_epochs,
        batch_size=args.bc_batch_size,
        lr=args.bc_lr,
        device=device,
        verbose=True,
    )

    post_wr_h = evaluate_against_heuristic(
        net,
        num_games=200,
        device=device,
        seed=args.seed + 99999,
        win_points=args.eval_win_points or args.win_points,
    )
    pre_wr_r = evaluate_against_random(
        net,
        num_games=200,
        device=device,
        seed=args.seed + 88888,
    )
    print(f"  post-BC: vs random = {pre_wr_r:.1%} | vs heuristic = {post_wr_h:.1%}")

    Path(args.bc_ckpt).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": net.state_dict(),
            "config": _net_config_dict(args),
            "phase": "bc",
            "bc_games": args.bc_games,
        },
        args.bc_ckpt,
    )
    print(f"  saved BC checkpoint to {args.bc_ckpt}")
    return net


def phase2_rl(args, device, net):
    cfg = TrainConfig(
        num_envs=args.num_envs,
        steps_per_env=args.steps_per_env,
        win_points=args.win_points,
        eval_win_points=args.eval_win_points,
        lr=args.lr,
        ent_coef=args.ent_coef,
        ent_coef_final=args.ent_coef_final,
        hidden_size=args.hidden,
        num_layers=args.layers,
        total_timesteps=args.total_rl_steps,
        device=args.device,
        seed=args.seed,
        p_latest_opponent=args.p_latest_opponent,
        network_version=args.network_version,
        signal_honesty_coef=args.signal_honesty_coef,
        signal_honesty_coef_final=args.signal_honesty_coef_final,
        signal_honesty_frac=args.signal_honesty_frac,
        use_wandb=False,
    )
    eval_wp = cfg.eval_win_points if cfg.eval_win_points is not None else cfg.win_points

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "metrics.csv"
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "phase",
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

    # Centralized (CTDE) critic — value head over the full state. Its params
    # join the actor's under one optimizer, mirroring training/trainer.py.
    critic = None
    if args.centralized_critic:
        if cfg.num_envs <= 1:
            raise ValueError("--centralized-critic requires --num-envs > 1")
        critic = CentralizedCritic(
            input_size=FULL_STATE_SIZE,
            hidden_size=args.hidden,
            num_layers=args.layers,
            use_layer_norm=True,
        ).to(device)
    params = list(net.parameters()) + (list(critic.parameters()) if critic else [])
    opt = torch.optim.Adam(params, lr=cfg.lr, eps=1e-5)
    opponent_net = make_net(args, device)
    opponent_net.load_state_dict(net.state_dict())

    vec = create_vec_env(
        num_envs=cfg.num_envs,
        seed=cfg.seed,
        win_points=cfg.win_points,
        sync=False,
        signal_honesty_coef=signal_honesty_schedule(cfg, 1),
    )
    shaping_signals = cfg.signal_honesty_coef != 0.0 or cfg.signal_honesty_coef_final != 0.0
    learner_team_per_env = np.array([i % 2 for i in range(cfg.num_envs)], dtype=np.int64)

    # Permanent opponent-pool anchor from the BC snapshot (anti-collapse).
    anchors = None
    if args.anchor_bc and Path(args.bc_ckpt).exists():
        anchors = [load_checkpoint(args.bc_ckpt, map_location=device)["model"]]
    pool = OpponentPool(max_size=cfg.opponent_pool_size, anchors=anchors)
    return_normalizer = ReturnNormalizer(gamma=cfg.gamma)

    # Resume the RL phase from a prior last.pt (net + optimizer + critic +
    # normalizer + pool + counters), so a run killed at Kaggle's 12h cap continues.
    step_count = 0
    games_total = 0
    start_update = 1
    resumed_best = (-1.0, 0)
    if args.resume:
        ck = load_checkpoint(args.resume, map_location=device)
        net.load_state_dict(ck["model"])
        opt.load_state_dict(ck["optimizer"])
        if critic is not None and ck.get("critic") is not None:
            critic.load_state_dict(ck["critic"])
        if ck.get("normalizer") is not None:
            return_normalizer.from_dict(ck["normalizer"])
        if ck.get("pool"):
            pool = OpponentPool.from_serialized(
                ck["pool"], max_size=cfg.opponent_pool_size, anchors=anchors
            )
        step_count = ck.get("step", 0)
        games_total = ck.get("games", 0)
        start_update = ck.get("update", 0) + 1
        resumed_best = (ck.get("best_wr_heuristic", -1.0), ck.get("best_update", 0))
        print(f"  resumed at update {start_update}, {step_count:,} steps")

    n_params = sum(p.numel() for p in net.parameters())
    print(
        f"\nPhase 2 RL: {n_params:,} params | "
        f"batch={cfg.batch_size:,} | updates={cfg.total_updates}" + (" | +critic" if critic else "")
    )

    last_wr_random, last_wr_heur = float("nan"), float("nan")
    # -1.0 so the first eval always wins and best.pt exists from then on. A
    # resumed run inherits the previous session's bar, or its first mediocre eval
    # would overwrite a better best.pt.
    best_wr_heur, best_update = resumed_best
    t0 = time.time()
    deadline = (
        time.monotonic() + args.max_hours * SECONDS_PER_HOUR if args.max_hours is not None else None
    )

    def _save(path, upd):
        extra = {
            "games": games_total,
            "phase": "rl",
            "net_config": _net_config_dict(args),
            "best_wr_heuristic": best_wr_heur,
            "best_update": best_update,
        }
        if critic is not None:
            extra["critic"] = critic.state_dict()
        save_checkpoint(
            path,
            net=net,
            optimizer=opt,
            config=cfg,
            step=step_count,
            update=upd,
            normalizer=return_normalizer,
            pool=pool,
            extra=extra,
        )

    if start_update > cfg.total_updates:
        print("RL phase already complete for this --total-rl-steps; nothing to do.")
        vec.close()
        return

    for update in range(start_update, cfg.total_updates + 1):
        frac = (update - 1) / max(cfg.total_updates - 1, 1)
        ent_coef = cfg.ent_coef + (cfg.ent_coef_final - cfg.ent_coef) * frac
        cos = 0.5 * (1 + np.cos(np.pi * frac))
        for pg in opt.param_groups:
            pg["lr"] = cfg.lr * max(cos, 0.1)
        signal_coef = signal_honesty_schedule(cfg, update)
        if shaping_signals:
            _apply_signal_honesty_coef(vec, signal_coef, use_vec=True)

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
            device,
            critic=critic,
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
            device=device,
            critic=critic,
        )

        with torch.no_grad():
            vals = batch["values"].numpy()
            rets = batch["returns"].numpy()
            var_ret = rets.var()
            ev = (1 - (rets - vals).var() / (var_ret + 1e-8)) if var_ret > 0 else 0.0
        sps = step_count / (time.time() - t0)
        mean_reward = float(buf.rewards[: buf.ptr].mean())

        if update % args.pool_save_every == 0:
            pool.add_policy(net.state_dict())

        if update % args.eval_every == 0 or update == 1:
            # Frozen eval block (EVAL_SEED_BASE default): every checkpoint is
            # scored on the SAME deals so the curve tracks skill, not deal luck.
            last_wr_random = evaluate_against_random(
                net,
                num_games=args.eval_games,
                device=device,
            )
            last_wr_heur = evaluate_against_heuristic(
                net,
                num_games=args.eval_games,
                device=device,
                win_points=eval_wp,
            )
            # Keep the strongest weights, not just the last ones: self-play is
            # non-monotone, and Run B's curve peaked well before its final update.
            # Scored on the frozen eval block, so the comparison is apples-to-apples.
            if last_wr_heur > best_wr_heur:
                best_wr_heur = last_wr_heur
                best_update = update
                Path(args.final_ckpt).parent.mkdir(parents=True, exist_ok=True)
                _save(Path(args.final_ckpt).with_name("best.pt"), update)
                print(f"  new best vs heuristic ({last_wr_heur:.1%}) — saved best.pt")

        with csv_path.open("a", newline="") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "rl",
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

        # Resumable mid-run checkpoint (last.pt beside the final ckpt).
        last_path = Path(args.final_ckpt).with_name("last.pt")
        if update % args.pool_save_every == 0:
            Path(args.final_ckpt).parent.mkdir(parents=True, exist_ok=True)
            _save(last_path, update)

        # Graceful wall-clock stop (Kaggle 12h cap): save last.pt and exit so
        # --resume last.pt continues this run in the next session.
        if deadline is not None and time.monotonic() >= deadline:
            Path(args.final_ckpt).parent.mkdir(parents=True, exist_ok=True)
            _save(last_path, update)
            print(f"\nmax-hours reached at update {update}; saved {last_path.name}, stopping")
            vec.close()
            plot_results(csv_path, out)
            return

    Path(args.final_ckpt).parent.mkdir(parents=True, exist_ok=True)
    _save(Path(args.final_ckpt).with_name("last.pt"), cfg.total_updates)
    # Also keep the legacy flat format at --final-ckpt for existing loaders/eval.
    torch.save(
        {
            "model": net.state_dict(),
            "config": _net_config_dict(args),
            "steps": step_count,
            "phase": "rl",
        },
        args.final_ckpt,
    )
    print(f"\nSaved final checkpoint to {args.final_ckpt}")
    if best_update:
        print(
            f"Best vs heuristic was {best_wr_heur:.1%} at update {best_update} "
            f"(best.pt) — prefer it over the final weights if it scores higher."
        )
    vec.close()

    plot_results(csv_path, out)


def plot_results(csv_path: Path, out_dir: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = list(csv.DictReader(csv_path.open()))
    steps = [int(r["steps"]) for r in rows]
    wr_r = [float(r["wr_random"]) for r in rows]
    wr_h = [float(r["wr_heuristic"]) for r in rows]
    entropy = [float(r["entropy"]) for r in rows]
    kl = [float(r["approx_kl"]) for r in rows]
    ev = [float(r["explained_variance"]) for r in rows]

    def smooth(xs, w=9):
        a = np.asarray(xs, dtype=np.float64)
        if len(a) < w:
            return a
        kernel = np.ones(w) / w
        pad = w // 2
        padded = np.concatenate([np.full(pad, a[0]), a, np.full(pad, a[-1])])
        return np.convolve(padded, kernel, mode="valid")[: len(a)]

    fig, axes = plt.subplots(2, 2, figsize=(13, 8))
    axes[0, 0].plot(steps, wr_r, color="tab:blue", alpha=0.25)
    axes[0, 0].plot(steps, wr_h, color="tab:orange", alpha=0.25)
    axes[0, 0].plot(steps, smooth(wr_r), color="tab:blue", lw=2, label="vs random")
    axes[0, 0].plot(steps, smooth(wr_h), color="tab:orange", lw=2, label="vs heuristic")
    axes[0, 0].axhline(0.5, color="grey", ls=":", alpha=0.5)
    axes[0, 0].set_ylim(0, 1)
    axes[0, 0].set_xlabel("env steps")
    axes[0, 0].set_ylabel("win rate")
    axes[0, 0].set_title("Eval win rates")
    axes[0, 0].legend()
    axes[0, 0].grid(alpha=0.3)

    axes[0, 1].plot(steps, smooth(entropy), color="tab:green", lw=2)
    axes[0, 1].set_xlabel("env steps")
    axes[0, 1].set_ylabel("entropy")
    axes[0, 1].set_title("Policy entropy (annealed)")
    axes[0, 1].grid(alpha=0.3)

    axes[1, 0].plot(steps, smooth(kl), color="tab:red", lw=2)
    axes[1, 0].set_xlabel("env steps")
    axes[1, 0].set_ylabel("approx KL")
    axes[1, 0].set_title("PPO approx KL")
    axes[1, 0].grid(alpha=0.3)

    axes[1, 1].plot(steps, smooth(ev), color="tab:purple", lw=2)
    axes[1, 1].axhline(0.0, color="grey", ls=":", alpha=0.5)
    axes[1, 1].set_xlabel("env steps")
    axes[1, 1].set_ylabel("explained variance")
    axes[1, 1].set_title("Value-fn explained variance")
    axes[1, 1].grid(alpha=0.3)

    fig.suptitle(f"Stage 2 — BC + RL  |  final: vs_rand={wr_r[-1]:.0%}, vs_heur={wr_h[-1]:.0%}")
    fig.tight_layout()
    fig.savefig(out_dir / "learning_curve.png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved plot to {out_dir / 'learning_curve.png'}")


def main():
    args = parse_args()
    seed_everything(args.seed)
    device = torch.device(args.device)
    if args.resume:
        # Resuming the RL phase: rebuild the net from the checkpoint and skip BC.
        print(f"Resuming RL from {args.resume} (skipping BC)")
        net = make_net(args, device)
    else:
        net = phase1_bc(args, device)
    phase2_rl(args, device, net)


if __name__ == "__main__":
    main()
