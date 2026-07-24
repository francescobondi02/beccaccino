"""Rank trained checkpoints by Elo on a frozen block of deals.

vs-random saturates near 95%, so it stops discriminating strong checkpoints.
A round-robin Elo ladder on a fixed deal block gives a monotone cross-checkpoint
strength axis instead.

Usage:
    python -m scripts.elo_ladder checkpoints/a.pt checkpoints/b.pt ...
"""

from __future__ import annotations

import argparse

import torch

from evaluation.arena import elo_ladder
from training.checkpoint import build_net, load_checkpoint


def main() -> None:
    p = argparse.ArgumentParser(description="Cross-checkpoint Elo ladder")
    p.add_argument("checkpoints", nargs="+", help="Paths to .pt checkpoints")
    p.add_argument("--num-games", type=int, default=100,
                   help="Games per ordered pairing (played twice, sides swapped)")
    p.add_argument("--win-points", type=int, default=41)
    p.add_argument("--device", default="cpu")
    a = p.parse_args()

    device = torch.device(a.device)
    nets = {path: build_net(load_checkpoint(path), device) for path in a.checkpoints}

    ratings = elo_ladder(
        nets, num_games=a.num_games, win_points=a.win_points, device=device
    )
    print(f"{'checkpoint':<48} {'Elo':>8}")
    for name, rating in sorted(ratings.items(), key=lambda kv: kv[1], reverse=True):
        print(f"{name:<48} {rating:>8.1f}")


if __name__ == "__main__":
    main()
