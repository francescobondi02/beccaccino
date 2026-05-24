"""Curriculum learning: auto-advance through game difficulty stages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CurriculumStage:
    win_points: int
    min_wr: float
    max_steps: int


DEFAULT_STAGES = [
    CurriculumStage(win_points=5, min_wr=0.70, max_steps=10_000_000),
    CurriculumStage(win_points=11, min_wr=0.70, max_steps=20_000_000),
    CurriculumStage(win_points=21, min_wr=0.65, max_steps=30_000_000),
    CurriculumStage(win_points=41, min_wr=0.60, max_steps=50_000_000),
]


class CurriculumTracker:
    """Tracks curriculum progress and decides when to advance stages."""

    def __init__(self, stages: list[CurriculumStage] | None = None, confirm_count: int = 3):
        self.stages = stages or DEFAULT_STAGES
        self.confirm_count = confirm_count
        self.current_stage = 0
        self._consecutive_passes = 0

    @property
    def win_points(self) -> int:
        return self.stages[self.current_stage].win_points

    @property
    def is_final_stage(self) -> bool:
        return self.current_stage >= len(self.stages) - 1

    def report_eval(self, win_rate: float, total_steps: int) -> bool:
        """Report an evaluation result. Returns True if stage should advance."""
        if self.is_final_stage:
            return False

        stage = self.stages[self.current_stage]

        # Check step budget
        if total_steps >= stage.max_steps:
            return self._advance()

        # Check win rate threshold
        if win_rate >= stage.min_wr:
            self._consecutive_passes += 1
            if self._consecutive_passes >= self.confirm_count:
                return self._advance()
        else:
            self._consecutive_passes = 0

        return False

    def _advance(self) -> bool:
        self.current_stage += 1
        self._consecutive_passes = 0
        return True
