"""Smoke tests for the trainer's resume + graceful-stop plumbing.

Kept tiny (single env, few updates, win_points=5, no wandb) so they run on CPU
in a couple seconds. They verify the checkpoint/resume contract, not learning.
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
        total_timesteps=400,      # -> 2 updates at batch 200
        win_points=5,
        eval_every=1000,          # skip eval in the smoke
        eval_games=2,
        ckpt_every=1,
        ckpt_dir=str(tmp_path),
        hidden_size=64,
        num_layers=2,
        use_wandb=False,
        normalize_returns=True,
        seed=7,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


def test_train_writes_resumable_checkpoints(tmp_path):
    cfg = _tiny_config(tmp_path)
    train(cfg)
    last = tmp_path / "last.pt"
    assert last.exists() and (tmp_path / "final.pt").exists()
    ckpt = load_checkpoint(last)
    assert ckpt["format"] == 2
    assert ckpt["update"] == cfg.total_updates
    assert ckpt["step"] > 0
    assert ckpt["normalizer"] is not None  # normalize_returns=True


def test_resume_continues_update_numbering_and_steps(tmp_path):
    cfg = _tiny_config(tmp_path)
    train(cfg)
    first = load_checkpoint(tmp_path / "last.pt")

    resume_dir = tmp_path / "resumed"
    resume_dir.mkdir()
    cfg2 = _tiny_config(
        resume_dir,
        total_timesteps=800,  # 2 more updates
        resume_from=str(tmp_path / "last.pt"),
    )
    train(cfg2)
    second = load_checkpoint(resume_dir / "last.pt")

    assert second["update"] > first["update"], "resume did not advance update count"
    assert second["step"] > first["step"], "step count not monotonic across resume"


def test_max_hours_zero_stops_after_first_update(tmp_path):
    """max_hours=0 means the deadline is already past, so training writes last.pt
    and stops after the first update rather than running the full budget."""
    cfg = _tiny_config(tmp_path, total_timesteps=2000, max_hours=0.0)
    train(cfg)
    ckpt = load_checkpoint(tmp_path / "last.pt")
    assert ckpt["update"] < cfg.total_updates  # stopped early


def test_centralized_critic_trains_and_is_checkpointed(tmp_path):
    """A short vec self-play run with the CTDE critic enabled runs end-to-end and
    persists the critic in the checkpoint."""
    cfg = _tiny_config(
        tmp_path,
        num_envs=4,           # vec path (critic requires >1)
        steps_per_env=100,
        total_timesteps=800,  # 2 updates at batch 400
        centralized_critic=True,
    )
    train(cfg)
    ckpt = load_checkpoint(tmp_path / "last.pt")
    assert ckpt.get("critic") is not None, "critic not saved in checkpoint"


def test_centralized_critic_requires_vec_path(tmp_path):
    import pytest
    cfg = _tiny_config(tmp_path, num_envs=1, centralized_critic=True)
    with pytest.raises(ValueError, match="num_envs > 1"):
        train(cfg)
