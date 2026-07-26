"""Tests for the signal-honesty anneal schedule and its delivery into envs.

The delivery test matters more than it looks: the training envs are
AsyncVectorEnv subprocesses, so assigning the attribute on the handle would
mutate only the parent's copy and the shaping would silently never reach the
workers actually generating experience.
"""

from __future__ import annotations

from training.config import TrainConfig
from training.trainer import _apply_signal_honesty_coef, signal_honesty_schedule
from training.vec_env import create_vec_env

START = 0.05
FINAL = 0.0
BATCH = TrainConfig().batch_size


def _config(**kwargs) -> TrainConfig:
    """A config whose total_updates is exactly 100, so update N is N% of the run."""
    base = {
        "total_timesteps": BATCH * 100,
        "signal_honesty_coef": START,
        "signal_honesty_coef_final": FINAL,
    }
    return TrainConfig(**{**base, **kwargs})


def test_schedule_starts_at_the_initial_coefficient():
    assert signal_honesty_schedule(_config(), update=1) == START


def test_schedule_reaches_the_final_value_at_the_anneal_point():
    cfg = _config(signal_honesty_frac=0.5)
    assert signal_honesty_schedule(cfg, update=51) == FINAL


def test_schedule_holds_the_final_value_after_the_anneal_point():
    """Past the ramp it must stay put, not keep extrapolating past `final`."""
    cfg = _config(signal_honesty_frac=0.5)
    for update in (51, 75, 100):
        assert signal_honesty_schedule(cfg, update) == FINAL


def test_schedule_decreases_monotonically_through_the_ramp():
    cfg = _config(signal_honesty_frac=0.5)
    values = [signal_honesty_schedule(cfg, u) for u in range(1, 52)]
    assert all(a >= b for a, b in zip(values, values[1:])), values
    assert values[0] > values[-1]


def test_schedule_is_halfway_at_the_ramp_midpoint():
    """Progress is (update-1)/(total_updates-1), so the ramp's midpoint sits at
    update 50.5 of 100 — update 51 is the first at/after the end of the ramp, and
    the halfway coefficient lands between updates 25 and 26."""
    cfg = _config(signal_honesty_frac=0.5)
    halfway = (START + FINAL) / 2
    assert signal_honesty_schedule(cfg, update=25) > halfway
    assert signal_honesty_schedule(cfg, update=26) < halfway


def test_zero_frac_jumps_straight_to_the_final_value():
    """frac=0 means "no ramp"; it must not divide by zero."""
    cfg = _config(signal_honesty_frac=0.0)
    assert signal_honesty_schedule(cfg, update=1) == FINAL


def test_schedule_can_anneal_upward():
    """Nothing in the schedule should assume start > final."""
    cfg = _config(signal_honesty_coef=0.0, signal_honesty_coef_final=0.05)
    assert signal_honesty_schedule(cfg, update=1) == 0.0
    assert signal_honesty_schedule(cfg, update=51) == 0.05


def test_coefficient_reaches_async_subprocess_workers():
    """The real training path: the setter must execute IN each worker process."""
    vec = create_vec_env(num_envs=2, seed=0, win_points=5, sync=False, signal_honesty_coef=START)
    try:
        assert vec.get_attr("signal_honesty_coef") == (START, START)
        _apply_signal_honesty_coef(vec, 0.01, use_vec=True)
        assert vec.get_attr("signal_honesty_coef") == (0.01, 0.01)
    finally:
        vec.close()


def test_coefficient_applies_to_a_single_env():
    from becca_env.env import BeccaEnv

    env = BeccaEnv(seed=0, win_points=5)
    _apply_signal_honesty_coef(env, 0.02, use_vec=False)
    assert env.signal_honesty_coef == 0.02


def test_vec_env_factory_defaults_to_no_shaping():
    """Existing callers that never heard of signals must be unaffected."""
    vec = create_vec_env(num_envs=2, seed=0, win_points=5, sync=True)
    try:
        assert vec.get_attr("signal_honesty_coef") == (0.0, 0.0)
    finally:
        vec.close()
