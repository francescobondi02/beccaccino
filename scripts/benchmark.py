"""Benchmark the bare engine and end-to-end self-play rollout throughput."""

import argparse
import time

import numpy as np
import torch

from becca_env.deck import Suit
from becca_env.game import BeccaGame, GamePhase
from becca_env.observation import FULL_STATE_SIZE
from training.dual_rollout import collect_self_play_rollout_vec
from training.network import CentralizedCritic, create_network
from training.vec_env import create_vec_env

RUN_D_NETWORK = {
    "version": 4,
    "d_model": 192,
    "nhead": 6,
    "num_layers": 4,
    "dim_feedforward": 384,
}


def play_random_game(seed: int) -> int:
    """Play one full game with deterministic first-legal-action policy. Returns step count."""
    game = BeccaGame(seed=seed, win_points=41)
    steps = 0
    while game.phase != GamePhase.GAME_OVER:
        if game.phase == GamePhase.CHOOSE_BRISCOLA:
            game.step(Suit.DENARA)
        else:
            actions = game.legal_actions()
            game.step(actions[0])
        steps += 1
    return steps


def benchmark_bare_engine(n_games: int) -> tuple[float, float, float]:
    print(f"Simulating {n_games} games...")
    start = time.perf_counter()
    total_steps = 0
    for i in range(n_games):
        total_steps += play_random_game(seed=i)
    elapsed = time.perf_counter() - start
    print(f"  Time: {elapsed:.2f}s")
    print(f"  Games/sec: {n_games / elapsed:.0f}")
    print(f"  Steps/sec: {total_steps / elapsed:.0f}")
    print(f"  Avg steps/game: {total_steps / n_games:.1f}")
    return n_games / elapsed, total_steps / elapsed, total_steps / n_games


def benchmark_training_rollout(
    num_envs: int,
    seconds: float,
    *,
    win_points: int = 5,
    include_full_obs: bool = True,
    sync: bool = False,
    device: str | torch.device | None = None,
    rollout_steps: int = 64,
    network_kwargs: dict | None = None,
) -> float:
    if num_envs <= 0 or rollout_steps <= 0:
        raise ValueError("num_envs and rollout_steps must be positive")
    torch_device = torch.device(
        device if device is not None else ("cuda" if torch.cuda.is_available() else "cpu")
    )
    learner = create_network(**(network_kwargs or RUN_D_NETWORK)).to(torch_device)
    opponent = create_network(**learner.config).to(torch_device)
    opponent.load_state_dict(learner.state_dict())
    critic = (
        CentralizedCritic(
            FULL_STATE_SIZE,
            hidden_size=256,
            num_layers=4,
            use_layer_norm=True,
        ).to(torch_device)
        if include_full_obs
        else None
    )
    learner_teams = np.arange(num_envs, dtype=np.int64) % 2
    vec = create_vec_env(
        num_envs=num_envs,
        seed=0,
        win_points=win_points,
        sync=sync,
        include_full_obs=include_full_obs,
    )
    try:
        collect_self_play_rollout_vec(
            vec,
            learner,
            opponent,
            learner_teams,
            steps_per_env=2,
            device=torch_device,
            critic=critic,
        )
        learner_steps = 0
        start = time.perf_counter()
        deadline = start + seconds
        while time.perf_counter() < deadline or learner_steps == 0:
            buffer = collect_self_play_rollout_vec(
                vec,
                learner,
                opponent,
                learner_teams,
                steps_per_env=rollout_steps,
                device=torch_device,
                critic=critic,
            )
            learner_steps += buffer.ptr
        return learner_steps / (time.perf_counter() - start)
    finally:
        vec.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=10_000)
    parser.add_argument(
        "--sweep-envs",
        help="Comma-separated vector-env counts; omit to benchmark the bare engine.",
    )
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--win-points", type=int, default=5)
    parser.add_argument("--include-full-obs", action="store_true")
    parser.add_argument("--device")
    parser.add_argument("--rollout-steps", type=int, default=64)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    if not args.sweep_envs:
        benchmark_bare_engine(args.games)
        return

    env_counts = [int(value.strip()) for value in args.sweep_envs.split(",")]
    print("num_envs,learner_steps_per_s")
    for num_envs in env_counts:
        steps_per_second = benchmark_training_rollout(
            num_envs,
            args.seconds,
            win_points=args.win_points,
            include_full_obs=args.include_full_obs,
            device=args.device,
            rollout_steps=args.rollout_steps,
        )
        print(f"{num_envs},{steps_per_second:.0f}")


if __name__ == "__main__":
    main()
