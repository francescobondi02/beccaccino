"""End-to-end Stage 2 pipeline: behavioral cloning warm-start + PPO RL.

Phase 1 — IMITATION
  - Self-play with HeuristicAgent on both teams to build a (obs, action,
    return) dataset of ~250k transitions.
  - Train the selected policy/value network (V4 transformer for current
    long-run presets) with masked CE + value MSE for a few epochs.
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
import sys
import time
from pathlib import Path

import numpy as np
import torch

from becca_env.observation import FULL_STATE_SIZE, OBS_SIZE
from evaluation.arena import evaluate_against_random
from evaluation.heuristic import evaluate_against_heuristic
from training.checkpoint import (
    build_net,
    load_checkpoint,
    net_config_of,
    restore_rng,
    save_checkpoint,
    seed_everything,
)
from training.config import TrainConfig
from training.dual_rollout import collect_self_play_rollout_vec
from training.imitation import behavioral_clone, collect_heuristic_dataset
from training.network import CentralizedCritic, create_network
from training.normalization import ReturnNormalizer
from training.ppo import ppo_update
from training.self_play import OpponentPool
from training.trainer import _apply_signal_honesty_coef, signal_honesty_schedule
from training.vec_env import (
    create_vec_env,
    learner_team_per_env,
    snapshot_vec_env_state,
    win_points_per_env,
)

SECONDS_PER_HOUR = 3600
RESUME_CONTRACT_FORMAT = 1


def _parse_wp_mix(value: str) -> list[int]:
    try:
        result = [int(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--wp-mix must be comma-separated integers") from exc
    if not result or any(item <= 0 for item in result):
        raise argparse.ArgumentTypeError("--wp-mix must contain positive integers")
    return result


def parse_args(argv: list[str] | None = None):
    raw_args = sys.argv[1:] if argv is None else argv
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
    win_points = p.add_mutually_exclusive_group()
    win_points.add_argument("--win-points", type=int, default=None)
    win_points.add_argument(
        "--wp-mix",
        type=_parse_wp_mix,
        default=None,
        help='Comma-separated training game lengths, for example "5,41".',
    )
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
        "--save-last-every",
        type=int,
        default=10,
        help="Write resumable last.pt every N updates, independently of pool snapshots.",
    )
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
    p.add_argument(
        "--run-id",
        default=None,
        help="Stable identity for a resumable run. Defaults to the output directory name.",
    )
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
    args = p.parse_args(raw_args)
    if args.win_points is None and args.wp_mix is None:
        args.win_points = 5
    args._explicit_options = {
        token.split("=", 1)[0] for token in raw_args if token.startswith("--")
    }
    return args


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
            "obs_size": OBS_SIZE,
            "card_conditioned_signals": True,
        }
    return {
        "version": args.network_version,
        "hidden_size": args.hidden,
        "num_layers": args.layers,
        "use_layer_norm": True,
        "obs_size": OBS_SIZE,
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


def _validate_resume_architecture(args, ck: dict) -> None:
    net_config = net_config_of(ck)
    if net_config["obs_size"] != OBS_SIZE:
        raise SystemExit(
            f"checkpoint observation width is {net_config['obs_size']}, current "
            f"training requires {OBS_SIZE}; start a new run from regenerated BC"
        )
    if net_config["version"] == 4 and not net_config["card_conditioned_signals"]:
        raise SystemExit(
            "legacy V4 global signal heads are inference-only; "
            "start a new run with card-conditioned signals"
        )
    explicit = getattr(args, "_explicit_options", set())
    flag_config_pairs = [
        ("--network-version", "network_version", "version"),
        ("--layers", "layers", "num_layers"),
    ]
    if net_config["version"] == 4:
        flag_config_pairs.extend(
            [
                ("--d-model", "d_model", "d_model"),
                ("--nhead", "nhead", "nhead"),
                ("--dim-feedforward", "dim_feedforward", "dim_feedforward"),
            ]
        )
    else:
        flag_config_pairs.append(("--hidden", "hidden", "hidden_size"))

    for flag, arg_name, config_name in flag_config_pairs:
        cli_value = getattr(args, arg_name)
        checkpoint_value = net_config[config_name]
        if flag in explicit and cli_value != checkpoint_value:
            raise SystemExit(
                f"{flag}={cli_value} conflicts with checkpoint {config_name}="
                f"{checkpoint_value}; resume continues the checkpoint architecture"
            )

    checkpoint_has_critic = ck.get("critic") is not None
    if checkpoint_has_critic and not args.centralized_critic:
        raise SystemExit("checkpoint has a critic; refusing to resume without --centralized-critic")
    if args.centralized_critic and not checkpoint_has_critic:
        raise SystemExit("checkpoint has no critic; refusing to resume with --centralized-critic")

    train_config = ck.get("train_config") or {}
    if checkpoint_has_critic and "--hidden" in explicit:
        checkpoint_hidden = train_config.get("hidden_size")
        if checkpoint_hidden is not None and args.hidden != checkpoint_hidden:
            raise SystemExit(
                f"--hidden={args.hidden} conflicts with checkpoint critic hidden_size="
                f"{checkpoint_hidden}"
            )


def _critic_from_checkpoint(ck: dict, device: torch.device) -> CentralizedCritic | None:
    if ck.get("critic") is None:
        return None
    train_config = ck.get("train_config")
    if not isinstance(train_config, dict):
        raise SystemExit("critic checkpoint is missing its stamped train_config")
    critic = CentralizedCritic(
        input_size=FULL_STATE_SIZE,
        hidden_size=train_config["hidden_size"],
        num_layers=train_config["num_layers"],
        use_layer_norm=train_config.get("use_layer_norm", True),
    ).to(device)
    critic.load_state_dict(ck["critic"])
    return critic


def _apply_resume_architecture(args, ck: dict) -> None:
    net_config = net_config_of(ck)
    args.network_version = net_config["version"]
    args.layers = net_config["num_layers"]
    if args.network_version == 4:
        args.d_model = net_config["d_model"]
        args.nhead = net_config["nhead"]
        args.dim_feedforward = net_config["dim_feedforward"]
    else:
        args.hidden = net_config["hidden_size"]

    if ck.get("critic") is not None:
        args.hidden = ck["train_config"]["hidden_size"]


def _load_resume_components(args, device: torch.device) -> tuple[dict, torch.nn.Module, object]:
    ck = load_checkpoint(args.resume, map_location=device)
    _validate_resume_architecture(args, ck)
    _apply_resume_architecture(args, ck)
    return ck, build_net(ck, device), _critic_from_checkpoint(ck, device)


def _resolve_anchors(args, resume_ckpt: dict | None, device: torch.device) -> list[dict] | None:
    if not args.anchor_bc:
        return None
    if resume_ckpt is not None and resume_ckpt.get("anchors") is not None:
        return resume_ckpt["anchors"]
    if Path(args.bc_ckpt).exists():
        return [load_checkpoint(args.bc_ckpt, map_location=device)["model"]]
    return None


def _resume_contract(args, cfg: TrainConfig, net, critic) -> dict:
    immutable_config = {
        name: getattr(cfg, name)
        for name in (
            "num_envs",
            "steps_per_env",
            "win_points",
            "wp_mix",
            "eval_win_points",
            "lr",
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
            "total_timesteps",
            "seed",
            "p_latest_opponent",
            "signal_honesty_coef",
            "signal_honesty_coef_final",
            "signal_honesty_frac",
        )
    }
    critic_config = None
    if critic is not None:
        critic_config = {
            "hidden_size": cfg.hidden_size,
            "num_layers": cfg.num_layers,
            "use_layer_norm": cfg.use_layer_norm,
        }
    return {
        "format": RESUME_CONTRACT_FORMAT,
        "run_id": args.run_id or Path(args.out_dir).name,
        "net_config": dict(net.config),
        "critic_config": critic_config,
        "train_config": immutable_config,
        "pool_save_every": args.pool_save_every,
        "anchor_bc": args.anchor_bc,
        "eval_every": args.eval_every,
        "eval_games": args.eval_games,
    }


def _validate_resume_contract(checkpoint: dict, current: dict) -> None:
    saved = checkpoint.get("resume_contract")
    if saved is None:
        return
    if saved == current:
        return
    # Name nested fields (e.g. train_config.wp_mix) so the operator sees the
    # exact offending flag, not just "train_config".
    differing = []
    for key in sorted(saved.keys() | current.keys()):
        saved_value, current_value = saved.get(key), current.get(key)
        if saved_value == current_value:
            continue
        if isinstance(saved_value, dict) and isinstance(current_value, dict):
            differing += [
                f"{key}.{sub}"
                for sub in sorted(saved_value.keys() | current_value.keys())
                if saved_value.get(sub) != current_value.get(sub)
            ]
        else:
            differing.append(key)
    raise SystemExit(
        "resume configuration differs from checkpoint for: "
        + ", ".join(differing)
        + ". Resume must keep the original run definition."
    )


def _reconcile_metrics_csv(csv_path: Path, checkpoint_update: int) -> None:
    if not csv_path.exists():
        return

    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        if (
            reader.fieldnames is None
            or "phase" not in reader.fieldnames
            or "update" not in reader.fieldnames
        ):
            raise SystemExit(f"invalid metrics CSV header: {csv_path}")
        fieldnames = reader.fieldnames
        rows = list(reader)

    kept = []
    rl_row_index: dict[int, int] = {}
    changed = False
    for row in rows:
        if row["phase"] != "rl":
            kept.append(row)
            continue
        try:
            update = int(row["update"])
        except ValueError as exc:
            raise SystemExit(f"invalid metrics update {row['update']!r}: {csv_path}") from exc
        if update > checkpoint_update:
            changed = True
            continue
        if update in rl_row_index:
            kept[rl_row_index[update]] = row
            changed = True
            continue
        rl_row_index[update] = len(kept)
        kept.append(row)

    if not changed:
        return
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)


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
    eval_win_points = args.eval_win_points or args.win_points or max(args.wp_mix)
    pre_wr_h = evaluate_against_heuristic(
        net,
        num_games=80,
        device=device,
        seed=args.seed + 9999,
        win_points=eval_win_points,
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
        win_points=eval_win_points,
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


def phase2_rl(args, device, net, resume_ckpt=None):
    if args.save_last_every <= 0:
        raise ValueError("--save-last-every must be positive")
    critic = None
    if args.resume:
        if resume_ckpt is None:
            resume_ckpt, net, critic = _load_resume_components(args, device)
        else:
            _validate_resume_architecture(args, resume_ckpt)
            _apply_resume_architecture(args, resume_ckpt)
            net = build_net(resume_ckpt, device)
            critic = _critic_from_checkpoint(resume_ckpt, device)
        # Flat checkpoints ({"model","config"} — the shipped runB/runC files and
        # this script's own --final-ckpt output) carry no optimizer/counter
        # state and were never resumable; without this guard they die later in
        # opt.load_state_dict with a bare KeyError.
        if resume_ckpt.get("optimizer") is None:
            raise SystemExit(
                f"{args.resume} has no optimizer state; --resume requires a "
                "last.pt written by this pipeline (flat checkpoints are for "
                "eval/serving only)"
            )

    cfg = TrainConfig(
        num_envs=args.num_envs,
        steps_per_env=args.steps_per_env,
        win_points=args.win_points if args.win_points is not None else args.wp_mix[0],
        wp_mix=args.wp_mix,
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
        d_model=args.d_model,
        nhead=args.nhead,
        dim_feedforward=args.dim_feedforward,
        centralized_critic=args.centralized_critic,
        signal_honesty_coef=args.signal_honesty_coef,
        signal_honesty_coef_final=args.signal_honesty_coef_final,
        signal_honesty_frac=args.signal_honesty_frac,
        use_wandb=False,
    )
    training_win_points = cfg.wp_mix or cfg.win_points
    # Fallback mirrors phase 1's (max of the mix), so BC and RL evals agree
    # when --eval-win-points is not passed.
    default_eval_wp = max(cfg.wp_mix) if cfg.wp_mix else cfg.win_points
    eval_wp = cfg.eval_win_points if cfg.eval_win_points is not None else default_eval_wp
    env_win_points = win_points_per_env(cfg.num_envs, training_win_points)
    metric_win_points = sorted(set(env_win_points))

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "metrics.csv"
    new_csv = not csv_path.exists() or csv_path.stat().st_size == 0
    if new_csv:
        with csv_path.open("a", newline="") as f:
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
                    *[f"mean_episode_return_wp_{wp}" for wp in metric_win_points],
                    "opponent_source",
                    "wr_random",
                    "wr_heuristic",
                ]
            )

    # Centralized (CTDE) critic — value head over the full state. Its params
    # join the actor's under one optimizer, mirroring training/trainer.py.
    if critic is None and args.centralized_critic:
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
    opponent_net = create_network(**net.config).to(device)
    opponent_net.load_state_dict(net.state_dict())

    shaping_signals = cfg.signal_honesty_coef != 0.0 or cfg.signal_honesty_coef_final != 0.0
    learner_teams = learner_team_per_env(cfg.num_envs)

    # Permanent opponent-pool anchor from the BC snapshot (anti-collapse).
    anchors = _resolve_anchors(args, resume_ckpt, device)
    pool = OpponentPool(max_size=cfg.opponent_pool_size, anchors=anchors)
    return_normalizer = ReturnNormalizer(gamma=cfg.gamma)

    # Resume the RL phase from a prior last.pt (net + optimizer + critic +
    # normalizer + pool + counters), so a run killed at Kaggle's 12h cap continues.
    step_count = 0
    games_total = 0
    start_update = 1
    resumed_best = (-1.0, 0)
    resume_rng = None
    if args.resume:
        opt.load_state_dict(resume_ckpt["optimizer"])
        if resume_ckpt.get("normalizer") is not None:
            return_normalizer.from_dict(resume_ckpt["normalizer"])
        if resume_ckpt.get("pool"):
            pool = OpponentPool.from_serialized(
                resume_ckpt["pool"], max_size=cfg.opponent_pool_size, anchors=anchors
            )
        step_count = resume_ckpt.get("step", 0)
        games_total = resume_ckpt.get("games", 0)
        start_update = resume_ckpt.get("update", 0) + 1
        resumed_best = (
            resume_ckpt.get("best_wr_heuristic", -1.0),
            resume_ckpt.get("best_update", 0),
        )
        resume_rng = resume_ckpt.get("rng")
        _reconcile_metrics_csv(csv_path, start_update - 1)
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
    contract = _resume_contract(args, cfg, net, critic)
    if resume_ckpt is not None:
        _validate_resume_contract(resume_ckpt, contract)

    if cfg.total_updates < 1:
        raise SystemExit(
            f"--total-rl-steps {cfg.total_timesteps} is below one batch "
            f"({cfg.batch_size}); no update would run"
        )
    if resume_ckpt is not None and start_update > cfg.total_updates:
        raise SystemExit(
            f"resume checkpoint is already at update {start_update - 1} of "
            f"{cfg.total_updates}: this run is complete. Start a new run from "
            "this checkpoint instead (extending --total-rl-steps would trip "
            "the resume contract, and would reshape the LR, entropy, and "
            "signal schedules)."
        )

    rollout_state = resume_ckpt.get("rollout_state") if resume_ckpt else None
    if resume_ckpt is not None and rollout_state is None:
        raise SystemExit(
            "checkpoint predates exact vector-state resume; start a new run from its policy weights"
        )
    vec = create_vec_env(
        num_envs=cfg.num_envs,
        seed=cfg.seed,
        win_points=training_win_points,
        sync=False,
        signal_honesty_coef=signal_honesty_schedule(cfg, start_update),
        include_full_obs=critic is not None,
        rollout_state=rollout_state,
    )
    if resume_rng is not None:
        restore_rng(resume_rng)
    t0 = time.time()
    session_env_steps = 0
    deadline = (
        time.monotonic() + args.max_hours * SECONDS_PER_HOUR if args.max_hours is not None else None
    )

    def _save(path, upd):
        extra = {
            "games": games_total,
            "phase": "rl",
            "net_config": dict(net.config),
            "best_wr_heuristic": best_wr_heur,
            "best_update": best_update,
            "anchors": pool.anchors,
            "run_id": contract["run_id"],
            "resume_contract": contract,
            "rollout_state": snapshot_vec_env_state(vec),
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
            learner_teams,
            cfg.steps_per_env,
            device,
            critic=critic,
        )
        step_count += buf.collected_steps
        session_env_steps += cfg.batch_size
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
        # env-steps/s over THIS session (matches the kaggle_run cost model);
        # the `steps` column counts learner transitions (~half), so steps/sps
        # is not elapsed time.
        sps = session_env_steps / (time.time() - t0)
        mean_reward = float(buf.rewards[: buf.ptr].mean())
        mean_returns_by_wp = _mean_episode_returns_by_wp(buf, env_win_points)

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
                    *[
                        f"{mean_returns_by_wp[wp]:.4f}"
                        if np.isfinite(mean_returns_by_wp[wp])
                        else "nan"
                        for wp in metric_win_points
                    ],
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
        if update % args.save_last_every == 0:
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
            "config": dict(net.config),
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


def _mean_episode_returns_by_wp(buf, env_win_points: list[int]) -> dict[int, float]:
    completed_returns: dict[int, list[float]] = {
        win_points: [] for win_points in sorted(set(env_win_points))
    }
    running = np.zeros(len(env_win_points), dtype=np.float64)
    for index in range(buf.ptr):
        env_index = int(buf.env_idx[index])
        running[env_index] += float(buf.rewards[index])
        if buf.dones[index]:
            completed_returns[env_win_points[env_index]].append(running[env_index])
            running[env_index] = 0.0
    return {
        win_points: float(np.mean(returns)) if returns else float("nan")
        for win_points, returns in completed_returns.items()
    }


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
        print(f"Resuming RL from {args.resume} (skipping BC)")
        # Load once; phase2_rl validates the architecture and builds net+critic
        # from the checkpoint stamp.
        resume_ckpt = load_checkpoint(args.resume, map_location=device)
        net = None
    else:
        resume_ckpt = None
        net = phase1_bc(args, device)
    phase2_rl(args, device, net, resume_ckpt=resume_ckpt)


if __name__ == "__main__":
    main()
