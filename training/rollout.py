"""Rollout buffer with per-seat GAE for multi-agent self-play PPO."""

from __future__ import annotations

import gymnasium as gym
import numpy as np
import torch

from becca_env.env import BeccaEnv
from becca_env.observation import OBS_SIZE
from training.network import BeccaNet, BeccaNetV2

ACTION_SIZE = 160


class RolloutBuffer:
    """Fixed-size buffer with per-seat Generalized Advantage Estimation."""

    def __init__(self, size: int):
        self.obs = np.zeros((size, OBS_SIZE), dtype=np.float32)
        self.masks = np.zeros((size, ACTION_SIZE), dtype=np.float32)
        self.actions = np.zeros(size, dtype=np.int64)
        self.log_probs = np.zeros(size, dtype=np.float32)
        self.values = np.zeros(size, dtype=np.float32)
        self.rewards = np.zeros(size, dtype=np.float32)
        self.dones = np.zeros(size, dtype=np.float32)
        self.seats = np.zeros(size, dtype=np.int32)
        self.size = size
        self.ptr = 0
        self.games_done = 0

    def store(self, obs, mask, action, log_prob, value, reward, done, seat: int):
        i = self.ptr
        self.obs[i] = obs
        self.masks[i] = mask
        self.actions[i] = action
        self.log_probs[i] = log_prob
        self.values[i] = value
        self.rewards[i] = reward
        self.dones[i] = done
        self.seats[i] = seat
        if done:
            self.games_done += 1
        self.ptr += 1

    def compute_gae(self, gamma: float, lam: float) -> tuple[np.ndarray, np.ndarray]:
        """Per-seat GAE: compute advantages within each seat's own trajectory.

        For each step t where seat S acts:
          delta_t = r_t + gamma * V(next step where S acts) * (1 - done_between) - V(t)
          A_t = delta_t + gamma * lam * A(next step where S acts)

        On game boundaries (done=True), all seats' running advantages reset to 0.
        """
        n = self.ptr
        advantages = np.zeros(n, dtype=np.float32)

        # Per-seat tracking: last seen advantage and value for GAE chaining
        seat_last_adv = {s: 0.0 for s in range(4)}
        seat_last_value = {s: 0.0 for s in range(4)}
        seat_last_done = {s: True for s in range(4)}

        for t in reversed(range(n)):
            seat = int(self.seats[t])

            if self.dones[t]:
                # Game ended at this step — reset ALL seats
                for s in range(4):
                    seat_last_adv[s] = 0.0
                    seat_last_value[s] = 0.0
                    seat_last_done[s] = True

            # TD residual: r_t + gamma * V_next * (1 - done) - V_t
            next_value = seat_last_value[seat]
            next_nonterminal = 1.0 - float(seat_last_done[seat])
            delta = self.rewards[t] + gamma * next_value * next_nonterminal - self.values[t]

            # GAE accumulation within this seat's trajectory
            advantages[t] = delta + gamma * lam * next_nonterminal * seat_last_adv[seat]

            # Update seat's state for the next iteration (going backwards)
            seat_last_adv[seat] = advantages[t]
            seat_last_value[seat] = self.values[t]
            seat_last_done[seat] = False  # this step wasn't terminal for earlier steps

        returns = advantages + self.values[:n]
        return advantages, returns

    def get_batch(self, gamma: float = 0.995, lam: float = 0.95) -> dict[str, torch.Tensor]:
        n = self.ptr
        advs, rets = self.compute_gae(gamma, lam)

        return {
            "obs": torch.from_numpy(self.obs[:n]),
            "masks": torch.from_numpy(self.masks[:n]),
            "actions": torch.from_numpy(self.actions[:n]),
            "log_probs": torch.from_numpy(self.log_probs[:n]),
            "values": torch.from_numpy(self.values[:n]),
            "advantages": torch.from_numpy(advs),
            "returns": torch.from_numpy(rets),
        }


def collect_rollout(
    env: BeccaEnv, net: BeccaNet | BeccaNetV2, num_steps: int, device: torch.device
) -> RolloutBuffer:
    buf = RolloutBuffer(num_steps)
    obs, info = env.reset()

    net.eval()
    with torch.no_grad():
        for _ in range(num_steps):
            seat = int(obs["current_seat"])
            o = torch.from_numpy(obs["obs"]).unsqueeze(0).to(device)
            m = torch.from_numpy(obs["action_mask"]).unsqueeze(0).to(device)
            act, lp, _, val = net.get_action_and_value(o, m)

            a = act.item()
            next_obs, rew, done, _, step_info = env.step(a)
            buf.store(obs["obs"], obs["action_mask"], a, lp.item(), val.item(), rew, done, seat)

            obs = next_obs if not done else env.reset()[0]

    return buf


def collect_rollout_vec(
    vec_env: gym.vector.VectorEnv, net: BeccaNet | BeccaNetV2, steps_per_env: int,
    device: torch.device
) -> RolloutBuffer:
    num_envs = vec_env.num_envs
    buf = RolloutBuffer(steps_per_env * num_envs)
    obs_dict, _ = vec_env.reset()

    net.eval()
    with torch.no_grad():
        for _ in range(steps_per_env):
            o = torch.from_numpy(obs_dict["obs"]).to(device)
            m = torch.from_numpy(obs_dict["action_mask"]).to(device)
            acts, lps, _, vals = net.get_action_and_value(o, m)

            acts_np = acts.cpu().numpy()
            lps_np = lps.cpu().numpy()
            vals_np = vals.cpu().numpy()
            seats_np = obs_dict["current_seat"]

            next_obs, rews, dones, _, _ = vec_env.step(acts_np)

            for i in range(num_envs):
                buf.store(
                    obs_dict["obs"][i], obs_dict["action_mask"][i],
                    acts_np[i], lps_np[i], vals_np[i], rews[i], dones[i],
                    int(seats_np[i]),
                )

            obs_dict = next_obs

    return buf
