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
  - Optional signal-honesty shaping: ±signal_honesty_coef to the declarer when
                it declares striscio/busso/volo. Default 0.0 (off). See below.

  Why round-end (not per-trick) by default? Per-trick reward is biased
  shaping that pushes the agent toward greedy trick-grabbing — which is
  often *wrong* in Beccaccino (e.g. dumping a low card on partner's Asso,
  letting opponents waste briscole early, etc.). Round-end shaping is
  unbiased w.r.t. correct play and dense enough for stable PPO learning
  via GAE propagation.

  Why signal-honesty shaping exists. The action space is 40 cards × 4 signal
  slots, but nothing in the score depends on which signal slot is chosen, so
  that dimension gets no gradient: a trained policy declares signals at ~chance
  and means nothing by them. Grounding the slots takes an explicit term.

  It is deliberately asymmetric — silence is NEVER penalised, only a *declared*
  signal is judged:
      honest   -> +coef
      dishonest-> -coef
      None     ->  0
  So the shaping fixes what a signal MEANS, while whether signalling is worth it
  at all stays a strategy question the round score answers. Penalising silence
  would answer that question by fiat, and the answer would probably be wrong.

  The coefficient is meant to be annealed to 0 (see trainer `--signal-*` flags):
  early on it teaches the convention, then it gets out of the way so the policy
  can learn when a signal actually helps its partner — including learning to
  stay quiet, or to lie, if the score says so.

  All rewards are delivered via deferred per-seat queues so every seat
  gets credited even though only one seat acts per env step.
"""

from __future__ import annotations

import copy

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
from becca_env.signals import signal_is_honest

MAX_RAW_PER_ROUND = 35


class BeccaEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        seed: int | None = None,
        win_points: int = 41,
        trick_shaping_coef: float = 0.0,
        signal_honesty_coef: float = 0.0,
        include_full_obs: bool = True,
        seed_stride: int = 1,
        initial_game_count: int = 0,
    ):
        super().__init__()
        if seed_stride <= 0:
            raise ValueError("seed_stride must be positive")
        if initial_game_count < 0:
            raise ValueError("initial_game_count must be non-negative")
        self._base_seed = seed
        self._seed_stride = seed_stride
        self._game_count = initial_game_count
        self._current_seed: int | None = None
        self._deal_fingerprint: tuple | None = None
        self._win_points = win_points
        self.trick_shaping_coef = float(trick_shaping_coef)
        self.signal_honesty_coef = float(signal_honesty_coef)
        self.include_full_obs = include_full_obs
        self.game: BeccaGame | None = None
        self._pending_rewards: dict[int, float] = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}

        self.action_space = spaces.Discrete(160)
        observation_spaces = {
            "obs": spaces.Box(low=0.0, high=1.0, shape=(OBS_SIZE,), dtype=np.float32),
            "action_mask": spaces.Box(low=0.0, high=1.0, shape=(160,), dtype=np.float32),
            "current_seat": spaces.Discrete(4),
        }
        if include_full_obs:
            observation_spaces["full_obs"] = spaces.Box(
                low=0.0, high=1.0, shape=(FULL_STATE_SIZE,), dtype=np.float32
            )
        self.observation_space = spaces.Dict(observation_spaces)

    def set_trick_shaping_coef(self, coef: float) -> None:
        """Adjust the trick-shaping coefficient (e.g. for annealing)."""
        self.trick_shaping_coef = float(coef)

    def set_signal_honesty_coef(self, coef: float) -> None:
        """Adjust the signal-honesty coefficient (annealed toward 0 by the trainer)."""
        self.signal_honesty_coef = float(coef)

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            effective_seed = seed
        elif self._base_seed is not None:
            effective_seed = self._base_seed + self._game_count * self._seed_stride
        else:
            effective_seed = None
        self._game_count += 1
        self._current_seed = effective_seed
        self.game = BeccaGame(seed=effective_seed, win_points=self._win_points)
        self._deal_fingerprint = tuple(
            tuple(self.game.round.player_hands[seat]) for seat in range(4)
        )
        self._pending_rewards = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
        return self._get_obs(), {"current_seat": self.game.current_seat}

    def step(self, action: int):
        if self.game is None or self.game.phase == GamePhase.GAME_OVER:
            raise ValueError("Game is over or not started. Call reset().")

        seat = self.game.current_seat
        team = TEAM_OF_SEAT[seat]

        prior_reward = self._pending_rewards[seat]
        self._pending_rewards[seat] = 0.0

        game_action = decode_action(action, self.game)
        info = self.game.step(game_action)
        event = info.get("event")

        terminated = self.game.phase == GamePhase.GAME_OVER

        # Optional signal-honesty shaping (off by default). A non-None signal
        # implies the acting seat led the trick — `game.step` forces signal=None
        # for followers — and a lead can never complete a trick, so the hand read
        # here is post-play and pre-redeal.
        if self.signal_honesty_coef != 0.0 and info.get("signal") is not None:
            self._apply_signal_honesty(seat, info)

        # Optional per-trick shaping (off by default).
        # Note: round_end / game_over events also include the final trick's
        # data (trick_winner, trick_cards), so we apply shaping there too.
        if self.trick_shaping_coef != 0.0 and event in ("trick_complete", "round_end", "game_over"):
            self._distribute_trick_shaping(info)

        # Round-end shaping: dense, unbiased, fires every ~40 env steps.
        if event in ("round_end", "game_over"):
            self._distribute_round_end(info)

        # Game terminal: ±1.0 for the team that won.
        if event == "game_over":
            self._distribute_game_terminal(info["game_winner"])

        # Rewards generated by this action belong to this action's transition.
        # Rewards accumulated since this seat last acted belong to its previous
        # transition and are surfaced separately for collector retro-credit.
        action_reward = self._pending_rewards[seat]
        self._pending_rewards[seat] = 0.0

        obs = self._get_obs() if not terminated else self._terminal_obs()
        info["prior_reward"] = prior_reward
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

        return obs, action_reward, terminated, False, info

    def export_state(self) -> dict:
        """Snapshot the exact live game and seed stream for checkpoint resume."""
        if self.game is None:
            raise ValueError("environment has not been reset")
        return {
            "version": 1,
            "base_seed": self._base_seed,
            "seed_stride": self._seed_stride,
            "game_count": self._game_count,
            "current_seed": self._current_seed,
            "deal_fingerprint": self._deal_fingerprint,
            "win_points": self._win_points,
            "game": copy.deepcopy(self.game),
            "pending_rewards": dict(self._pending_rewards),
        }

    def restore_state(self) -> None:
        """Restore a state assigned through VectorEnv.set_attr."""
        state = self._restore_state
        if state["base_seed"] != self._base_seed or state["seed_stride"] != self._seed_stride:
            raise ValueError("checkpoint seed stream does not match environment")
        if state["win_points"] != self._win_points:
            raise ValueError("checkpoint win_points does not match environment")
        self._game_count = int(state["game_count"])
        self._current_seed = state["current_seed"]
        self._deal_fingerprint = state["deal_fingerprint"]
        self.game = copy.deepcopy(state["game"])
        self._pending_rewards = dict(state["pending_rewards"])

    def current_observation(self) -> dict:
        """Observation for a restored live state without resetting its deal."""
        if self.game is None or self.game.phase == GamePhase.GAME_OVER:
            raise ValueError("environment has no live game")
        return self._get_obs()

    # ---------------- reward distribution helpers ----------------

    def _apply_signal_honesty(self, seat: int, info: dict) -> None:
        """Credit/debit the DECLARER for whether its signal told the truth.

        Only the declarer, and only when it chose to signal: staying silent earns
        nothing and costs nothing, so the policy still decides *whether* to signal
        from the round score (module docstring). The partner is not credited —
        acting on a signal is their own decision, judged by the score.
        """
        honest = signal_is_honest(info["signal"], self.game.get_hand(seat), info["card"].suit)
        self._pending_rewards[seat] += (
            self.signal_honesty_coef if honest else -self.signal_honesty_coef
        )

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
        obs = encode_observation(self.game, seat)
        result = {
            "obs": obs,
            "action_mask": encode_action_mask(self.game, seat),
            "current_seat": np.int64(seat),
        }
        if self.include_full_obs:
            result["full_obs"] = encode_full_state(self.game, seat, obs)
        return result

    def _terminal_obs(self) -> dict:
        result = {
            "obs": np.zeros(OBS_SIZE, dtype=np.float32),
            "action_mask": np.zeros(160, dtype=np.float32),
            "current_seat": np.int64(-1),
        }
        if self.include_full_obs:
            result["full_obs"] = np.zeros(FULL_STATE_SIZE, dtype=np.float32)
        return result
