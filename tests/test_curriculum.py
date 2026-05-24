"""Tests for curriculum learning logic."""

from training.curriculum import CurriculumStage, CurriculumTracker


def test_initial_state():
    tracker = CurriculumTracker()
    assert tracker.current_stage == 0
    assert tracker.win_points == 5
    assert not tracker.is_final_stage


def test_advance_on_win_rate():
    tracker = CurriculumTracker(confirm_count=2)
    # Below threshold: no advance
    assert not tracker.report_eval(0.60, total_steps=1_000_000)
    assert tracker.current_stage == 0

    # Above threshold once: not enough confirmations
    assert not tracker.report_eval(0.75, total_steps=2_000_000)
    assert tracker.current_stage == 0

    # Above threshold twice: advance
    assert tracker.report_eval(0.75, total_steps=3_000_000)
    assert tracker.current_stage == 1
    assert tracker.win_points == 11


def test_confirmation_resets_on_failure():
    tracker = CurriculumTracker(confirm_count=3)
    tracker.report_eval(0.75, total_steps=1_000_000)
    tracker.report_eval(0.75, total_steps=2_000_000)
    # One failure resets the counter
    tracker.report_eval(0.50, total_steps=3_000_000)
    tracker.report_eval(0.75, total_steps=4_000_000)
    assert tracker.current_stage == 0  # Still at 0, counter was reset


def test_advance_on_step_budget():
    stages = [
        CurriculumStage(win_points=5, min_wr=0.99, max_steps=5_000_000),
        CurriculumStage(win_points=41, min_wr=0.60, max_steps=50_000_000),
    ]
    tracker = CurriculumTracker(stages=stages, confirm_count=3)

    # Win rate below threshold but exceeds step budget
    assert tracker.report_eval(0.55, total_steps=6_000_000)
    assert tracker.current_stage == 1


def test_final_stage_no_advance():
    stages = [CurriculumStage(win_points=5, min_wr=0.70, max_steps=10_000_000)]
    tracker = CurriculumTracker(stages=stages)
    assert tracker.is_final_stage
    assert not tracker.report_eval(0.99, total_steps=100_000_000)
