"""Tests for the unified checkpoint + RNG utilities."""

from __future__ import annotations

import numpy as np
import torch

from becca_env.observation import OBS_SIZE
from training.checkpoint import (
    build_net,
    load_checkpoint,
    restore_rng,
    rng_state,
    save_checkpoint,
    seed_everything,
)
from training.config import TrainConfig
from training.network import create_network
from training.normalization import ReturnNormalizer
from training.self_play import OpponentPool


def _state_dicts_equal(a: dict, b: dict) -> bool:
    if a.keys() != b.keys():
        return False
    return all(torch.equal(a[k], b[k]) for k in a)


def test_net_config_rebuilds_v2_identically():
    net = create_network(version=2, hidden_size=128, num_layers=2)
    assert net.config == {"version": 2, "hidden_size": 128, "num_layers": 2, "use_layer_norm": True}
    rebuilt = create_network(**net.config)
    rebuilt.load_state_dict(net.state_dict())
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_net_config_rebuilds_v4_identically():
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2, dim_feedforward=128)
    assert net.config["version"] == 4
    assert net.config["d_model"] == 64
    rebuilt = create_network(**net.config)
    rebuilt.load_state_dict(net.state_dict())
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_checkpoint_round_trip_model_and_optimizer(tmp_path):
    net = create_network(version=2, hidden_size=64, num_layers=2)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    # Take a step so optimizer state is non-trivial.
    loss = net.forward(torch.randn(4, OBS_SIZE), torch.ones(4, 160))[0].sum()
    loss.backward()
    opt.step()

    cfg = TrainConfig(network_version=2, hidden_size=64, num_layers=2)
    path = tmp_path / "ckpt.pt"
    save_checkpoint(path, net=net, optimizer=opt, config=cfg, step=1000, update=5)

    ckpt = load_checkpoint(path)
    assert ckpt["format"] == 2
    assert ckpt["step"] == 1000
    assert ckpt["update"] == 5

    net2 = build_net(ckpt, torch.device("cpu"))
    assert _state_dicts_equal(net.state_dict(), net2.state_dict())

    opt2 = torch.optim.Adam(net2.parameters(), lr=1e-3)
    opt2.load_state_dict(ckpt["optimizer"])
    assert opt2.state_dict()["param_groups"] == opt.state_dict()["param_groups"]


def test_checkpoint_persists_normalizer_and_pool(tmp_path):
    net = create_network(version=2, hidden_size=64, num_layers=2)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    norm = ReturnNormalizer(gamma=0.99)
    norm.normalize_batch(
        np.array([0, 0]), np.array([0, 1]),
        np.array([0.5, 1.0], dtype=np.float32), np.array([0, 0]),
    )
    pool = OpponentPool(max_size=4)
    pool.add_policy(net.state_dict())

    path = tmp_path / "ckpt.pt"
    save_checkpoint(path, net=net, optimizer=opt, config={"x": 1}, step=0, update=0,
                    normalizer=norm, pool=pool)
    ckpt = load_checkpoint(path)

    norm2 = ReturnNormalizer(gamma=0.5)  # different gamma to prove it loads
    norm2.from_dict(ckpt["normalizer"])
    assert norm2.gamma == 0.99
    assert norm2.rms.var == norm.rms.var
    assert norm2.rms.count == norm.rms.count

    pool2 = OpponentPool.from_serialized(ckpt["pool"], max_size=4)
    assert len(pool2) == 1


def test_checkpoint_normalizer_and_pool_none_round_trip(tmp_path):
    net = create_network(version=2, hidden_size=64, num_layers=2)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    path = tmp_path / "ckpt.pt"
    save_checkpoint(path, net=net, optimizer=opt, config={"x": 1}, step=0, update=0)
    ckpt = load_checkpoint(path)
    assert ckpt["normalizer"] is None
    assert ckpt["pool"] is None


def test_seed_everything_makes_runs_identical():
    seed_everything(123)
    a = torch.rand(5)
    b = np.random.rand(5)
    seed_everything(123)
    assert torch.equal(a, torch.rand(5))
    assert np.allclose(b, np.random.rand(5))


def test_rng_state_round_trip_reproduces_draw():
    seed_everything(7)
    torch.rand(3)  # advance the state
    state = rng_state()
    expected = torch.rand(4)
    restore_rng(state)
    assert torch.equal(expected, torch.rand(4))
