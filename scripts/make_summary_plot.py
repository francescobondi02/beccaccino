"""Build a summary visualization for the demo training run.

Reads runs/demo/metrics.csv and produces a clean two-panel chart:
  - left: smoothed win-rate vs random + vs heuristic over training steps,
          with horizontal reference lines for "random would get this much"
  - right: training health diagnostics (entropy, explained variance) on
          twin y-axes

Saves to runs/demo/summary.png.
"""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def smooth(xs: list[float], window: int = 5) -> np.ndarray:
    a = np.asarray(xs, dtype=np.float64)
    if len(a) < window:
        return a
    kernel = np.ones(window) / window
    pad = window // 2
    padded = np.concatenate([np.full(pad, a[0]), a, np.full(pad, a[-1])])
    return np.convolve(padded, kernel, mode="valid")[: len(a)]


def main():
    csv_path = Path("runs/demo/metrics.csv")
    out_path = Path("runs/demo/summary.png")

    rows = list(csv.DictReader(csv_path.open()))
    steps = [int(r["steps"]) for r in rows]
    wr_r = [float(r["wr_random"]) for r in rows]
    wr_h = [float(r["wr_heuristic"]) for r in rows]
    entropy = [float(r["entropy"]) for r in rows]
    ev = [float(r["explained_variance"]) for r in rows]

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # Left: win rates with smoothing
    ax = axes[0]
    ax.plot(steps, wr_r, color="tab:blue", alpha=0.25, linewidth=1)
    ax.plot(steps, wr_h, color="tab:orange", alpha=0.25, linewidth=1)
    ax.plot(steps, smooth(wr_r, 9), color="tab:blue", linewidth=2.2, label="vs random (smoothed)")
    ax.plot(
        steps, smooth(wr_h, 9), color="tab:orange", linewidth=2.2, label="vs heuristic (smoothed)"
    )
    ax.axhline(0.5, color="grey", linestyle=":", alpha=0.6, label="50% (coin-flip)")
    ax.set_xlabel("env steps")
    ax.set_ylabel("win rate")
    ax.set_ylim(0, 1)
    ax.set_title("Eval win rates over training")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3)

    # Right: training health
    ax = axes[1]
    ax2 = ax.twinx()
    ax.plot(steps, smooth(entropy, 9), color="tab:green", linewidth=2, label="entropy")
    ax2.plot(steps, smooth(ev, 9), color="tab:purple", linewidth=2, label="explained variance")
    ax2.axhline(0.0, color="tab:purple", linestyle=":", alpha=0.4)
    ax.set_xlabel("env steps")
    ax.set_ylabel("policy entropy", color="tab:green")
    ax2.set_ylabel("explained variance", color="tab:purple")
    ax.tick_params(axis="y", labelcolor="tab:green")
    ax2.tick_params(axis="y", labelcolor="tab:purple")
    ax.set_title("Training health (entropy ↓ as agent commits, EV ↑ as value fits)")
    ax.grid(alpha=0.3)

    fig.suptitle(
        f"Beccaccino RL — {steps[-1]:,} steps, win_points=5\n"
        f"final: vs_random={wr_r[-1]:.0%}, vs_heuristic={wr_h[-1]:.0%}",
        fontsize=12,
    )
    fig.tight_layout()
    fig.savefig(out_path, dpi=140, bbox_inches="tight")
    print(f"saved {out_path}")


if __name__ == "__main__":
    main()
