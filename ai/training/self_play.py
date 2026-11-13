"""Opponent pool for self-play diversity.

Maintains a FIFO queue of historical policy checkpoints plus a set of permanent
anchor snapshots. During training, opponents are sampled from the pool to
prevent strategy cycling and collapse toward near-copies of the current policy.
"""

from __future__ import annotations

import copy
import random
from collections import deque


class OpponentPool:
    """Pool of frozen policies for opponent sampling.

    Two tiers, both sampled the same way (a state_dict the opponent net loads):
      - anchors: permanent, never evicted. Seed these with fixed reference
        policies (e.g. a frozen BC snapshot) so p_latest self-play can't collapse
        to near-copies of itself — the anchors stay reachable even before the
        FIFO fills.
      - FIFO policies: recent historical snapshots, evicted oldest-first.
    """

    def __init__(self, max_size: int = 10, anchors: list[dict] | None = None):
        self.policies: deque[dict] = deque(maxlen=max_size)
        self.max_size = max_size
        self.anchors: list[dict] = [copy.deepcopy(a) for a in (anchors or [])]

    def add_policy(self, state_dict: dict):
        """Add a snapshot of the current policy to the FIFO tier."""
        self.policies.append(copy.deepcopy(state_dict))

    def sample(self, p_latest: float = 0.8) -> dict | None:
        """Sample an opponent policy.

        Returns None to indicate "use current policy" (self-play), or a
        state_dict to load into the opponent network. With prob 1-p_latest,
        draws uniformly over anchors + FIFO snapshots (anchors are always in the
        pool, so they're reachable even when the FIFO is empty).
        """
        candidates = self.anchors + list(self.policies)
        if random.random() < p_latest or not candidates:
            return None
        return random.choice(candidates)

    def __len__(self) -> int:
        """Number of FIFO snapshots (anchors are permanent, counted separately)."""
        return len(self.policies)

    def serialize(self) -> list[dict]:
        """Serialize the FIFO tier only. Anchors are re-seeded at construction
        (they come from fixed external checkpoints, not run state)."""
        return list(self.policies)

    @classmethod
    def from_serialized(
        cls, data: list[dict], max_size: int = 10, anchors: list[dict] | None = None
    ) -> "OpponentPool":
        pool = cls(max_size=max_size, anchors=anchors)
        for sd in data[-max_size:]:
            pool.policies.append(sd)
        return pool
