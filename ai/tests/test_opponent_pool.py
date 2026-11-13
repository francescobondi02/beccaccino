"""Tests for the self-play opponent pool."""

from training.network import create_network
from training.self_play import OpponentPool


def test_empty_pool_returns_none():
    pool = OpponentPool(max_size=5)
    assert pool.sample(p_latest=0.0) is None


def test_add_and_sample():
    pool = OpponentPool(max_size=3)
    net = create_network(version=1, hidden_size=64, num_layers=1)
    pool.add_policy(net.state_dict())
    assert len(pool) == 1

    result = pool.sample(p_latest=0.0)
    assert result is not None
    assert isinstance(result, dict)


def test_max_size_eviction():
    pool = OpponentPool(max_size=3)
    for i in range(5):
        pool.add_policy({"step": i})
    assert len(pool) == 3
    assert pool.policies[0]["step"] == 2


def test_serialize_roundtrip():
    pool = OpponentPool(max_size=5)
    pool.add_policy({"a": 1})
    pool.add_policy({"b": 2})

    data = pool.serialize()
    restored = OpponentPool.from_serialized(data, max_size=5)
    assert len(restored) == 2
    assert restored.policies[0] == {"a": 1}


def test_anchor_sampled_with_empty_fifo():
    pool = OpponentPool(max_size=5, anchors=[{"anchor": True}])
    assert len(pool) == 0
    for _ in range(10):
        assert pool.sample(p_latest=0.0) == {"anchor": True}


def test_anchor_survives_fifo_overflow():
    pool = OpponentPool(max_size=2, anchors=[{"anchor": 0}])
    for i in range(5):
        pool.add_policy({"step": i})
    assert len(pool) == 2
    seen = {tuple(sorted(pool.sample(p_latest=0.0).items())) for _ in range(200)}
    assert (("anchor", 0),) in seen


def test_serialize_excludes_anchors():
    pool = OpponentPool(max_size=5, anchors=[{"anchor": 1}])
    pool.add_policy({"a": 1})
    data = pool.serialize()
    assert data == [{"a": 1}]

    restored = OpponentPool.from_serialized(data, max_size=5, anchors=[{"anchor": 1}])
    assert len(restored) == 1
    assert restored.anchors == [{"anchor": 1}]
