"""Tests for the thin pure-PPO CLI adapter."""

from scripts.train import build_parser, config_from_args


def test_cli_maps_to_the_single_train_config():
    args = build_parser().parse_args(
        [
            "--steps",
            "4096",
            "--num-envs",
            "4",
            "--steps-per-env",
            "128",
            "--network-version",
            "4",
            "--d-model",
            "64",
            "--no-wandb",
        ]
    )

    config = config_from_args(args)

    assert config.total_timesteps == 4096
    assert config.batch_size == 512
    assert config.network_version == 4
    assert config.d_model == 64
    assert config.use_wandb is False
