"""Tests for RunningMeanStd and ReturnNormalizer.

The return normalizer is critical for stable PPO with variable game length.
Bugs here are subtle and corrupt training silently — the tests pin both the
math (Welford correctness) and the per-(env, seat) state isolation.
"""

from __future__ import annotations

import numpy as np

from training.normalization import ReturnNormalizer, RunningMeanStd


def test_welford_matches_numpy_for_single_batch():
    rms = RunningMeanStd()
    xs = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    rms.update(xs)
    # The first update has count = 1e-4 + 5 ≈ 5; tiny prior tilts mean very
    # slightly toward 0. Allow loose tolerance.
    assert abs(rms.mean - xs.mean()) < 1e-3
    assert abs(rms.var - xs.var()) < 1e-3


def test_welford_streaming_matches_one_shot():
    """Updating in 3 batches must match updating once with the union."""
    rms_streamed = RunningMeanStd()
    a = np.array([1.0, 2.0])
    b = np.array([3.0, 4.0])
    c = np.array([5.0, 6.0, 7.0])
    rms_streamed.update(a)
    rms_streamed.update(b)
    rms_streamed.update(c)

    all_xs = np.concatenate([a, b, c])
    # The 1e-4 prior count introduces tiny bias for small N; rises above
    # this tolerance only with very small samples. With 7 samples expect
    # ~1e-4 abs error in variance.
    assert abs(rms_streamed.mean - all_xs.mean()) < 1e-3
    assert abs(rms_streamed.var - all_xs.var()) < 1e-3


def test_rms_handles_empty_update():
    rms = RunningMeanStd()
    rms.update(np.array([]))
    assert rms.count == 1e-4  # unchanged


def test_return_normalizer_resets_on_done():
    """A done=True must reset every seat's chain for the completed environment."""
    rn = ReturnNormalizer(gamma=0.5)
    rn.normalize(0, 0, 1.0, done=False)
    rn.normalize(0, 1, 2.0, done=False)
    rn.normalize(1, 0, 3.0, done=False)
    rn.normalize(0, 0, 1.0, done=True)

    assert (0, 0) not in rn._returns
    assert (0, 1) not in rn._returns
    assert rn._returns[(1, 0)] == 3.0

    rn.normalize(0, 0, 10.0, done=False)
    assert rn._returns[(0, 0)] == 10.0


def test_rollout_batch_continues_transient_return_chains():
    from becca_env.observation import OBS_SIZE
    from training.rollout import RolloutBuffer

    rn = ReturnNormalizer(gamma=0.5)
    rn.normalize(0, 0, 100.0, done=False)
    buf = RolloutBuffer(size=2)
    for _ in range(2):
        buf.store(
            np.zeros(OBS_SIZE, dtype=np.float32),
            np.ones(160, dtype=np.float32),
            action=0,
            log_prob=0.0,
            value=0.0,
            reward=2.0,
            done=False,
            seat=0,
            env_idx=0,
        )

    buf.get_batch(return_normalizer=rn)

    # Only the first transition is trainable; the second is a carry tail and is
    # deliberately deferred to the next PPO window.
    assert rn._returns[(0, 0)] == 52.0


def test_return_normalizer_round_trips_live_chains():
    rn = ReturnNormalizer(gamma=0.5)
    rn.normalize(2, 3, 4.0, done=False)

    restored = ReturnNormalizer()
    restored.from_dict(rn.to_dict())

    assert restored._returns == {(2, 3): 4.0}


def test_return_normalizer_isolates_envs_and_seats():
    """env 0 seat 0 and env 1 seat 0 must NOT share the running-return chain."""
    rn = ReturnNormalizer(gamma=0.99)

    # Build a tall reward in env 0, seat 0, no done
    for _ in range(10):
        rn.normalize(0, 0, 100.0, done=False)
    # Now a fresh stream in env 1 seat 0 should NOT inherit env 0's tower:
    # the FIRST (env 1, seat 0) transition has return = 0 + reward
    # We can't read the internal chain from outside, so check indirectly:
    # the running variance has been polluted by env 0's huge returns, but
    # a small reward in env 1 should still be O(1) in scale once divided.
    scaled = rn.normalize(1, 0, 1.0, done=False)
    # env 0 returns blew up the running std, so scaled should be SMALL
    assert abs(scaled) < 1.0, f"got {scaled} — env 1 inherited env 0's chain"


def test_return_normalizer_seats_isolated_within_env():
    """Within one env, seat 0 and seat 1 must not share a chain."""
    rn = ReturnNormalizer(gamma=0.5)
    # Hammer seat 0
    for _ in range(20):
        rn.normalize(0, 0, 5.0, done=False)
    # Reset stats by checking count then probing seat 1
    # Internal: chain[(0,0)] should be ~5/(1-0.5) = 10. chain[(0,1)] still 0.
    assert rn._returns.get((0, 0), 0.0) > 5.0
    assert rn._returns.get((0, 1), 0.0) == 0.0
    rn.normalize(0, 1, 1.0, done=False)
    # After this, (0,1) chain = 1.0
    assert abs(rn._returns[(0, 1)] - 1.0) < 1e-6
    # (0,0) chain unaffected
    assert rn._returns[(0, 0)] > 5.0


def test_normalize_batch_matches_loop():
    """The vectorized batch helper must equal the per-step loop."""
    gamma = 0.99
    rn_loop = ReturnNormalizer(gamma=gamma)
    rn_batch = ReturnNormalizer(gamma=gamma)

    np.random.seed(0)
    n = 50
    env = np.random.randint(0, 4, size=n).astype(np.int64)
    seats = np.random.randint(0, 4, size=n).astype(np.int64)
    rewards = np.random.randn(n).astype(np.float32)
    dones = np.random.rand(n) < 0.05

    expected = np.array(
        [
            rn_loop.normalize(int(env[i]), int(seats[i]), float(rewards[i]), bool(dones[i]))
            for i in range(n)
        ],
        dtype=np.float32,
    )
    got = rn_batch.normalize_batch(env, seats, rewards, dones)

    np.testing.assert_allclose(got, expected, atol=1e-6)


def test_scale_only_no_mean_shift():
    """The normalizer divides by std but does NOT subtract the mean.

    (A constant positive reward should produce constant positive scaled
    rewards, never centered to zero.)
    """
    rn = ReturnNormalizer(gamma=0.99)
    # Burn in: 100 transitions of reward = 1.0
    for _ in range(100):
        rn.normalize(0, 0, 1.0, done=False)
    # Next reward also = 1.0; scaled value should be > 0
    scaled = rn.normalize(0, 0, 1.0, done=False)
    assert scaled > 0.0, f"normalizer subtracted mean; got {scaled}"
