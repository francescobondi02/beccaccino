"""Tests for best-checkpoint tracking.

Self-play is non-monotone: a run can peak mid-way and drift down. Until now only
final.pt / last.pt were kept, so the strongest weights a run ever produced could
be lost — Run B's curve peaked around update 300 of 915. These tests pin the
contract that the peak is saved and that resuming cannot silently destroy it.

Kept tiny (single env, CPU, win_points=5) like test_trainer.py: they verify the
checkpoint contract, not learning.
"""

from __future__ import annotations

from pathlib import Path

from training.checkpoint import load_checkpoint
from training.config import TrainConfig
from training.trainer import train


def _tiny_config(tmp_path: Path, **overrides) -> TrainConfig:
    cfg = TrainConfig(
        num_envs=1,
        steps_per_env=200,
        total_timesteps=400,  # -> 2 updates at batch 200
        win_points=5,
        eval_every=1,  # eval every update so best-tracking engages
        eval_games=2,
        ckpt_every=1,
        ckpt_dir=str(tmp_path),
        hidden_size=64,
        num_layers=2,
        use_wandb=False,
        seed=7,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


def test_best_checkpoint_is_written_when_eval_runs(tmp_path):
    train(_tiny_config(tmp_path))
    best = tmp_path / "best.pt"
    assert best.exists(), "best.pt should exist once any eval has run"
    ckpt = load_checkpoint(best)
    assert ckpt["best_update"] > 0
    assert ckpt["update"] == ckpt["best_update"], (
        "best.pt must be the checkpoint from the update that scored best"
    )


def test_best_checkpoint_records_the_score_it_was_saved_for(tmp_path):
    train(_tiny_config(tmp_path))
    ckpt = load_checkpoint(tmp_path / "best.pt")
    assert 0.0 <= ckpt["best_wr_heuristic"] <= 1.0


def test_no_best_checkpoint_when_eval_never_runs(tmp_path):
    """With eval disabled there is no basis for ranking, so nothing is claimed."""
    train(_tiny_config(tmp_path, eval_every=1000))
    assert not (tmp_path / "best.pt").exists()


def test_resume_inherits_the_best_bar(tmp_path):
    """A resumed run must start from the previous session's best score, not -1,
    or its first eval would overwrite a better best.pt."""
    cfg = _tiny_config(tmp_path, total_timesteps=800, max_hours=0.0)
    train(cfg)
    first_best = load_checkpoint(tmp_path / "best.pt")["best_wr_heuristic"]

    resumed = _tiny_config(
        tmp_path,
        total_timesteps=800,
        resume_from=str(tmp_path / "last.pt"),
    )
    train(resumed)

    last = load_checkpoint(tmp_path / "last.pt")
    assert last["best_wr_heuristic"] >= first_best, "resume must not lower the best-so-far bar"
