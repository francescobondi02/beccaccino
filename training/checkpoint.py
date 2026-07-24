"""Unified checkpoint save/load and RNG utilities.

One place that knows how to persist a full training state — model, optimizer,
return-normalizer, opponent pool, config, step/update counters, and RNG — so a
run can be resumed byte-consistently and reproduced from its seed. The network
architecture is rebuilt from the stamped `net.config` (see create_network), so
loaders never guess the shape.
"""

from __future__ import annotations

import random
from dataclasses import asdict, is_dataclass
from typing import Any

import numpy as np
import torch
import torch.nn as nn

from training.network import create_network

CKPT_FORMAT = 2


def save_checkpoint(
    path,
    *,
    net: nn.Module,
    optimizer: torch.optim.Optimizer,
    config: Any,
    step: int,
    update: int,
    normalizer=None,
    pool=None,
    extra: dict | None = None,
) -> None:
    """Persist a full training state to `path`.

    `config` may be a TrainConfig dataclass or a plain dict. `normalizer` (a
    ReturnNormalizer) and `pool` (an OpponentPool) are optional; each is stored
    via its own serializer so None round-trips as None."""
    payload = {
        "format": CKPT_FORMAT,
        "net_config": dict(net.config),
        "model": net.state_dict(),
        "optimizer": optimizer.state_dict(),
        "train_config": asdict(config) if is_dataclass(config) else dict(config),
        "step": step,
        "update": update,
        "rng": rng_state(),
        "normalizer": normalizer.to_dict() if normalizer is not None else None,
        "pool": pool.serialize() if pool is not None else None,
    }
    if extra:
        payload.update(extra)
    torch.save(payload, path)


def load_checkpoint(path, map_location="cpu") -> dict:
    """Load a checkpoint payload dict. Callers pull the fields they need with
    the usual ckpt[...] / ckpt.get(...) idiom."""
    return torch.load(path, map_location=map_location, weights_only=False)


def build_net(ckpt: dict, device) -> nn.Module:
    """Rebuild the network from a checkpoint's stamped config and load weights."""
    net = create_network(**ckpt["net_config"]).to(device)
    net.load_state_dict(ckpt["model"])
    return net


def seed_everything(seed: int) -> None:
    """Seed Python, NumPy, and torch (incl. CUDA) so a run is reproducible from
    its config seed. Does NOT force deterministic cuDNN algorithms — that carries
    a real GPU throughput cost and the stochastic part that matters (card
    dealing) is already env-seeded."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def rng_state() -> dict:
    """Snapshot the global RNG state of every generator we seed."""
    return {
        "python": random.getstate(),
        "numpy": np.random.get_state(),
        "torch": torch.get_rng_state(),
        "torch_cuda": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None,
    }


def restore_rng(state: dict) -> None:
    """Restore RNG state captured by rng_state() (from a resumed checkpoint)."""
    random.setstate(state["python"])
    np.random.set_state(state["numpy"])
    torch.set_rng_state(_as_byte_tensor(state["torch"]))
    if state.get("torch_cuda") is not None and torch.cuda.is_available():
        torch.cuda.set_rng_state_all([_as_byte_tensor(s) for s in state["torch_cuda"]])


def _as_byte_tensor(x) -> torch.Tensor:
    """torch RNG state must be a uint8 CPU tensor; torch.load may return it as a
    plain tensor already, but normalize to be safe across versions."""
    if isinstance(x, torch.Tensor):
        return x.cpu().to(torch.uint8)
    return torch.tensor(x, dtype=torch.uint8)
