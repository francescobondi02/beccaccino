"""Gymnasium environment wrapper for Beccaccino.

Multi-agent turn-based game exposed as single-agent env (self-play).
All 4 seats share the same policy network.

Reward design (v2 — properly scaled):
  - Trick completion: ±(raw_pts / 35) — normalized by max round total.
  - Game terminal: ±1.0 for winning/losing team.
  - Per-seat deferred delivery ensures all seats get learning signal.
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from becca_env.deck import card_points
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase
from becca_env.observation import OBS_SIZE, decode_action, encode_action_mask, encode_observation

MAX_RAW_PER_ROUND = 35


class BeccaEnv(gym.Env):

    metadata = {"render_modes": []}

    def __init__(self, seed: int | None = None, win_points: int = 41):
        super().__init__()
        self._base_seed = seed
        self._game_count = 0
        self._win_points = win_points
        self.game: BeccaGame | None = None
        self._pending_rewards: dict[int, float] = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}

        self.action_space = spaces.Discrete(160)
        self.observation_space = spaces.Dict({
            "obs": spaces.Box(low=0.0, high=1.0, shape=(OBS_SIZE,), dtype=np.float32),
            "action_mask": spaces.Box(low=0.0, high=1.0, shape=(160,), dtype=np.float32),
            "current_seat": spaces.Discrete(4),
        })

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            effective_seed = seed
        elif self._base_seed is not None:
            effective_seed = self._base_seed + self._game_count
        else:
            effective_seed = None
        self._game_count += 1
        self.game = BeccaGame(seed=effective_seed, win_points=self._win_points)
        self._pending_rewards = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
        return self._get_obs(), {"current_seat": self.game.current_seat}

    def step(self, action: int):
        if self.game is None or self.game.phase == GamePhase.GAME_OVER:
            raise ValueError("Game is over or not started. Call reset().")

        seat = self.game.current_seat
        team = TEAM_OF_SEAT[seat]

        reward = self._pending_rewards[seat]
        self._pending_rewards[seat] = 0.0

        game_action = decode_action(action, self.game)
        info = self.game.step(game_action)
        event = info.get("event")

        terminated = self.game.phase == GamePhase.GAME_OVER

        if event in ("trick_complete", "round_end", "game_over"):
            trick_winner_team = TEAM_OF_SEAT[info["trick_winner"]]
            trick_cards = self.game.round.hands_played[-1].cards
            raw_pts = sum(card_points[c.value] for _, c in trick_cards)
            trick_reward = raw_pts / MAX_RAW_PER_ROUND
            for s in range(4):
                s_team = TEAM_OF_SEAT[s]
                r = trick_reward if trick_winner_team == s_team else -trick_reward
                self._pending_rewards[s] += r
            reward += self._pending_rewards[seat]
            self._pending_rewards[seat] = 0.0

        if event == "game_over":
            reward += 1.0 if info["game_winner"] == team else -1.0

        obs = self._get_obs() if not terminated else self._terminal_obs()
        info["acting_seat"] = seat
        info["acting_team"] = team
        info["current_seat"] = -1 if terminated else self.game.current_seat

        return obs, reward, terminated, False, info

    def _get_obs(self) -> dict:
        seat = self.game.current_seat
        return {
            "obs": encode_observation(self.game, seat),
            "action_mask": encode_action_mask(self.game, seat),
            "current_seat": np.int64(seat),
        }

    def _terminal_obs(self) -> dict:
        return {
            "obs": np.zeros(OBS_SIZE, dtype=np.float32),
            "action_mask": np.zeros(160, dtype=np.float32),
            "current_seat": np.int64(-1),
        }
