"""Gymnasium environment wrapper for Beccaccino.

Multi-agent turn-based game exposed as single-agent env (self-play).
All 4 seats share the same policy network.

Reward design (v3 — round-end shaping, terminal-dominated):
  - Round end:  ±(team_raw - opp_raw) / MAX_RAW_PER_ROUND for each seat,
                where MAX_RAW_PER_ROUND=35 is the max raw points obtainable
                in a single round (32 cards + 3 last-trick bonus). Range ≈ ±1.
  - Game terminal: ±1.0 for winning/losing team (acting seat only — others
                already received their share via the final round-end reward).
  - Optional trick shaping: ±(raw_pts/35) × trick_shaping_coef per trick.
                Default coef=0.0 (off). Useful as a curriculum hint:
                non-zero early, annealed to 0.

  Why round-end (not per-trick) by default? Per-trick reward is biased
  shaping that pushes the agent toward greedy trick-grabbing — which is
  often *wrong* in Beccaccino (e.g. dumping a low card on partner's Asso,
  letting opponents waste briscole early, etc.). Round-end shaping is
  unbiased w.r.t. correct play and dense enough for stable PPO learning
  via GAE propagation.

  All rewards are delivered via deferred per-seat queues so every seat
  gets credited even though only one seat acts per env step.
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from becca_env.deck import card_points
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase
from becca_env.observation import (
    FULL_STATE_SIZE,
    OBS_SIZE,
    decode_action,
    encode_action_mask,
    encode_full_state,
    encode_observation,
)

MAX_RAW_PER_ROUND = 35


class BeccaEnv(gym.Env):

    metadata = {"render_modes": []}

    def __init__(
        self,
        seed: int | None = None,
        win_points: int = 41,
        trick_shaping_coef: float = 0.0,
    ):
        super().__init__()
        self._base_seed = seed
        self._game_count = 0
        self._win_points = win_points
        self.trick_shaping_coef = float(trick_shaping_coef)
        self.game: BeccaGame | None = None
        self._pending_rewards: dict[int, float] = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}

        self.action_space = spaces.Discrete(160)
        self.observation_space = spaces.Dict({
            "obs": spaces.Box(low=0.0, high=1.0, shape=(OBS_SIZE,), dtype=np.float32),
            # Full state (actor obs + hidden hands) for the centralized critic.
            # Train-time only; the policy and serving never read it.
            "full_obs": spaces.Box(low=0.0, high=1.0, shape=(FULL_STATE_SIZE,), dtype=np.float32),
            "action_mask": spaces.Box(low=0.0, high=1.0, shape=(160,), dtype=np.float32),
            "current_seat": spaces.Discrete(4),
        })

    def set_trick_shaping_coef(self, coef: float) -> None:
        """Adjust the trick-shaping coefficient (e.g. for annealing)."""
        self.trick_shaping_coef = float(coef)

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

        # Optional per-trick shaping (off by default).
        # Note: round_end / game_over events also include the final trick's
        # data (trick_winner, trick_cards), so we apply shaping there too.
        if (
            self.trick_shaping_coef != 0.0
            and event in ("trick_complete", "round_end", "game_over")
        ):
            self._distribute_trick_shaping(info)

        # Round-end shaping: dense, unbiased, fires every ~40 env steps.
        if event in ("round_end", "game_over"):
            self._distribute_round_end(info)

        # Game terminal: ±1.0 for the team that won. Only deliver to seats
        # other than acting seat; acting seat we add directly to `reward`
        # so it's part of THIS step's return (terminal step has no "next").
        if event == "game_over":
            self._distribute_game_terminal(info["game_winner"])

        # Drain whatever now belongs to the acting seat (round-end + terminal
        # for this seat both flow through _pending_rewards).
        reward += self._pending_rewards[seat]
        self._pending_rewards[seat] = 0.0

        obs = self._get_obs() if not terminated else self._terminal_obs()
        info["acting_seat"] = seat
        info["acting_team"] = team
        info["current_seat"] = -1 if terminated else self.game.current_seat

        # On terminal: the other 3 seats won't act again, so their pending
        # reward (final round-end + game terminal) would otherwise be lost.
        # Surface it to the rollout buffer via info so it can be credited
        # to each seat's last transition.
        if terminated:
            info["terminal_rewards_by_seat"] = dict(self._pending_rewards)
            self._pending_rewards = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}

        return obs, reward, terminated, False, info

    # ---------------- reward distribution helpers ----------------

    def _distribute_trick_shaping(self, info: dict) -> None:
        trick_winner_team = TEAM_OF_SEAT[info["trick_winner"]]
        raw_pts = sum(card_points[c.value] for _, c in info["trick_cards"])
        magnitude = (raw_pts / MAX_RAW_PER_ROUND) * self.trick_shaping_coef
        for s in range(4):
            sign = 1.0 if TEAM_OF_SEAT[s] == trick_winner_team else -1.0
            self._pending_rewards[s] += sign * magnitude

    def _distribute_round_end(self, info: dict) -> None:
        scores = info["round_scores"]
        diff_raw = scores["team0"]["raw"] - scores["team1"]["raw"]
        magnitude = diff_raw / MAX_RAW_PER_ROUND
        # A Cricca round adds +9 raw to one team, so diff_raw can exceed
        # MAX_RAW_PER_ROUND (=35) and push magnitude past ±1. Clip rather than
        # divide by 35+9: renormalizing would shrink every ordinary round's
        # reward to accommodate a rare event.
        magnitude = float(np.clip(magnitude, -1.0, 1.0))
        for s in range(4):
            sign = 1.0 if TEAM_OF_SEAT[s] == 0 else -1.0
            self._pending_rewards[s] += sign * magnitude

    def _distribute_game_terminal(self, winner_team: int) -> None:
        for s in range(4):
            self._pending_rewards[s] += 1.0 if TEAM_OF_SEAT[s] == winner_team else -1.0

    def _get_obs(self) -> dict:
        seat = self.game.current_seat
        return {
            "obs": encode_observation(self.game, seat),
            "full_obs": encode_full_state(self.game, seat),
            "action_mask": encode_action_mask(self.game, seat),
            "current_seat": np.int64(seat),
        }

    def _terminal_obs(self) -> dict:
        return {
            "obs": np.zeros(OBS_SIZE, dtype=np.float32),
            "full_obs": np.zeros(FULL_STATE_SIZE, dtype=np.float32),
            "action_mask": np.zeros(160, dtype=np.float32),
            "current_seat": np.int64(-1),
        }
