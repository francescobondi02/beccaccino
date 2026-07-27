"""Rollout buffer with per-seat GAE for multi-agent self-play PPO."""

from __future__ import annotations

import gymnasium as gym
import numpy as np
import torch

from becca_env.env import BeccaEnv
from becca_env.observation import FULL_STATE_SIZE, OBS_SIZE
from training.network import BeccaNet, BeccaNetV2

ACTION_SIZE = 160


class RolloutBuffer:
    """Fixed-size buffer with per-(env, seat) Generalized Advantage Estimation.

    Each transition belongs to a (env_idx, seat) trajectory. GAE is computed
    independently per (env_idx, seat) chain so that interleaved storage from
    a vectorized env (e.g. [env0_t0, env1_t0, env0_t1, ...]) does NOT cause
    one env's bootstrap value to leak into another's TD residual.

    For single-env rollouts, pass env_idx=0 throughout.
    """

    def __init__(self, size: int):
        self.obs = np.zeros((size, OBS_SIZE), dtype=np.float32)
        self.masks = np.zeros((size, ACTION_SIZE), dtype=np.float32)
        self.actions = np.zeros(size, dtype=np.int64)
        self.log_probs = np.zeros(size, dtype=np.float32)
        self.values = np.zeros(size, dtype=np.float32)
        self.rewards = np.zeros(size, dtype=np.float32)
        self.dones = np.zeros(size, dtype=np.float32)
        self.seats = np.zeros(size, dtype=np.int32)
        self.env_idx = np.zeros(size, dtype=np.int32)
        # Full-state per transition for the centralized critic. Only populated
        # when a critic is in use (CTDE); left as zeros otherwise.
        self.full_obs = np.zeros((size, FULL_STATE_SIZE), dtype=np.float32)
        self.size = size
        self.ptr = 0
        self.games_done = 0

    def store(
        self,
        obs,
        mask,
        action,
        log_prob,
        value,
        reward,
        done,
        seat: int,
        env_idx: int = 0,
        full_obs=None,
    ):
        i = self.ptr
        self.obs[i] = obs
        self.masks[i] = mask
        self.actions[i] = action
        self.log_probs[i] = log_prob
        self.values[i] = value
        self.rewards[i] = reward
        self.dones[i] = done
        self.seats[i] = seat
        self.env_idx[i] = env_idx
        if full_obs is not None:
            self.full_obs[i] = full_obs
        if done:
            self.games_done += 1
        self.ptr += 1

    def _compute_gae(self, gamma: float, lam: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Per-(env, seat) GAE: each (env_idx, seat) is its own trajectory.

        For step t belonging to (E, S):
          next_value, next_nonterminal = state of (E, S) chain "ahead" in time
          delta_t = r_t + gamma * next_value * next_nonterminal - V(t)
          A_t = delta_t + gamma * lam * next_nonterminal * A_next_for_(E,S)

        When done=True at step t, only the OWNING env's seats reset (because
        only env E ended). Other envs continue their chains undisturbed.

        A live chain's final transition has no next same-seat observation. It
        is used only as the bootstrap value for its predecessor and excluded
        from the returned training mask.
        """
        n = self.ptr
        advantages = np.zeros(n, dtype=np.float32)
        training_mask = np.ones(n, dtype=bool)

        # (env_idx, seat) -> last seen advantage / value / done flag.
        last_adv: dict[tuple[int, int], float] = {}
        last_value: dict[tuple[int, int], float] = {}
        last_done: dict[tuple[int, int], bool] = {}

        for t in reversed(range(n)):
            seat = int(self.seats[t])
            env = int(self.env_idx[t])

            if self.dones[t]:
                # Game ended in env `env` — reset only that env's seats
                for s in range(4):
                    key = (env, s)
                    last_adv[key] = 0.0
                    last_value[key] = 0.0
                    last_done[key] = True

            key = (env, seat)
            if key not in last_value:
                training_mask[t] = False
                last_adv[key] = 0.0
                last_value[key] = self.values[t]
                last_done[key] = False
                continue

            next_value = last_value.get(key, 0.0)
            next_nonterminal = 0.0 if last_done.get(key, True) else 1.0
            delta = self.rewards[t] + gamma * next_value * next_nonterminal - self.values[t]
            advantages[t] = delta + gamma * lam * next_nonterminal * last_adv.get(key, 0.0)

            last_adv[key] = advantages[t]
            last_value[key] = self.values[t]
            last_done[key] = False

        returns = advantages + self.values[:n]
        return advantages, returns, training_mask

    def compute_gae(self, gamma: float, lam: float) -> tuple[np.ndarray, np.ndarray]:
        advantages, returns, training_mask = self._compute_gae(gamma, lam)
        return advantages[training_mask], returns[training_mask]

    def get_batch(
        self,
        gamma: float = 0.995,
        lam: float = 0.95,
        return_normalizer=None,
    ) -> dict[str, torch.Tensor]:
        """Build a tensor batch for the PPO update.

        If `return_normalizer` is provided, rewards are scaled by the running
        std of the discounted return *before* GAE is computed. The normalizer
        is updated in place. Pass the same instance across rollouts so its
        running stats accumulate.
        """
        n = self.ptr
        if return_normalizer is not None and n > 0:
            # Every collector starts this buffer with env.reset(), so transient
            # discounted-return chains from the previous buffer must not cross
            # that artificial episode boundary. Running variance remains intact.
            return_normalizer.reset_returns()
            scaled = return_normalizer.normalize_batch(
                self.env_idx[:n], self.seats[:n], self.rewards[:n], self.dones[:n]
            )
            # Save original, swap in scaled rewards just for GAE compute, restore.
            original = self.rewards[:n].copy()
            self.rewards[:n] = scaled
            try:
                advs, rets, training_mask = self._compute_gae(gamma, lam)
            finally:
                self.rewards[:n] = original
        else:
            advs, rets, training_mask = self._compute_gae(gamma, lam)

        if not training_mask.any():
            raise ValueError("rollout has no complete transitions after trimming live tails")

        return {
            "obs": torch.from_numpy(self.obs[:n][training_mask]),
            "masks": torch.from_numpy(self.masks[:n][training_mask]),
            "actions": torch.from_numpy(self.actions[:n][training_mask]),
            "log_probs": torch.from_numpy(self.log_probs[:n][training_mask]),
            "values": torch.from_numpy(self.values[:n][training_mask]),
            "advantages": torch.from_numpy(advs[training_mask]),
            "returns": torch.from_numpy(rets[training_mask]),
            "full_obs": torch.from_numpy(self.full_obs[:n][training_mask]),
        }


def _credit_terminal_residuals(
    buf: RolloutBuffer, info: dict, env_idx: int, acting_seat: int
) -> None:
    """When an env terminates, the env exposes residual pending rewards for
    the 3 non-acting seats via info["terminal_rewards_by_seat"]. Credit each
    residual to the most recent transition in the buffer for (env_idx, seat).
    Without this, those rewards are silently dropped.
    """
    residuals = info.get("terminal_rewards_by_seat")
    if not residuals:
        return
    # Walk back from the buffer end to find each seat's last entry in env_idx
    seats_needed = {s for s, r in residuals.items() if s != acting_seat and abs(r) > 1e-12}
    if not seats_needed:
        return
    end = buf.ptr - 1  # the just-stored terminal transition
    for t in range(end, -1, -1):
        if not seats_needed:
            break
        if int(buf.env_idx[t]) != env_idx:
            continue
        s = int(buf.seats[t])
        if s in seats_needed:
            buf.rewards[t] += residuals[s]
            seats_needed.discard(s)


def _mark_latest_transition_done(buf: RolloutBuffer, env_idx: int) -> None:
    """Stamp done=1.0 on env_idx's most recent stored transition.

    In selective-storage self-play only learner-team transitions are stored, so
    when an OPPONENT seat plays the game-ending card its (unstored) transition
    carries the terminal done — and no learner transition does. compute_gae then
    never cuts env_idx's trajectory and leaks values/rewards across the game
    boundary into the next game. A done on any one of env_idx's transitions
    resets all 4 of its seats in compute_gae, so a single stamp suffices.
    Idempotent: if the learner acted on the terminal step, that transition
    already carries done=1.0 and this is a no-op.
    """
    for t in range(buf.ptr - 1, -1, -1):
        if int(buf.env_idx[t]) == env_idx:
            if buf.dones[t] == 0.0:
                buf.dones[t] = 1.0
                buf.games_done += 1  # keep the stat honest for opponent-ended games
            return


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
            buf.store(
                obs["obs"], obs["action_mask"], a, lp.item(), val.item(), rew, done, seat, env_idx=0
            )

            if done:
                _credit_terminal_residuals(buf, step_info, env_idx=0, acting_seat=seat)
                obs = env.reset()[0]
            else:
                obs = next_obs

    return buf


def collect_rollout_vec(
    vec_env: gym.vector.VectorEnv,
    net: BeccaNet | BeccaNetV2,
    steps_per_env: int,
    device: torch.device,
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

            next_obs, rews, dones, _, infos = vec_env.step(acts_np)

            for i in range(num_envs):
                buf.store(
                    obs_dict["obs"][i],
                    obs_dict["action_mask"][i],
                    acts_np[i],
                    lps_np[i],
                    vals_np[i],
                    rews[i],
                    dones[i],
                    int(seats_np[i]),
                    env_idx=i,
                )

            # On any env that just terminated, credit residual rewards for the
            # 3 non-acting seats to their last transition in this buffer.
            for i in range(num_envs):
                if not dones[i]:
                    continue
                # gymnasium AsyncVectorEnv batches infos; on terminal step the
                # actual info dict is under infos["final_info"][i] (list-style)
                # or infos[i] (dict-of-arrays style). Handle both.
                terminal_info = _extract_terminal_info(infos, i)
                if terminal_info is None:
                    continue
                _credit_terminal_residuals(
                    buf, terminal_info, env_idx=i, acting_seat=int(seats_np[i])
                )

            obs_dict = next_obs

    return buf


def _extract_terminal_info(infos, env_index: int) -> dict | None:
    """Pull the terminal info for env_index from a gym vector infos struct.

    Gymnasium AsyncVectorEnv returns infos as a dict-of-arrays. Per-env
    terminal info is under infos["final_info"], which is itself a dict where
    each value is an array of len num_envs (one entry per env). The
    `_final_info` mask tells us which envs actually terminated.

    We extract `terminal_rewards_by_seat[seat]` for each of the 4 seats and
    repackage as a {seat: scalar} dict for the caller. Returns None if no
    terminal info is available for this env_index.
    """
    if not isinstance(infos, dict):
        return None
    final = infos.get("final_info")
    if not isinstance(final, dict):
        return None
    mask = infos.get("_final_info")
    if mask is not None and env_index < len(mask) and not bool(mask[env_index]):
        return None  # this env did not terminate

    trbs = final.get("terminal_rewards_by_seat")
    if not isinstance(trbs, dict):
        return None

    per_seat: dict[int, float] = {}
    for s in range(4):
        arr = trbs.get(s)
        if arr is None:
            continue
        if env_index >= len(arr):
            continue
        # Optional sub-mask `_<seat>` indicates which entries are valid
        sub_mask = trbs.get(f"_{s}")
        if sub_mask is not None and env_index < len(sub_mask) and not bool(sub_mask[env_index]):
            continue
        per_seat[s] = float(arr[env_index])
    if not per_seat:
        return None
    return {"terminal_rewards_by_seat": per_seat}
