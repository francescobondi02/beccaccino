"""Benchmark the bare engine and vector-environment observation/IPC throughput."""

import argparse
import time

import numpy as np

from becca_env.deck import Suit
from becca_env.game import BeccaGame, GamePhase
from training.vec_env import create_vec_env


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


def benchmark_vector_env(
    num_envs: int,
    seconds: float,
    *,
    win_points: int = 5,
    include_full_obs: bool = True,
    sync: bool = False,
) -> float:
    vec = create_vec_env(
        num_envs=num_envs,
        seed=0,
        win_points=win_points,
        sync=sync,
        include_full_obs=include_full_obs,
    )
    try:
        obs, _ = vec.reset()
        steps = 0
        start = time.perf_counter()
        deadline = start + seconds
        while time.perf_counter() < deadline or steps == 0:
            actions = np.argmax(obs["action_mask"], axis=1)
            obs, _, _, _, _ = vec.step(actions)
            steps += num_envs
        return steps / (time.perf_counter() - start)
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
    return parser.parse_args(argv)


def main():
    args = parse_args()
    if not args.sweep_envs:
        benchmark_bare_engine(args.games)
        return

    env_counts = [int(value.strip()) for value in args.sweep_envs.split(",")]
    print("num_envs,env_steps_per_s")
    for num_envs in env_counts:
        steps_per_second = benchmark_vector_env(
            num_envs,
            args.seconds,
            win_points=args.win_points,
            include_full_obs=args.include_full_obs,
        )
        print(f"{num_envs},{steps_per_second:.0f}")


if __name__ == "__main__":
    main()
