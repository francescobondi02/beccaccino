"""Gymnasium environment wrapper for Beccaccino.

This is a multi-agent environment where 4 players take turns.
We expose it as a single-agent env where the "agent" controls all 4 seats
(useful for self-play training).
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase
from becca_env.observation import OBS_SIZE, decode_action, encode_action_mask, encode_observation


class BeccaEnv(gym.Env):
    """Gymnasium environment for Beccaccino self-play.

    Observation: dict with "obs" (feature vector) and "action_mask" (legal actions).
    Action: integer index into the 160-slot action space.

    The environment cycles through all 4 players. Each step() call is one
    player's action. The reward is given from the perspective of the acting
    player's team.
    """

    metadata = {"render_modes": ["human"]}

    def __init__(self, seed: int | None = None, win_points: int = 41):
        super().__init__()
        self._seed = seed
        self._win_points = win_points
        self.game: BeccaGame | None = None

        self.action_space = spaces.Discrete(160)
        self.observation_space = spaces.Dict({
            "obs": spaces.Box(low=0.0, high=1.0, shape=(OBS_SIZE,), dtype=np.float32),
            "action_mask": spaces.Box(low=0.0, high=1.0, shape=(160,), dtype=np.float32),
            "current_seat": spaces.Discrete(4),
        })

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        effective_seed = seed if seed is not None else self._seed
        self.game = BeccaGame(seed=effective_seed, win_points=self._win_points)

        obs = self._get_obs()
        info = {"current_seat": self.game.current_seat}
        return obs, info

    def step(self, action: int):
        if self.game is None or self.game.phase == GamePhase.GAME_OVER:
            raise ValueError("Game is over or not started. Call reset().")

        seat = self.game.current_seat
        team = TEAM_OF_SEAT[seat]

        # Decode and execute
        game_action = decode_action(action, self.game)
        info = self.game.step(game_action)

        # Compute reward
        reward = self._compute_reward(info, team)

        # Check termination
        terminated = self.game.phase == GamePhase.GAME_OVER
        truncated = False

        obs = self._get_obs() if not terminated else self._terminal_obs()

        info["acting_seat"] = seat
        info["acting_team"] = team
        if terminated:
            info["current_seat"] = -1
        else:
            info["current_seat"] = self.game.current_seat

        return obs, reward, terminated, truncated, info

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

    def _compute_reward(self, info: dict, team: int) -> float:
        """Reward shaping (cumulative — terminal steps include all components):
        - Per trick won by my team: +0.1
        - Per trick lost: -0.1
        - Round win: +1.0, round loss: -1.0
        - Game win: +5.0, game loss: -5.0

        Events cascade: game_over implies round_end implies trick_complete.
        We accumulate all applicable rewards so the terminal step isn't undersized.
        """
        reward = 0.0
        event = info.get("event")

        # Trick reward (applies to trick_complete, round_end, and game_over)
        if event in ("trick_complete", "round_end", "game_over"):
            winner_seat = info.get("trick_winner")
            if winner_seat is not None:
                winner_team = TEAM_OF_SEAT[winner_seat]
                reward += 0.1 if winner_team == team else -0.1

        # Round reward (applies to round_end and game_over)
        if event in ("round_end", "game_over"):
            round_winner = info.get("round_winner")
            if round_winner is not None:
                reward += 1.0 if round_winner == team else -1.0

        # Game reward
        if event == "game_over":
            game_winner = info["game_winner"]
            reward += 5.0 if game_winner == team else -5.0

        return reward
