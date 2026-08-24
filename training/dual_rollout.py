"""Self-play rollout: each env has a designated 'learner team', and only
learner-team transitions are stored. Opponent-team turns are auto-played by
a frozen opponent network sampled from the OpponentPool.

This is the missing piece that turns 'PPO with self-play' into actual
self-play with strategy diversity. Without it, all 4 seats share the latest
policy and the agent collapses to whatever local optimum happens to come up.

Design choices:
  - In-process: we keep both nets on the main process. On each env step we
    split the batch by acting team (some envs may have learner acting, some
    opponent). One forward through learner_net, one through opponent_net.
  - learner_team_per_env: fixed per env at construction time. Half the envs
    are team 0, half team 1, so the buffer contains balanced experience for
    both perspectives.
  - Reward bookkeeping: BeccaEnv distributes rewards to all 4 seats via
    _pending_rewards. When opponent acts, learner-team seats accumulate
    pending; the next learner action drains it. Terminal residuals for the
    learner team are credited to its last transition via the same helper
    used in single-env rollouts.
"""

from __future__ import annotations

import numpy as np
import torch

from becca_env.game import TEAM_OF_SEAT
from training.network import BeccaNet, BeccaNetV2
from training.rollout import (
    RolloutBuffer,
    _buffer_with_carry,
    _credit_terminal_residuals,
    _extract_terminal_info,
    _mark_latest_transition_done,
    _save_rollout_carry,
)


def collect_self_play_rollout_vec(
    vec_env,
    learner_net: BeccaNet | BeccaNetV2,
    opponent_net: BeccaNet | BeccaNetV2 | None,
    learner_team_per_env: np.ndarray,
    steps_per_env: int,
    device: torch.device,
    critic=None,
) -> RolloutBuffer:
    """Collect a self-play rollout. Returns a buffer holding only learner-team
    transitions.

    Args:
      vec_env: a gym vector env of BeccaEnv instances.
      learner_net: the policy being trained.
      opponent_net: a frozen policy for opponent turns. If None, learner_net
        is reused (this is "vanilla" self-play).
      learner_team_per_env: int array of len num_envs, each in {0, 1}.
      steps_per_env: number of vec env steps to take.
      device: torch device for inference.
      critic: optional CentralizedCritic. When given, stored values come from
        critic(full_obs) and full_obs is stored per transition (CTDE); the
        policy's own value head is left idle. None => legacy actor-value path.

    Buffer is sized for the worst case (every step is learner). Actual ptr
    will be roughly half of that.
    """
    num_envs = vec_env.num_envs
    buf = _buffer_with_carry(vec_env, steps_per_env * num_envs)
    obs_dict = getattr(vec_env, "_becca_rollout_obs", None)
    if obs_dict is None:
        obs_dict, _ = vec_env.reset()
    assert critic is None or "full_obs" in obs_dict, (
        "centralized critic requires vector environments with include_full_obs=True"
    )

    learner_net.eval()
    if opponent_net is not None:
        opponent_net.eval()
    use_opponent = opponent_net is not None
    if critic is not None:
        critic.eval()

    learner_team_per_env = np.asarray(learner_team_per_env, dtype=np.int64)
    assert learner_team_per_env.shape == (num_envs,)

    with torch.no_grad():
        for _ in range(steps_per_env):
            seats_np = np.asarray(obs_dict["current_seat"], dtype=np.int64)

            # Per-env: is the acting seat on the learner team?
            # (current_seat == -1 means terminal; treat as not-learner so we
            # let the env auto-reset; that step won't be stored.)
            acting_team = np.full(num_envs, -1, dtype=np.int64)
            for i in range(num_envs):
                if seats_np[i] >= 0:
                    acting_team[i] = TEAM_OF_SEAT[int(seats_np[i])]
            is_learner = acting_team == learner_team_per_env

            o = torch.from_numpy(obs_dict["obs"]).to(device)
            m = torch.from_numpy(obs_dict["action_mask"]).to(device)

            actions = np.zeros(num_envs, dtype=np.int64)
            log_probs = np.zeros(num_envs, dtype=np.float32)
            values = np.zeros(num_envs, dtype=np.float32)

            # Learner forward (for envs where learner is acting). Action/log_prob
            # always come from the policy; the stored value is the CRITIC's
            # full-state estimate when CTDE is on, else the policy's value head.
            l_idx = np.where(is_learner)[0]
            if l_idx.size > 0:
                idx_t = torch.from_numpy(l_idx).to(device)
                acts_l, lps_l, _, vals_l = learner_net.get_action_and_value(
                    o.index_select(0, idx_t), m.index_select(0, idx_t)
                )
                actions[l_idx] = acts_l.cpu().numpy()
                log_probs[l_idx] = lps_l.cpu().numpy()
                if critic is not None:
                    fo = torch.from_numpy(obs_dict["full_obs"]).to(device)
                    vals_l = critic(fo.index_select(0, idx_t))
                values[l_idx] = vals_l.cpu().numpy()

            # Opponent forward (for envs where opponent is acting)
            o_idx = np.where(~is_learner)[0]
            if o_idx.size > 0:
                idx_t = torch.from_numpy(o_idx).to(device)
                opp = opponent_net if use_opponent else learner_net
                acts_o, _, _, _ = opp.get_action_and_value(
                    o.index_select(0, idx_t), m.index_select(0, idx_t)
                )
                actions[o_idx] = acts_o.cpu().numpy()

            next_obs, rews, dones, _, infos = vec_env.step(actions)

            # Store ONLY learner-team transitions
            for i in range(num_envs):
                if not is_learner[i]:
                    continue
                buf.store(
                    obs_dict["obs"][i],
                    obs_dict["action_mask"][i],
                    actions[i],
                    log_probs[i],
                    values[i],
                    rews[i],
                    dones[i],
                    int(seats_np[i]),
                    env_idx=i,
                    full_obs=obs_dict["full_obs"][i] if critic is not None else None,
                )

            # Credit terminal residuals to learner-team seats
            for i in range(num_envs):
                if not dones[i]:
                    continue
                # Ensure the game boundary is marked on a learner transition even
                # when an opponent seat played the final card (its transition
                # isn't stored). Otherwise compute_gae leaks across the boundary.
                _mark_latest_transition_done(buf, env_idx=i)
                terminal_info = _extract_terminal_info(infos, i)
                if terminal_info is None:
                    continue
                residuals = terminal_info.get("terminal_rewards_by_seat", {})
                # Filter to learner seats only
                learner_seats = {
                    s for s in range(4) if TEAM_OF_SEAT[s] == int(learner_team_per_env[i])
                }
                # Acting seat (if learner): its residual is already in this
                # step's reward; exclude. If opponent: -1 → no exclusion.
                acting = int(seats_np[i]) if is_learner[i] else -1
                filtered = {
                    s: r for s, r in residuals.items() if s in learner_seats and s != acting
                }
                if filtered:
                    _credit_terminal_residuals(
                        buf,
                        {"terminal_rewards_by_seat": filtered},
                        env_idx=i,
                        # pass dummy acting_seat that's not in filtered
                        acting_seat=-1,
                    )

            obs_dict = next_obs

    vec_env._becca_rollout_obs = obs_dict
    _save_rollout_carry(vec_env, buf)
    return buf
