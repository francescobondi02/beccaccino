"""Opponent pool for self-play diversity.

Maintains a FIFO queue of historical policy checkpoints. During training,
opponents are sampled from the pool to prevent strategy cycling.
"""

from __future__ import annotations

import copy
import random
from collections import deque


class OpponentPool:
    """Pool of frozen historical policies for opponent sampling."""

    def __init__(self, max_size: int = 10):
        self.policies: deque[dict] = deque(maxlen=max_size)
        self.max_size = max_size

    def add_policy(self, state_dict: dict):
        """Add a snapshot of the current policy to the pool."""
        self.policies.append(copy.deepcopy(state_dict))

    def sample(self, p_latest: float = 0.8) -> dict | None:
        """Sample an opponent policy.

        Returns None to indicate "use current policy" (self-play),
        or a state_dict to load into the opponent network.

        Args:
            p_latest: probability of using the current (latest) policy
        """
        if random.random() < p_latest or len(self.policies) == 0:
            return None
        return random.choice(self.policies)

    def __len__(self) -> int:
        return len(self.policies)

    def serialize(self) -> list[dict]:
        return list(self.policies)

    @classmethod
    def from_serialized(cls, data: list[dict], max_size: int = 10) -> "OpponentPool":
        pool = cls(max_size=max_size)
        for sd in data[-max_size:]:
            pool.policies.append(sd)
        return pool
