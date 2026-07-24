"""Training configuration as a dataclass."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TrainConfig:
    # Environment
    num_envs: int = 64
    steps_per_env: int = 512
    win_points: int = 41
    # Used in eval matches; if None falls back to win_points. Train short
    # for fast credit assignment, eval at full length for honest skill numbers.
    eval_win_points: int | None = None
    # Optional per-trick reward shaping. 0.0 = pure round-end + terminal
    # (recommended). Non-zero adds ±(raw_pts/35)*coef per trick — biased
    # shaping, useful only as a curriculum hint early in training.
    trick_shaping_coef: float = 0.0

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
    # Per-(env, seat) running discounted-return reward scaling. Standard
    # CleanRL/SB3 trick — keeps value-function targets O(1) even when game
    # length / reward magnitude varies across the curriculum.
    normalize_returns: bool = True

    # Network
    hidden_size: int = 512
    num_layers: int = 3
    activation: str = "relu"
    use_layer_norm: bool = True
    network_version: int = 2
    # V4 transformer dims (ignored unless network_version == 4)
    d_model: int = 128
    nhead: int = 4
    dim_feedforward: int = 256

    # Self-play
    opponent_pool_size: int = 10
    pool_save_every: int = 50
    # Probability that a rollout uses the LATEST policy as opponent.
    # 1 - p_latest_opponent goes to a uniformly-random pool sample.
    # Lower p_latest = more diverse opponents = stronger but slower training.
    p_latest_opponent: float = 0.5
    # If True, half of envs have learner_team=0 and half =1 (balanced).
    # Otherwise all envs use learner_team=0.
    balance_learner_teams: bool = True

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
    wandb_entity: str = "francesco-bondi02-eth-z-rich"
    wandb_project: str = "BECCACCINO-RL"
    wandb_run_name: str | None = None
    log_dir: str = "runs"

    # Checkpoints
    ckpt_dir: str = "checkpoints"
    eval_every: int = 25
    eval_games: int = 200
    ckpt_every: int = 50
    resume_from: str | None = None
    # Graceful wall-clock stop (Kaggle's 12h session cap). None = no limit.
    # On expiry the trainer writes last.pt and exits so --resume can continue.
    max_hours: float | None = None

    def net_kwargs(self) -> dict:
        """Map this config to create_network(**kwargs). Single source of truth
        for building the net from a TrainConfig (V4 takes transformer dims,
        everything else takes MLP dims)."""
        if self.network_version == 4:
            return {
                "version": 4,
                "d_model": self.d_model,
                "nhead": self.nhead,
                "num_layers": self.num_layers,
                "dim_feedforward": self.dim_feedforward,
            }
        return {
            "version": self.network_version,
            "hidden_size": self.hidden_size,
            "num_layers": self.num_layers,
            "use_layer_norm": self.use_layer_norm,
        }

    @property
    def batch_size(self) -> int:
        return self.num_envs * self.steps_per_env

    @property
    def total_updates(self) -> int:
        return self.total_timesteps // self.batch_size
