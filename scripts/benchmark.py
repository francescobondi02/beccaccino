"""Quick benchmark: how many games/second can the engine simulate?"""

import time
from becca_env.game import BeccaGame, GamePhase
from becca_env.deck import Suit


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


def main():
    n_games = 10_000
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


if __name__ == "__main__":
    main()
