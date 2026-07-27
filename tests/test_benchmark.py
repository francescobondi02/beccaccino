from scripts.benchmark import RUN_D_NETWORK, benchmark_training_rollout
from scripts.kaggle_run import RUN_D_SPEC


def test_benchmark_network_matches_run_d():
    assert RUN_D_NETWORK == {
        "version": RUN_D_SPEC.network_version,
        "d_model": RUN_D_SPEC.d_model,
        "nhead": RUN_D_SPEC.nhead,
        "num_layers": RUN_D_SPEC.layers,
        "dim_feedforward": RUN_D_SPEC.dim_feedforward,
    }


def test_training_rollout_benchmark_executes_full_collection_path():
    steps_per_second = benchmark_training_rollout(
        2,
        0.01,
        win_points=5,
        include_full_obs=True,
        sync=True,
        device="cpu",
        rollout_steps=2,
        network_kwargs={
            "version": 2,
            "hidden_size": 32,
            "num_layers": 1,
        },
    )
    assert steps_per_second > 0
