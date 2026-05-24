"""Training configuration as a dataclass."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TrainConfig:
    # Environment
    num_envs: int = 64
    steps_per_env: int = 512
    win_points: int = 41

    # PPO
    lr: float = 2.5e-4
    gamma: float = 0.995
    gae_lambda: float = 0.95
    clip_eps: float = 0.2
    vf_coef: float = 0.5
    ent_coef: float = 0.03
    ent_coef_final: float = 0.005
    max_grad_norm: float = 0.5
    num_epochs: int = 4
    minibatch_size: int = 2048
    target_kl: float = 0.02

    # Network
    hidden_size: int = 512
    num_layers: int = 3
    activation: str = "relu"
    use_layer_norm: bool = True
    network_version: int = 2

    # Self-play
    opponent_pool_size: int = 10
    pool_save_every: int = 50
    p_latest_opponent: float = 0.8

    # Training
    total_timesteps: int = 100_000_000
    lr_schedule: str = "cosine"
    seed: int = 0
    device: str = "cpu"

    # Curriculum
    use_curriculum: bool = False
    curriculum_stages: list[dict] = field(default_factory=lambda: [
        {"win_points": 5, "min_wr": 0.70, "max_steps": 10_000_000},
        {"win_points": 11, "min_wr": 0.70, "max_steps": 20_000_000},
        {"win_points": 21, "min_wr": 0.65, "max_steps": 30_000_000},
        {"win_points": 41, "min_wr": 0.60, "max_steps": 50_000_000},
    ])
    curriculum_confirm_count: int = 3

    # Logging
    use_wandb: bool = True
    wandb_project: str = "becca-ai"
    wandb_run_name: str | None = None
    log_dir: str = "runs"

    # Checkpoints
    ckpt_dir: str = "checkpoints"
    eval_every: int = 25
    eval_games: int = 200
    ckpt_every: int = 50
    resume_from: str | None = None

    @property
    def batch_size(self) -> int:
        return self.num_envs * self.steps_per_env

    @property
    def total_updates(self) -> int:
        return self.total_timesteps // self.batch_size
