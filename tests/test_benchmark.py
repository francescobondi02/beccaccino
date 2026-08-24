from scripts.bc_then_rl import parse_args
from scripts.benchmark import RUN_D2_CRITIC, RUN_D2_NETWORK, benchmark_training_rollout
from scripts.kaggle_run import RUN_D2_SPEC


def test_benchmark_network_matches_run_d2():
    assert RUN_D2_NETWORK == {
        "version": RUN_D2_SPEC.network_version,
        "d_model": RUN_D2_SPEC.d_model,
        "nhead": RUN_D2_SPEC.nhead,
        "num_layers": RUN_D2_SPEC.layers,
        "dim_feedforward": RUN_D2_SPEC.dim_feedforward,
    }


def test_benchmark_critic_matches_run_d2():
    # bc_then_rl builds the critic from args.hidden/args.layers; derive them the
    # way a real Run D2 launch does — by parsing the rendered preset flags — so
    # the benchmark measures the same critic the run trains.
    args = parse_args(RUN_D2_SPEC.to_cli_args())
    assert RUN_D2_CRITIC == {
        "hidden_size": args.hidden,
        "num_layers": args.layers,
        "use_layer_norm": True,
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
