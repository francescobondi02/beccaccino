"""Rollout buffer and episode generation for self-play PPO.

Supports both single-env and vectorized (multi-env) collection.
All 4 seats use the same policy network (self-play).
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
import torch

from becca_env.env import BeccaEnv
from training.network import BeccaNet


class RolloutBuffer:
    """Fixed-size buffer storing transitions as contiguous numpy arrays."""

    def __init__(self, size: int, obs_size: int, action_size: int):
        self.size = size
        self.obs = np.zeros((size, obs_size), dtype=np.float32)
        self.action_masks = np.zeros((size, action_size), dtype=np.float32)
        self.actions = np.zeros(size, dtype=np.int64)
        self.log_probs = np.zeros(size, dtype=np.float32)
        self.values = np.zeros(size, dtype=np.float32)
        self.rewards = np.zeros(size, dtype=np.float32)
        self.dones = np.zeros(size, dtype=np.float32)
        self.ptr = 0
        self.games_completed = 0

    def add(
        self,
        obs: np.ndarray,
        action_mask: np.ndarray,
        action: int,
        log_prob: float,
        value: float,
        reward: float,
        done: bool,
    ):
        self.obs[self.ptr] = obs
        self.action_masks[self.ptr] = action_mask
        self.actions[self.ptr] = action
        self.log_probs[self.ptr] = log_prob
        self.values[self.ptr] = value
        self.rewards[self.ptr] = reward
        self.dones[self.ptr] = float(done)
        if done:
            self.games_completed += 1
        self.ptr += 1

    def add_batch(
        self,
        obs: np.ndarray,
        action_masks: np.ndarray,
        actions: np.ndarray,
        log_probs: np.ndarray,
        values: np.ndarray,
        rewards: np.ndarray,
        dones: np.ndarray,
    ):
        """Add a batch of transitions (from vectorized env)."""
        batch_size = obs.shape[0]
        end = self.ptr + batch_size
        self.obs[self.ptr:end] = obs
        self.action_masks[self.ptr:end] = action_masks
        self.actions[self.ptr:end] = actions
        self.log_probs[self.ptr:end] = log_probs
        self.values[self.ptr:end] = values
        self.rewards[self.ptr:end] = rewards
        self.dones[self.ptr:end] = dones
        self.games_completed += int(dones.sum())
        self.ptr += batch_size

    def compute_gae(
        self, gamma: float = 0.99, lam: float = 0.95
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Compute GAE advantages and returns."""
        n = self.ptr
        advantages = np.zeros(n, dtype=np.float32)

        last_gae = 0.0
        for i in reversed(range(n)):
            if self.dones[i]:
                next_value = 0.0
                last_gae = 0.0
            else:
                next_value = self.values[i + 1] if i + 1 < n else 0.0

            delta = self.rewards[i] + gamma * next_value - self.values[i]
            last_gae = delta + gamma * lam * last_gae
            advantages[i] = last_gae

        returns = advantages + self.values[:n]
        return torch.from_numpy(advantages), torch.from_numpy(returns)

    def to_tensors(self, gamma: float = 0.99, lam: float = 0.95) -> dict[str, torch.Tensor]:
        """Convert buffer contents to tensors for PPO update."""
        n = self.ptr
        advantages, returns = self.compute_gae(gamma, lam)

        return {
            "obs": torch.from_numpy(self.obs[:n]),
            "action_masks": torch.from_numpy(self.action_masks[:n]),
            "actions": torch.from_numpy(self.actions[:n]),
            "old_log_probs": torch.from_numpy(self.log_probs[:n]),
            "old_values": torch.from_numpy(self.values[:n]),
            "advantages": advantages,
            "returns": returns,
        }


def collect_rollout_single(
    env: BeccaEnv,
    net: BeccaNet,
    num_steps: int,
    device: torch.device = torch.device("cpu"),
) -> RolloutBuffer:
    """Collect transitions from a single environment."""
    from becca_env.observation import OBS_SIZE

    buffer = RolloutBuffer(num_steps, OBS_SIZE, 160)
    obs, info = env.reset()

    net.eval()
    with torch.no_grad():
        for _ in range(num_steps):
            obs_t = torch.from_numpy(obs["obs"]).unsqueeze(0).to(device)
            mask_t = torch.from_numpy(obs["action_mask"]).unsqueeze(0).to(device)

            action, log_prob, _, value = net.get_action_and_value(obs_t, mask_t)

            action_int = action.item()
            next_obs, reward, terminated, truncated, step_info = env.step(action_int)

            buffer.add(
                obs=obs["obs"],
                action_mask=obs["action_mask"],
                action=action_int,
                log_prob=log_prob.item(),
                value=value.item(),
                reward=reward,
                done=terminated,
            )

            if terminated:
                obs, info = env.reset()
            else:
                obs = next_obs

    return buffer


def collect_rollout_vec(
    vec_env: gym.vector.VectorEnv,
    net: BeccaNet,
    num_steps: int,
    device: torch.device = torch.device("cpu"),
) -> RolloutBuffer:
    """Collect transitions from a vectorized environment (N parallel games).

    Each step processes all N environments simultaneously, then stores
    N transitions. Total transitions collected = num_steps * num_envs.
    """
    from becca_env.observation import OBS_SIZE

    num_envs = vec_env.num_envs
    total_transitions = num_steps * num_envs
    buffer = RolloutBuffer(total_transitions, OBS_SIZE, 160)

    obs_dict, info = vec_env.reset()

    net.eval()
    with torch.no_grad():
        for _ in range(num_steps):
            obs_batch = obs_dict["obs"]  # (num_envs, OBS_SIZE)
            mask_batch = obs_dict["action_mask"]  # (num_envs, 160)

            obs_t = torch.from_numpy(obs_batch).to(device)
            mask_t = torch.from_numpy(mask_batch).to(device)

            actions, log_probs, _, values = net.get_action_and_value(obs_t, mask_t)

            actions_np = actions.cpu().numpy()
            log_probs_np = log_probs.cpu().numpy()
            values_np = values.cpu().numpy()

            next_obs_dict, rewards, terminateds, truncateds, infos = vec_env.step(actions_np)

            buffer.add_batch(
                obs=obs_batch,
                action_masks=mask_batch,
                actions=actions_np,
                log_probs=log_probs_np,
                values=values_np,
                rewards=np.array(rewards, dtype=np.float32),
                dones=np.array(terminateds, dtype=np.float32),
            )

            obs_dict = next_obs_dict

    return buffer
