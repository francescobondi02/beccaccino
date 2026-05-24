"""Elo rating system for tracking agent strength over training."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EloTracker:
    """Tracks Elo ratings for the current agent relative to a fixed baseline."""

    k_factor: float = 32.0
    initial_rating: float = 1000.0
    history: list[dict] = field(default_factory=list)
    current_rating: float = 1000.0
    baseline_rating: float = 1000.0

    def update(self, wins: int, losses: int, step: int):
        """Update Elo based on match results against the baseline (random agent)."""
        total = wins + losses
        if total == 0:
            return

        actual_score = wins / total
        expected_score = 1.0 / (1.0 + 10 ** ((self.baseline_rating - self.current_rating) / 400))
        self.current_rating += self.k_factor * (actual_score - expected_score) * total

        self.history.append({
            "step": step,
            "rating": self.current_rating,
            "wins": wins,
            "losses": losses,
            "win_rate": actual_score,
        })

    def update_from_winrate(self, win_rate: float, num_games: int, step: int):
        """Convenience: update from a win rate and game count."""
        wins = int(win_rate * num_games)
        losses = num_games - wins
        self.update(wins, losses, step)
