from scripts.benchmark import benchmark_vector_env


def test_vector_env_benchmark_executes_steps():
    steps_per_second = benchmark_vector_env(
        2,
        0.01,
        win_points=5,
        include_full_obs=True,
        sync=True,
    )
    assert steps_per_second > 0
