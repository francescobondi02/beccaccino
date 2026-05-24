"""Self-play environment wrapper that auto-plays opponent team's turns.

Converts the 4-player self-play into a 2-player (team vs team) formulation
where only the learner's turns are exposed to the training loop.
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
import torch

from becca_env.env import BeccaEnv
from becca_env.game import TEAM_OF_SEAT
from training.network import BeccaNet, BeccaNetV2


class SelfPlayEnv(gym.Env):
    """Wraps BeccaEnv so that one team is the 'learner' and the other uses a frozen opponent.

    Only exposes steps where the learner team acts, making the trajectory
    sequential from the learner's perspective (simplifies GAE).
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        seed: int | None = None,
        win_points: int = 41,
        learner_team: int = 0,
        opponent_net: BeccaNet | BeccaNetV2 | None = None,
        opponent_device: torch.device = torch.device("cpu"),
    ):
        super().__init__()
        self._env = BeccaEnv(seed=seed, win_points=win_points)
        self._learner_team = learner_team
        self._opponent_net = opponent_net
        self._opponent_device = opponent_device

        self.action_space = self._env.action_space
        self.observation_space = self._env.observation_space

    def set_opponent(self, net: BeccaNet | BeccaNetV2 | None):
        """Update the opponent policy (can be called between episodes)."""
        self._opponent_net = net

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        obs, info = self._env.reset(seed=seed, options=options)
        # If opponent acts first, auto-play until it's the learner's turn
        obs, info = self._advance_opponent(obs, info)
        return obs, info

    def step(self, action: int):
        obs, reward, terminated, truncated, info = self._env.step(action)
        if terminated:
            return obs, reward, terminated, truncated, info

        # Accumulate reward while opponent plays
        obs, info, extra_reward, terminated = self._play_opponent_turns(obs, info)
        reward += extra_reward

        return obs, reward, terminated, truncated, info

    def _advance_opponent(self, obs: dict, info: dict) -> tuple[dict, dict]:
        """Play opponent turns at the start of a game until learner acts."""
        while not self._is_learner_turn(obs) and self._env.game is not None:
            if self._env.game.phase.name == "GAME_OVER":
                break
            action = self._get_opponent_action(obs)
            obs, _, terminated, _, info = self._env.step(action)
            if terminated:
                break
        return obs, info

    def _play_opponent_turns(
        self, obs: dict, info: dict
    ) -> tuple[dict, dict, float, bool]:
        """Auto-play all opponent turns, accumulating learner rewards."""
        extra_reward = 0.0
        while not self._is_learner_turn(obs):
            if self._env.game is None or self._env.game.phase.name == "GAME_OVER":
                return obs, info, extra_reward, True
            action = self._get_opponent_action(obs)
            obs, r, terminated, _, info = self._env.step(action)
            # Reward from opponent's step that belongs to the learner (deferred)
            # is captured in the env's _pending_rewards and delivered on learner's next step
            if terminated:
                return obs, info, extra_reward, True
        return obs, info, extra_reward, False

    def _is_learner_turn(self, obs: dict) -> bool:
        seat = int(obs["current_seat"])
        if seat < 0:
            return True  # terminal
        return TEAM_OF_SEAT[seat] == self._learner_team

    @torch.no_grad()
    def _get_opponent_action(self, obs: dict) -> int:
        if self._opponent_net is None:
            # Random opponent fallback
            mask = obs["action_mask"]
            legal = np.where(mask > 0)[0]
            return int(np.random.choice(legal))

        o = torch.from_numpy(obs["obs"]).unsqueeze(0).to(self._opponent_device)
        m = torch.from_numpy(obs["action_mask"]).unsqueeze(0).to(self._opponent_device)
        self._opponent_net.eval()
        act, _, _, _ = self._opponent_net.get_action_and_value(o, m)
        return act.item()
