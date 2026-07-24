"""Running statistics for reward/return normalization.

Two related primitives:

  - RunningMeanStd: Welford's online mean/variance over a stream of scalars.
  - ReturnNormalizer: maintains a running estimate of return std using
    discounted forward returns (the standard CleanRL / SB3 trick). Rewards
    are divided by sqrt(var(returns)) so the value function targets stay
    O(1) regardless of game length / reward magnitude.

The return-normalizer keeps a per-(env, seat) "running discounted return"
counter:  R_{t} = gamma * R_{t-1} + r_t
and feeds R into the running stats — this estimates the std of *what the
value function is being asked to fit*, which is exactly the quantity that
matters for stability.
"""

from __future__ import annotations

import numpy as np


class RunningMeanStd:
    """Welford's online algorithm for computing running mean and variance.

    Scalar variant: feed it 1-D arrays of samples; tracks mean & var over the
    union of all samples seen so far.
    """

    def __init__(self):
        self.mean = 0.0
        self.var = 1.0
        self.count = 1e-4

    def update(self, x: np.ndarray):
        x = np.asarray(x).ravel()
        if x.size == 0:
            return
        batch_mean = float(x.mean())
        batch_var = float(x.var())
        batch_count = x.size
        self._update_from_moments(batch_mean, batch_var, batch_count)

    def _update_from_moments(self, batch_mean: float, batch_var: float, batch_count: int):
        delta = batch_mean - self.mean
        total = self.count + batch_count
        new_mean = self.mean + delta * batch_count / total
        m_a = self.var * self.count
        m_b = batch_var * batch_count
        m2 = m_a + m_b + delta**2 * self.count * batch_count / total
        self.mean = new_mean
        self.var = m2 / total
        self.count = total

    def normalize(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean) / (np.sqrt(self.var) + 1e-8)

    @property
    def std(self) -> float:
        return float(np.sqrt(self.var))

    def to_dict(self) -> dict:
        return {"mean": self.mean, "var": self.var, "count": self.count}

    def from_dict(self, state: dict) -> None:
        self.mean = state["mean"]
        self.var = state["var"]
        self.count = state["count"]


class ReturnNormalizer:
    """Per-(env, seat) discounted-return tracker for reward scaling.

    Usage:
        rn = ReturnNormalizer(gamma=0.995)
        for each transition (env_idx, seat, reward, done):
            scaled_reward = rn.normalize(env_idx, seat, reward, done)
            buffer.store(reward=scaled_reward, ...)
        # At end of rollout (or never — it's online), nothing to flush.

    Notes:
      - Division uses sqrt(var) of the running discounted return, NOT mean
        subtraction. Subtracting mean would bias the policy toward seeking
        below-average rewards. Standard PPO uses scaling only.
      - On done=True we reset that (env, seat)'s running return to 0.
    """

    def __init__(self, gamma: float = 0.995, epsilon: float = 1e-8):
        self.gamma = gamma
        self.epsilon = epsilon
        self.rms = RunningMeanStd()
        self._returns: dict[tuple[int, int], float] = {}

    def normalize(self, env_idx: int, seat: int, reward: float, done: bool) -> float:
        key = (int(env_idx), int(seat))
        prev = self._returns.get(key, 0.0)
        new_return = self.gamma * prev * (0.0 if done else 1.0) + reward
        self._returns[key] = 0.0 if done else new_return
        # Update running stats with this return sample
        self.rms.update(np.array([new_return], dtype=np.float32))
        return reward / (np.sqrt(self.rms.var) + self.epsilon)

    def normalize_batch(
        self,
        env_indices: np.ndarray,
        seats: np.ndarray,
        rewards: np.ndarray,
        dones: np.ndarray,
    ) -> np.ndarray:
        """Vectorized convenience: process a list of transitions in order.
        Required because the running return depends on prior transitions in
        the same (env, seat) chain.
        """
        scaled = np.empty_like(rewards, dtype=np.float32)
        for i in range(len(rewards)):
            scaled[i] = self.normalize(
                int(env_indices[i]), int(seats[i]), float(rewards[i]), bool(dones[i])
            )
        return scaled.astype(np.float32)

    def to_dict(self) -> dict:
        """Serialize the load-bearing running-std state. The transient per-(env,
        seat) _returns dict is NOT persisted — it's rebuilt within a rollout and
        carries no cross-run information."""
        return {"gamma": self.gamma, "epsilon": self.epsilon, "rms": self.rms.to_dict()}

    def from_dict(self, state: dict) -> None:
        self.gamma = state["gamma"]
        self.epsilon = state["epsilon"]
        self.rms.from_dict(state["rms"])
