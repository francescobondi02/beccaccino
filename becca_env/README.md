# becca_env

## Overview

Headless, pure-Python Beccaccino game engine and Gymnasium self-play
environment. It owns the deck, trick and scoring rules, the round/game state
machine, the signalling convention, and the observation/action encodings
consumed by training, evaluation, search, and serving. All other `ai/`
packages build on it.

## Interface

- `__init__.py` re-exports `Suit`, `Value`, `Card`, `DECK`, `card_points`,
  `card_strength`, `follow_suit_filter`, `detect_cricca`,
  `determine_hand_winner`, `compute_round_scores`, `BeccaGame`, `GamePhase`,
  `Signal`, `TrickRecord` (`[__init__.py:__all__]`).
- `deck.py`: `Suit` and `Value` enums, `Card` named tuple, the 40-card `DECK`,
  `card_strength` (trick order) and `card_points` (raw points ×3)
  (`[deck.py:DECK]`, `[deck.py:card_strength]`, `[deck.py:card_points]`).
- `rules.py`: `detect_cricca`, `follow_suit_filter`, `determine_hand_winner`,
  `compute_round_scores` returning `{"team0"|"team1": {"raw", "points",
  "figures"}}` (`[rules.py:compute_round_scores]`).
- `game.py`: `BeccaGame` (`current_seat`, `legal_actions`, `step`, `get_hand`,
  `get_observation`, public fields `total_scores`, `rounds_won`, `phase`,
  `result`), `GamePhase`, `Signal`, `TrickRecord`, `RoundState`,
  `GameResult`, constants `TEAM_OF_SEAT`, `WIN_POINTS = 41`,
  `CRICCA_RAW_BONUS = 9` (`[game.py:BeccaGame]`).
  `GamePhase.ROUND_END` exists but is never entered: `_end_round` goes
  straight to the next round's `CHOOSE_BRISCOLA` or to `GAME_OVER`
  (`[game.py:BeccaGame._end_round]`). The `step` branch that mentions
  `advance_round()` is unreachable; no such method exists.
- `signals.py`: `signal_is_honest`, `honest_signal_for`,
  `BUSSO_STRENGTH_FLOOR`, `STRISCIO_MIN_REMAINING`
  (`[signals.py:signal_is_honest]`).
- `env.py`: `BeccaEnv(gym.Env)` with `reset`, `step`,
  `set_trick_shaping_coef`, `set_signal_honesty_coef`, `export_state`,
  `restore_state`, `current_observation`; constant `MAX_RAW_PER_ROUND = 35`
  (`[env.py:BeccaEnv]`).
  - Constructor: `BeccaEnv(seed=None, win_points=41, trick_shaping_coef=0.0,
    signal_honesty_coef=0.0, include_full_obs=True, seed_stride=1,
    initial_game_count=0)` (`[env.py:BeccaEnv.__init__]`).
  - Observation space is a `Dict` with `obs` (`OBS_SIZE` floats),
    `action_mask` (160 floats), `current_seat` (`Discrete(4)`), plus
    `full_obs` (`FULL_STATE_SIZE` floats) when `include_full_obs` is true.
    The terminal observation is all zeros with `current_seat = -1`
    (`[env.py:BeccaEnv._terminal_obs]`).
  - `step` returns `info` from `BeccaGame.step` plus `prior_reward`,
    `acting_seat`, `acting_team` and `current_seat` (`-1` when terminated);
    on the terminal step it also adds `terminal_rewards_by_seat`
    (`[env.py:BeccaEnv.step]`).
  - `restore_state()` takes no arguments. Callers first assign the snapshot
    from `export_state()` to the `_restore_state` attribute through
    `VectorEnv.set_attr`, then call it (`[env.py:BeccaEnv.restore_state]`).
- `observation.py`: `encode_observation`, `encode_full_state`,
  `encode_action_mask`, `decode_action`, `CARD_INDEX`, `SUIT_INDEX`,
  `SIGNAL_INDEX`, `OBS_SIZE = 518`, `LEGACY_OBS_SIZE = 462`,
  `A2_OBS_SIZE = 470`, `FULL_STATE_SIZE = 638`
  (`[observation.py:encode_observation]`). Layout constants:
  `NUM_CARDS = 40`, `NUM_SUITS = 4`, `NUM_SIGNALS = 3`,
  `CARD_STATUS_CLASSES = 5` with `STATUS_UNSEEN`, `STATUS_MINE`,
  `STATUS_PARTNER`, `STATUS_LEFT_OPP`, `STATUS_RIGHT_OPP` (0..4), and the
  signal history `RECENT_SIGNAL_COUNT = 4` records of
  `SIGNAL_HISTORY_RECORD_SIZE = 12` (`SIGNAL_HISTORY_SIZE = 48`)
  (`[observation.py:OBS_SIZE]`).
- `kaggle_observation.py`: frozen 1888-feature `encode_observation` and its
  `OBS_SIZE` for the October 2026 Kaggle policy
  (`[kaggle_observation.py:OBS_SIZE]`).

## Invariants

- Seats `{0, 2}` are team 0 and `{1, 3}` are team 1 (`[game.py:TEAM_OF_SEAT]`).
- Round 1 caller is the holder of quattro di denara; later callers rotate
  `+1` seat (`[game.py:BeccaGame._start_new_round]`).
- Followers must follow the lead suit when able
  (`[rules.py:follow_suit_filter]`). `BeccaGame.step` raises `ValueError` on
  an illegal card, a card not in hand, a non-tuple action from the trick
  leader (`[game.py:BeccaGame._play_card]`), a briscola action that is not a
  `Suit` (`[game.py:BeccaGame._choose_briscola]`), or any action after the
  game is over (`[game.py:BeccaGame.step]`). `BeccaEnv.step` raises
  `ValueError` before `reset` or after game over (`[env.py:BeccaEnv.step]`).
- Only the trick leader may attach a `Signal`; followers always record `None`
  (`[game.py:BeccaGame._play_card]`). Signals are never enforced as honest:
  bluffing stays legal (`[signals.py]` module docstring). That docstring also
  names an offline audit, `evaluation/signal_audit.py`, which does not exist;
  the current users are `env.py` shaping, `evaluation/heuristic.py`,
  `inference/pimc.py` and `scripts/watch_bots.py`.
- Trick winner is the highest briscola if any was played, otherwise the
  highest card of the lead suit (`[rules.py:determine_hand_winner]`).
- Scores are raw ×3 units: last trick adds `+3` raw
  (`[rules.py:compute_round_scores]`), Cricca adds `+9` raw to the caller's
  team (`[game.py:CRICCA_RAW_BONUS]`). Real points are `raw // 3`, figures
  `raw % 3`.
- `BeccaGame.total_scores` holds cumulative raw points; `GameResult.total_scores`
  holds real points (`raw // 3`) (`[game.py:BeccaGame._end_round]`).
- The round winner (counted in `rounds_won`) has more real points, then more
  figures; an exact tie goes to team 0 (`[game.py:BeccaGame._end_round]`).
- The game ends when a team reaches `win_points` real points; if both cross,
  the higher total wins and an exact tie goes to the caller's team
  (`[game.py:BeccaGame._end_round]`).
- Action space is `Discrete(160)`: index `card_idx * 4 + signal_idx`;
  briscola choice uses slots `0..3`; followers only use `signal_idx = 0`
  (`[observation.py:encode_action_mask]`, `[observation.py:decode_action]`).
- The first 462 and 470 observation entries are a frozen prefix so older
  checkpoints can consume `LEGACY_OBS_SIZE` / `A2_OBS_SIZE` slices.
  `encode_observation(obs_size=1888)` (the Kaggle `OBS_SIZE`) dispatches to
  `kaggle_observation.encode_observation`; sizes other than 462, 470, 518 and
  1888 raise `ValueError` (`[observation.py:encode_observation]`).
- The Kaggle 1888-feature layout must stay separate from the 518-feature
  layout (`[kaggle_observation.py]` module docstring).
- Rewards (`[env.py:BeccaEnv.step]`):
  - Round end: every seat gets `±(team0_raw − team1_raw) / 35`, signed by its
    team and clipped to `[-1, 1]` (`[env.py:BeccaEnv._distribute_round_end]`).
  - Game end: every seat, not only the acting one, gets `+1.0` if its team won
    and `-1.0` otherwise (`[env.py:BeccaEnv._distribute_game_terminal]`). The
    module docstring's "acting seat only" is outdated.
  - Optional trick shaping (default off): every seat gets
    `±(trick_raw / 35) · trick_shaping_coef`, signed by the trick winner's team
    (`[env.py:BeccaEnv._distribute_trick_shaping]`).
  - Optional signal-honesty shaping (default off): the declarer gets
    `±signal_honesty_coef`; silence is never penalised
    (`[env.py:BeccaEnv._apply_signal_honesty]`).
- `step`'s `reward` belongs to the current action. Rewards accrued to the
  acting seat since its previous action are returned as `info["prior_reward"]`
  for retro-credit to that seat's previous transition. On the terminal step the
  other seats' pending rewards are returned in
  `info["terminal_rewards_by_seat"]` and cleared (`[env.py:BeccaEnv.step]`).
- `seed_stride` must be positive and `initial_game_count` non-negative
  (`[env.py:BeccaEnv.__init__]`); `restore_state` rejects mismatched seed
  streams or `win_points` (`[env.py:BeccaEnv.restore_state]`).

## Side Effects

- None outside process memory: no disk, network, or global state. `BeccaGame`
  owns a private `random.Random(seed)` (`[game.py:BeccaGame.__init__]`).
- `deck.py` asserts `len(DECK) == 40` at import time (`[deck.py:DECK]`).

## Verification

- Run: `cd ai && pytest tests/test_deck.py tests/test_rules.py tests/test_game.py tests/test_signals.py tests/test_env.py tests/test_rewards.py tests/test_observation.py tests/test_kaggle_policy.py`
- Full suite: `cd ai && pytest`
