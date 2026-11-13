"""Tests for the unified checkpoint + RNG utilities."""

from __future__ import annotations

import numpy as np
import pytest
import torch

from becca_env.observation import LEGACY_OBS_SIZE, OBS_SIZE
from training.checkpoint import (
    CheckpointIntegrityError,
    build_net,
    checkpoint_sha256,
    load_checkpoint,
    load_resumable_checkpoint,
    restore_rng,
    rng_state,
    save_checkpoint,
    save_checkpoint_payload,
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
    assert net.config == {
        "version": 2,
        "hidden_size": 128,
        "num_layers": 2,
        "use_layer_norm": True,
        "obs_size": OBS_SIZE,
    }
    rebuilt = create_network(**net.config)
    rebuilt.load_state_dict(net.state_dict())
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_net_config_rebuilds_v4_identically():
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2, dim_feedforward=128)
    assert net.config["version"] == 4
    assert net.config["d_model"] == 64
    assert net.config["card_conditioned_signals"] is True
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
    assert ckpt["format"] == 3
    assert ckpt["step"] == 1000
    assert ckpt["update"] == 5
    source = ckpt["provenance"]["source"]
    assert set(source) == {"commit", "tree", "dirty", "dirty_sha256"}
    assert source["dirty"] in {True, False, None}
    assert "torch" in ckpt["provenance"]["runtime"]["dependencies"]
    assert (tmp_path / "ckpt.pt.sha256").read_text().strip() == checkpoint_sha256(path)

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
        np.array([0, 0]),
        np.array([0, 1]),
        np.array([0.5, 1.0], dtype=np.float32),
        np.array([0, 0]),
    )
    pool = OpponentPool(max_size=4)
    pool.add_policy(net.state_dict())

    path = tmp_path / "ckpt.pt"
    save_checkpoint(
        path, net=net, optimizer=opt, config={"x": 1}, step=0, update=0, normalizer=norm, pool=pool
    )
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


def test_build_net_accepts_flat_bc_then_rl_checkpoint():
    """bc_then_rl.py writes a flat checkpoint keyed "config", not "net_config".
    Run B's artifacts were unloadable until build_net tolerated both layouts."""
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2, dim_feedforward=128)
    ckpt = {"model": net.state_dict(), "config": dict(net.config), "phase": "rl"}

    rebuilt = build_net(ckpt, torch.device("cpu"))
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_build_net_normalizes_legacy_network_version_key():
    """Older stamps spelled the version "network_version"; create_network takes
    "version" and would otherwise default to V2 and fail on a shape mismatch."""
    net = create_network(
        version=4,
        d_model=64,
        nhead=4,
        num_layers=2,
        dim_feedforward=128,
        card_conditioned_signals=False,
    )
    legacy = {
        "network_version": 4,
        "d_model": 64,
        "nhead": 4,
        "num_layers": 2,
        "dim_feedforward": 128,
    }
    ckpt = {"model": net.state_dict(), "net_config": legacy}

    rebuilt = build_net(ckpt, torch.device("cpu"))
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_build_net_infers_legacy_observation_width():
    net = create_network(
        version=4,
        d_model=32,
        nhead=2,
        num_layers=1,
        dim_feedforward=64,
        obs_size=LEGACY_OBS_SIZE,
        card_conditioned_signals=False,
    )
    config = dict(net.config)
    config.pop("obs_size")
    rebuilt = build_net({"model": net.state_dict(), "config": config}, torch.device("cpu"))

    assert rebuilt.obs_size == LEGACY_OBS_SIZE
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


def test_build_net_treats_missing_v4_head_flag_as_legacy():
    net = create_network(
        version=4,
        d_model=32,
        nhead=2,
        num_layers=1,
        dim_feedforward=64,
        card_conditioned_signals=False,
    )
    config = dict(net.config)
    config.pop("card_conditioned_signals")

    rebuilt = build_net({"model": net.state_dict(), "config": config}, torch.device("cpu"))

    assert rebuilt.card_conditioned_signals is False
    assert _state_dicts_equal(net.state_dict(), rebuilt.state_dict())


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


def test_interrupted_save_keeps_current_checkpoint_and_hash(tmp_path, monkeypatch):
    path = tmp_path / "last.pt"
    save_checkpoint_payload(path, {"update": 1, "provenance": {}})
    original_checkpoint = path.read_bytes()
    original_hash = (tmp_path / "last.pt.sha256").read_text()

    def interrupted_save(payload, destination):
        destination.write(b"partial checkpoint")
        destination.flush()
        raise OSError("simulated interruption")

    monkeypatch.setattr(torch, "save", interrupted_save)
    with pytest.raises(OSError, match="simulated interruption"):
        save_checkpoint_payload(path, {"update": 2, "provenance": {}})

    assert path.read_bytes() == original_checkpoint
    assert (tmp_path / "last.pt.sha256").read_text() == original_hash
    assert list(tmp_path.glob("*.tmp")) == []
    assert load_checkpoint(path)["update"] == 1


def test_save_rotates_verified_previous_checkpoint(tmp_path):
    path = tmp_path / "last.pt"
    save_checkpoint_payload(path, {"update": 1, "provenance": {}})
    save_checkpoint_payload(path, {"update": 2, "provenance": {}})

    previous = tmp_path / "last.prev.pt"
    assert load_checkpoint(path)["update"] == 2
    assert load_checkpoint(previous)["update"] == 1
    assert (tmp_path / "last.prev.pt.sha256").read_text().strip() == checkpoint_sha256(previous)


def test_load_falls_back_when_current_checkpoint_is_tampered(tmp_path):
    path = tmp_path / "last.pt"
    save_checkpoint_payload(path, {"update": 1, "provenance": {}})
    save_checkpoint_payload(path, {"update": 2, "provenance": {}})
    path.write_bytes(b"tampered")

    with pytest.warns(RuntimeWarning, match="loaded fallback"):
        checkpoint = load_resumable_checkpoint(path)

    assert checkpoint["update"] == 1


def test_load_rejects_tampered_checkpoint_without_fallback(tmp_path):
    path = tmp_path / "last.pt"
    save_checkpoint_payload(path, {"update": 1, "provenance": {}})
    path.write_bytes(b"tampered")

    with pytest.raises(CheckpointIntegrityError, match="hash mismatch"):
        load_checkpoint(path)


def test_load_rejects_when_current_and_fallback_are_tampered(tmp_path):
    path = tmp_path / "last.pt"
    save_checkpoint_payload(path, {"update": 1})
    save_checkpoint_payload(path, {"update": 2})
    path.write_bytes(b"tampered current")
    (tmp_path / "last.prev.pt").write_bytes(b"tampered previous")

    with pytest.raises(CheckpointIntegrityError, match="checkpoint and fallback are unusable"):
        load_resumable_checkpoint(path)


def test_load_accepts_legacy_checkpoint_without_hash(tmp_path):
    path = tmp_path / "legacy.pt"
    torch.save({"format": 2, "value": "legacy"}, path)

    assert load_checkpoint(path)["value"] == "legacy"
    assert not (tmp_path / "legacy.pt.sha256").exists()


def test_resume_rejects_legacy_checkpoint_without_hash(tmp_path):
    path = tmp_path / "legacy.pt"
    torch.save({"format": 2, "provenance": {}}, path)

    with pytest.raises(CheckpointIntegrityError, match="hash is required"):
        load_resumable_checkpoint(path)
