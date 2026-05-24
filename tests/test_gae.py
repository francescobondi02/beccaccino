"""Tests for per-seat GAE computation."""

import numpy as np
import pytest

from training.rollout import RolloutBuffer


def test_single_seat_gae_matches_standard():
    """When only one seat acts, per-seat GAE should match standard GAE."""
    buf = RolloutBuffer(5)
    gamma, lam = 0.99, 0.95

    # Simulate a simple trajectory: seat 0 takes all actions, no terminal
    rewards = [1.0, 0.5, 0.2, 0.8, 0.3]
    values = [2.0, 1.5, 1.0, 0.5, 0.2]
    for i in range(5):
        buf.store(
            obs=np.zeros(344, dtype=np.float32),
            mask=np.ones(160, dtype=np.float32),
            action=0, log_prob=0.0, value=values[i],
            reward=rewards[i], done=False, seat=0,
        )

    advs, rets = buf.compute_gae(gamma, lam)

    # Manual standard GAE
    expected_advs = np.zeros(5, dtype=np.float32)
    last_adv = 0.0
    for t in reversed(range(5)):
        if t == 4:
            next_val = 0.0
        else:
            next_val = values[t + 1]
        delta = rewards[t] + gamma * next_val - values[t]
        last_adv = delta + gamma * lam * last_adv
        expected_advs[t] = last_adv

    np.testing.assert_allclose(advs, expected_advs, atol=1e-5)


def test_game_boundary_resets_all_seats():
    """Done=True should reset advantages for ALL seats."""
    buf = RolloutBuffer(4)
    gamma, lam = 0.99, 0.95

    # seat 0, seat 1, seat 0 (done=True), seat 1
    buf.store(np.zeros(344), np.ones(160), 0, 0.0, 1.0, 0.5, False, 0)
    buf.store(np.zeros(344), np.ones(160), 0, 0.0, 1.0, 0.3, False, 1)
    buf.store(np.zeros(344), np.ones(160), 0, 0.0, 1.0, 5.0, True, 0)  # terminal
    buf.store(np.zeros(344), np.ones(160), 0, 0.0, 1.0, 0.2, False, 1)

    advs, _ = buf.compute_gae(gamma, lam)

    # Step 3 (seat 1, after game boundary): no future chaining
    # delta = 0.2 + 0.99 * 0.0 - 1.0 = -0.8 (last_done for seat 1 = True after done at step 2)
    assert advs[3] == pytest.approx(0.2 + gamma * 0.0 - 1.0, abs=1e-5)

    # Step 2 (terminal): delta = 5.0 + 0 - 1.0 = 4.0, no future
    assert advs[2] == pytest.approx(5.0 - 1.0, abs=1e-5)


def test_multi_seat_interleaving():
    """Seats should chain their own advantages independently."""
    buf = RolloutBuffer(6)
    gamma, lam = 0.99, 0.95

    # Interleaved: 0, 1, 0, 1, 0, 1
    data = [
        (0, 1.0, 2.0), (1, 0.5, 1.5),
        (0, 0.8, 1.8), (1, 0.3, 1.2),
        (0, 0.6, 1.5), (1, 0.2, 1.0),
    ]
    for seat, reward, value in data:
        buf.store(np.zeros(344), np.ones(160), 0, 0.0, value, reward, False, seat)

    advs, _ = buf.compute_gae(gamma, lam)

    # Seat 0 trajectory: steps 0, 2, 4
    # Step 4: last for seat 0, next_val=0, delta = 0.6 - 1.5 = -0.9
    assert advs[4] == pytest.approx(0.6 - 1.5, abs=1e-5)

    # Step 2: next seat 0 step is 4, next_val=1.5
    # delta = 0.8 + 0.99 * 1.5 - 1.8 = 0.485
    # adv = 0.485 + 0.99 * 0.95 * (-0.9) = 0.485 - 0.84645 = -0.36145
    expected_delta_2 = 0.8 + gamma * 1.5 - 1.8
    expected_adv_2 = expected_delta_2 + gamma * lam * advs[4]
    assert advs[2] == pytest.approx(expected_adv_2, abs=1e-5)


def test_returns_equal_advantages_plus_values():
    """returns = advantages + values (by definition)."""
    buf = RolloutBuffer(10)
    for i in range(10):
        buf.store(
            np.zeros(344), np.ones(160), 0, 0.0,
            value=float(i) * 0.5, reward=float(i) * 0.1,
            done=(i == 9), seat=i % 4,
        )

    advs, rets = buf.compute_gae(0.99, 0.95)
    np.testing.assert_allclose(rets, advs + buf.values[:10], atol=1e-5)
