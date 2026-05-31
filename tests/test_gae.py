"""Tests for per-seat GAE computation."""

import numpy as np
import pytest

from becca_env.observation import OBS_SIZE
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
            obs=np.zeros(OBS_SIZE, dtype=np.float32),
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
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 0.5, False, 0)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 0.3, False, 1)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 5.0, True, 0)  # terminal
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 0.2, False, 1)

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
        buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, value, reward, False, seat)

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


def test_per_env_isolation_no_cross_env_leakage():
    """Two envs interleaved in the buffer must NOT share GAE chains.

    Regression test for the bug where seat-tracking dicts were keyed only by
    seat, causing env0's seat-0 step to bootstrap from env1's seat-0 value.
    """
    buf = RolloutBuffer(4)
    gamma, lam = 0.99, 0.95

    # Interleaved storage like collect_rollout_vec produces:
    #   [env0_t0, env1_t0, env0_t1, env1_t1]
    # Both envs have seat 0 acting at both timesteps.
    # env_idx is passed alongside seat so the buffer can isolate chains.
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, value=10.0, reward=1.0,
              done=False, seat=0, env_idx=0)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, value=99.0, reward=2.0,
              done=False, seat=0, env_idx=1)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, value=11.0, reward=1.5,
              done=False, seat=0, env_idx=0)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, value=98.0, reward=2.5,
              done=False, seat=0, env_idx=1)

    advs, _ = buf.compute_gae(gamma, lam)

    # env0 is its own chain (steps 0 and 2):
    #   step 2 last for env0 seat 0: delta = 1.5 + 0 - 11.0 = -9.5
    #   step 0: next_val=11.0, delta = 1.0 + 0.99*11.0 - 10.0 = 1.89
    #           adv = 1.89 + 0.99*0.95*(-9.5) = 1.89 - 8.93475 = -7.04475
    expected_step0 = 1.0 + gamma * 11.0 - 10.0 + gamma * lam * (1.5 - 11.0)

    # env1 chain (steps 1 and 3):
    #   step 3 last for env1: delta = 2.5 + 0 - 98.0 = -95.5
    #   step 1: next_val=98.0, delta = 2.0 + 0.99*98.0 - 99.0 = -0.98
    #           adv = -0.98 + 0.99*0.95*(-95.5)
    expected_step1 = 2.0 + gamma * 98.0 - 99.0 + gamma * lam * (2.5 - 98.0)

    assert advs[0] == pytest.approx(expected_step0, abs=1e-4), \
        f"env0 step0 leaked from env1: got {advs[0]}, expected {expected_step0}"
    assert advs[1] == pytest.approx(expected_step1, abs=1e-4), \
        f"env1 step0 leaked from env0: got {advs[1]}, expected {expected_step1}"


def test_done_only_resets_owning_env():
    """A done=True in env0 must not reset env1's GAE chain."""
    buf = RolloutBuffer(4)
    gamma, lam = 0.99, 0.95

    # env0 step 0 (seat 0), env1 step 0 (seat 0),
    # env0 step 1 (seat 0, done=True), env1 step 1 (seat 0, NOT done)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 0.5, False, 0, env_idx=0)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 5.0, 0.4, False, 0, env_idx=1)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 1.0, 3.0, True, 0, env_idx=0)
    buf.store(np.zeros(OBS_SIZE), np.ones(160), 0, 0.0, 5.0, 0.6, False, 0, env_idx=1)

    advs, _ = buf.compute_gae(gamma, lam)

    # env1 step 1 is the last seat-0 entry for env1, no done → next_val=0
    #   delta = 0.6 + 0 - 5.0 = -4.4
    assert advs[3] == pytest.approx(-4.4, abs=1e-5)

    # env1 step 0 should chain to env1 step 1 (NOT be reset by env0's done):
    #   delta = 0.4 + 0.99 * 5.0 - 5.0 = 0.35... wait: 0.4 + 4.95 - 5.0 = 0.35
    #   adv = 0.35 + 0.99 * 0.95 * (-4.4) = 0.35 - 4.1382 = -3.7882
    expected_step1 = 0.4 + gamma * 5.0 - 5.0 + gamma * lam * (-4.4)
    assert advs[1] == pytest.approx(expected_step1, abs=1e-5), \
        f"env0's done=True leaked into env1's chain: got {advs[1]}"


def test_returns_equal_advantages_plus_values():
    """returns = advantages + values (by definition)."""
    buf = RolloutBuffer(10)
    for i in range(10):
        buf.store(
            np.zeros(OBS_SIZE), np.ones(160), 0, 0.0,
            value=float(i) * 0.5, reward=float(i) * 0.1,
            done=(i == 9), seat=i % 4,
        )

    advs, rets = buf.compute_gae(0.99, 0.95)
    np.testing.assert_allclose(rets, advs + buf.values[:10], atol=1e-5)
