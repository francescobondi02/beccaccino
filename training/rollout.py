"""Rollout buffer and episode generation for self-play PPO.

In Beccaccino self-play, all 4 seats use the same policy network.
Each step in the environment is one player's action. We store transitions
per-seat and compute advantages per-seat (since teammates share rewards
but opponents have inverted rewards).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import torch

from becca_env.env import BeccaEnv
from becca_env.game import TEAM_OF_SEAT
from training.network import BeccaNet


@dataclass
class Transition:
    obs: np.ndarray
    action_mask: np.ndarray
    action: int
    log_prob: float
    value: float
    reward: float
    done: bool
    seat: int
    team: int


@dataclass
class RolloutBuffer:
    transitions: list[Transition] = field(default_factory=list)

    def add(self, t: Transition):
        self.transitions.append(t)

    def __len__(self):
        return len(self.transitions)

    def compute_advantages(
        self, gamma: float = 0.99, lam: float = 0.95
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Compute GAE advantages and returns.

        Returns (advantages, returns) tensors aligned with self.transitions.
        """
        n = len(self.transitions)
        advantages = np.zeros(n, dtype=np.float32)
        returns = np.zeros(n, dtype=np.float32)

        last_gae = 0.0
        last_value = 0.0

        for i in reversed(range(n)):
            t = self.transitions[i]
            if t.done:
                next_value = 0.0
                last_gae = 0.0
            else:
                # Find the next transition for the same seat
                next_value = last_value

            delta = t.reward + gamma * next_value - t.value
            last_gae = delta + gamma * lam * last_gae
            advantages[i] = last_gae
            returns[i] = advantages[i] + t.value
            last_value = t.value

        return torch.from_numpy(advantages), torch.from_numpy(returns)

    def to_tensors(self) -> dict[str, torch.Tensor]:
        """Convert buffer to tensors for training."""
        obs = torch.from_numpy(np.array([t.obs for t in self.transitions]))
        masks = torch.from_numpy(np.array([t.action_mask for t in self.transitions]))
        actions = torch.tensor([t.action for t in self.transitions], dtype=torch.long)
        log_probs = torch.tensor([t.log_prob for t in self.transitions], dtype=torch.float32)
        values = torch.tensor([t.value for t in self.transitions], dtype=torch.float32)

        advantages, returns = self.compute_advantages()

        return {
            "obs": obs,
            "action_masks": masks,
            "actions": actions,
            "old_log_probs": log_probs,
            "old_values": values,
            "advantages": advantages,
            "returns": returns,
        }

    def clear(self):
        self.transitions.clear()


def collect_self_play_rollout(
    env: BeccaEnv,
    net: BeccaNet,
    num_steps: int,
    device: torch.device = torch.device("cpu"),
) -> RolloutBuffer:
    """Collect a rollout of self-play transitions.

    All 4 seats use the same network. We collect `num_steps` total transitions
    across potentially multiple games.
    """
    buffer = RolloutBuffer()
    obs, info = env.reset()

    net.eval()
    with torch.no_grad():
        for _ in range(num_steps):
            seat = int(obs["current_seat"])
            team = TEAM_OF_SEAT[seat]

            obs_t = torch.from_numpy(obs["obs"]).unsqueeze(0).to(device)
            mask_t = torch.from_numpy(obs["action_mask"]).unsqueeze(0).to(device)

            action, log_prob, _, value = net.get_action_and_value(obs_t, mask_t)

            action_int = action.item()
            log_prob_val = log_prob.item()
            value_val = value.item()

            next_obs, reward, terminated, truncated, step_info = env.step(action_int)

            buffer.add(Transition(
                obs=obs["obs"].copy(),
                action_mask=obs["action_mask"].copy(),
                action=action_int,
                log_prob=log_prob_val,
                value=value_val,
                reward=reward,
                done=terminated,
                seat=seat,
                team=team,
            ))

            if terminated:
                obs, info = env.reset()
            else:
                obs = next_obs

    return buffer
