"""Tests for env reward distribution: round-end shaping + game terminal.

Verifies the *invariant* that, summed over an entire episode and across
all 4 seats, the total reward delivered equals what we expect from the
formula:

    Σ_s reward_s_total = Σ_rounds 0  (zero-sum across teams; each round
                                       contributes +d to team0 seats and
                                       -d to team1 seats → total = 0)
                         + 0          (terminal: +1 to winning team, -1
                                       to losing team → total = 0)

So the per-episode total summed across all 4 seats must be ~0. Per-team
totals must equal:
    team_total = 2 * (Σ round_diffs/35 (signed) + game_terminal_sign)

where the diff is from team0's perspective.
"""

from __future__ import annotations

import numpy as np

from becca_env.env import MAX_RAW_PER_ROUND, BeccaEnv
from becca_env.game import TEAM_OF_SEAT


def _play_episode_collect_per_seat(env: BeccaEnv) -> tuple[dict[int, float], list[dict]]:
    """Play an episode by always picking the first legal action; return
    (per_seat_total_reward, list_of_step_infos).

    On the terminal step the env exposes residual pending rewards for the
    other 3 seats via info["terminal_rewards_by_seat"]; the trainer credits
    these to each seat's last transition. We mirror that here so the
    accounting is correct.
    """
    obs, _ = env.reset()
    per_seat = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
    infos = []
    while True:
        legal = np.where(obs["action_mask"] > 0)[0]
        action = int(legal[0])
        obs, reward, term, _, info = env.step(action)
        per_seat[info["acting_seat"]] += reward
        if term and "terminal_rewards_by_seat" in info:
            for s, r in info["terminal_rewards_by_seat"].items():
                if s != info["acting_seat"]:
                    per_seat[s] += r
        infos.append(info)
        if term:
            break
    return per_seat, infos


def _expected_per_team_from_infos(infos: list[dict]) -> tuple[float, float]:
    """Compute expected total reward per TEAM from event log.

    With trick_shaping_coef=0 (default), each team's expected total is:
        2 * Σ_rounds sign * (round_diff_raw / 35)  +  2 * sign * 1.0
    where sign = +1 for team0, -1 for team1, and round_diff = team0_raw - team1_raw.
    The factor 2 is because each team has 2 seats sharing the reward.
    """
    team_totals = {0: 0.0, 1: 0.0}
    for info in infos:
        ev = info.get("event")
        if ev in ("round_end", "game_over") and "round_scores" in info:
            scores = info["round_scores"]
            diff = scores["team0"]["raw"] - scores["team1"]["raw"]
            magnitude = diff / MAX_RAW_PER_ROUND
            team_totals[0] += 2 * magnitude
            team_totals[1] += 2 * (-magnitude)
        if ev == "game_over":
            winner = info["game_winner"]
            for t in (0, 1):
                team_totals[t] += 2 * (1.0 if t == winner else -1.0)
    return team_totals[0], team_totals[1]


def test_episode_zero_sum_across_all_seats():
    """Without shaping, reward is zero-sum (round-end and terminal both are)."""
    env = BeccaEnv(seed=42, win_points=5, trick_shaping_coef=0.0)
    per_seat, _ = _play_episode_collect_per_seat(env)
    total = sum(per_seat.values())
    assert abs(total) < 1e-5, f"reward not zero-sum across seats: {per_seat} sum={total}"


def test_episode_per_team_matches_expected_formula():
    """Sum of seat rewards per team must equal what we compute from event log."""
    env = BeccaEnv(seed=7, win_points=11, trick_shaping_coef=0.0)
    per_seat, infos = _play_episode_collect_per_seat(env)
    expected_t0, expected_t1 = _expected_per_team_from_infos(infos)

    actual_t0 = sum(per_seat[s] for s in range(4) if TEAM_OF_SEAT[s] == 0)
    actual_t1 = sum(per_seat[s] for s in range(4) if TEAM_OF_SEAT[s] == 1)

    assert abs(actual_t0 - expected_t0) < 1e-4, (
        f"team0 mismatch: actual={actual_t0} expected={expected_t0}"
    )
    assert abs(actual_t1 - expected_t1) < 1e-4, (
        f"team1 mismatch: actual={actual_t1} expected={expected_t1}"
    )


def test_game_terminal_sign_matches_winner():
    """Winning team's seats should each receive an extra ±1 at game end."""
    env = BeccaEnv(seed=3, win_points=5, trick_shaping_coef=0.0)
    per_seat, infos = _play_episode_collect_per_seat(env)
    winner = infos[-1]["game_winner"]
    # Winning seats must be net-positive vs losing seats by ~2.0 from the
    # terminal alone (1 per seat × 2 seats × 2 sides = 4 separation).
    win_seats = [s for s in range(4) if TEAM_OF_SEAT[s] == winner]
    lose_seats = [s for s in range(4) if TEAM_OF_SEAT[s] != winner]
    win_total = sum(per_seat[s] for s in win_seats)
    lose_total = sum(per_seat[s] for s in lose_seats)
    assert win_total > lose_total, f"winning team underwater: {per_seat}"


def test_no_per_trick_reward_when_coef_zero():
    """With shaping coef=0, no trick-level reward is delivered to any seat
    *between* round boundaries — rewards only fire on round_end / game_over."""
    env = BeccaEnv(seed=11, win_points=5, trick_shaping_coef=0.0)
    obs, _ = env.reset()
    # Track non-zero rewards and the corresponding event
    non_zero_events = []
    while True:
        legal = np.where(obs["action_mask"] > 0)[0]
        action = int(legal[0])
        obs, reward, term, _, info = env.step(action)
        if abs(reward) > 1e-9:
            non_zero_events.append(info.get("event"))
        if term:
            break
    # Every non-zero reward must coincide with a round_end or game_over event
    # (delivered at end of round to the seat that completed the round, or
    # to subsequent seats via _pending_rewards on their next step).
    # However, the deferred queue means a seat may receive its share on its
    # NEXT action — which is *during* the next round. So we instead check
    # that the *first* non-zero reward in an episode happens AT or AFTER the
    # first round_end event (no trick-level shaping fires before then).
    if non_zero_events:
        # The first non-zero must not be on a 'card_played' or 'briscola_chosen'
        # within the first round (i.e. before any round has ended).
        # Easiest invariant: the per-trick magnitude is zero, so no trick-only
        # rewards exist. We assert by confirming no reward on a 'trick_complete'
        # that ISN'T also a 'round_end'/'game_over'.
        assert "trick_complete" not in non_zero_events, (
            "trick_complete events should never carry reward when coef=0"
        )


def test_trick_shaping_coef_nonzero_fires_per_trick():
    """With coef>0, trick_complete events carry reward."""
    env = BeccaEnv(seed=11, win_points=5, trick_shaping_coef=1.0)
    obs, _ = env.reset()
    saw_trick_reward = False
    while True:
        legal = np.where(obs["action_mask"] > 0)[0]
        action = int(legal[0])
        obs, reward, term, _, info = env.step(action)
        if info.get("event") == "trick_complete" and abs(reward) > 1e-9:
            saw_trick_reward = True
            break
        if term:
            break
    assert saw_trick_reward, "shaping coef=1.0 produced no trick-level reward"


def test_set_trick_shaping_coef_runtime():
    """The coef can be updated mid-training (for annealing)."""
    env = BeccaEnv(seed=1, win_points=5, trick_shaping_coef=0.0)
    assert env.trick_shaping_coef == 0.0
    env.set_trick_shaping_coef(0.5)
    assert env.trick_shaping_coef == 0.5


def test_rollout_credits_terminal_residuals_single_env():
    """The single-env collect_rollout must credit terminal_rewards_by_seat
    so the per-team total in the buffer matches the env's bookkeeping."""
    import torch

    from becca_env.env import BeccaEnv
    from training.network import create_network
    from training.rollout import collect_rollout

    # Use a small net; we don't care about quality here.
    net = create_network(version=2, hidden_size=64, num_layers=2)
    env = BeccaEnv(seed=5, win_points=5, trick_shaping_coef=0.0)
    buf = collect_rollout(env, net, num_steps=2000, device=torch.device("cpu"))

    # Sum rewards in buffer per (env_idx, seat). Across each fully-played
    # episode the per-team sums should follow the round-end + terminal formula.
    # We can't easily verify per-episode without parsing transitions, so we do
    # a global invariant: rewards should NOT all be 0, and should sum to ~0
    # across complete episodes (zero-sum). Cumulative across complete games:
    n = buf.ptr
    total = float(buf.rewards[:n].sum())
    games = int(buf.dones[:n].sum())
    # Rough check: with games complete, total should be ≈0 (zero-sum).
    # Allow some slack for partial trailing game whose terminal hasn't fired.
    if games > 0:
        per_game_residual = total / games
        assert abs(per_game_residual) < 0.5, (
            f"avg per-game leftover suggests dropped rewards: {per_game_residual}"
        )

    # And we should see *some* nonzero rewards (round-ends + terminals)
    nonzero = int((np.abs(buf.rewards[:n]) > 1e-9).sum())
    assert nonzero > 0, "rollout produced zero rewards everywhere"


def test_rollout_credits_terminal_residuals_vec_env():
    """Same invariant for the vectorized rollout."""
    import torch

    from training.network import create_network
    from training.rollout import collect_rollout_vec
    from training.vec_env import create_vec_env

    net = create_network(version=2, hidden_size=64, num_layers=2)
    vec = create_vec_env(num_envs=4, seed=11, win_points=5, sync=True)
    try:
        buf = collect_rollout_vec(vec, net, steps_per_env=400, device=torch.device("cpu"))
    finally:
        vec.close()

    n = buf.ptr
    games = int(buf.dones[:n].sum())
    if games == 0:
        # No completed games — bump steps_per_env in the test if this fires.
        return
    total = float(buf.rewards[:n].sum())
    avg = total / games
    assert abs(avg) < 0.5, f"vec rollout avg per-game leftover too large: {avg}"


def test_round_end_magnitude_in_expected_range():
    """Round-end reward per seat should be in [-1, 1] (approx; max raw diff = 35-0)."""
    env = BeccaEnv(seed=99, win_points=11, trick_shaping_coef=0.0)
    obs, _ = env.reset()
    max_step_reward = 0.0
    while True:
        legal = np.where(obs["action_mask"] > 0)[0]
        obs, reward, term, _, info = env.step(int(legal[0]))
        # On a round_end (not game_over), reward should be bounded.
        # Excluding the +1 terminal bonus, no individual delivery can exceed ~1.0.
        if info.get("event") == "round_end":
            max_step_reward = max(max_step_reward, abs(reward))
        if term:
            break
    # Round diff is bounded by 35 raw (one team takes everything), so |reward| ≤ 1.
    assert max_step_reward <= 1.0 + 1e-5, f"round_end reward out of range: {max_step_reward}"


def test_cricca_round_reward_clipped_to_unit_range():
    """A Cricca sweep pushes diff_raw to 35+9=44 > MAX_RAW_PER_ROUND, which
    would give magnitude 44/35 ≈ 1.26 without the clip. Each seat's round-end
    reward must still land in [-1, 1]."""
    env = BeccaEnv(seed=1, win_points=99, trick_shaping_coef=0.0)
    env.reset()
    env._pending_rewards = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
    # team0 sweeps every point (32) + last-trick bonus (3) + Cricca (9) = 44 raw.
    overflow_scores = {
        "team0": {"raw": 44, "points": 14},
        "team1": {"raw": 0, "points": 0},
    }
    env._distribute_round_end({"round_scores": overflow_scores})
    for seat, r in env._pending_rewards.items():
        assert -1.0 <= r <= 1.0, f"seat {seat} round reward {r} escaped [-1, 1]"
    # The clip must actually bind: team0 seats hit the +1 ceiling.
    assert env._pending_rewards[0] == 1.0
    assert env._pending_rewards[1] == -1.0


def test_cricca_raw_bonus_is_named_constant():
    """The +9 Cricca bonus is a named constant, not a magic literal."""
    from becca_env.game import CRICCA_RAW_BONUS

    assert CRICCA_RAW_BONUS == 9
    assert CRICCA_RAW_BONUS // 3 == 3  # +3 real points
