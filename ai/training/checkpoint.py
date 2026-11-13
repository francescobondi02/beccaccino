"""Unified checkpoint save/load and RNG utilities.

One place that knows how to persist a full training state — model, optimizer,
return-normalizer, opponent pool, config, step/update counters, and RNG — so a
run can be resumed byte-consistently and reproduced from its seed. The network
architecture is rebuilt from the stamped `net.config` (see create_network), so
loaders never guess the shape.
"""

from __future__ import annotations

import hashlib
import os
import random
import shutil
import tempfile
import warnings
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

from training.network import create_network
from training.provenance import checkpoint_provenance

CKPT_FORMAT = 3


class CheckpointIntegrityError(RuntimeError):
    """A checkpoint does not match its integrity sidecar."""


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
    save_checkpoint_payload(path, payload)


def save_checkpoint_payload(path, payload: dict) -> None:
    """Atomically save any checkpoint payload with provenance and integrity."""
    stamped = dict(payload)
    stamped["format"] = CKPT_FORMAT
    stamped["provenance"] = checkpoint_provenance()
    _atomic_torch_save(Path(path), stamped)


def load_checkpoint(path, map_location="cpu") -> dict:
    """Load a verified checkpoint, falling back to its previous known-good copy."""
    return _load_with_fallback(Path(path), map_location, require_checksum=False)


def load_resumable_checkpoint(path, map_location="cpu") -> dict:
    """Load a current resumable checkpoint with mandatory integrity metadata."""
    payload = _load_with_fallback(Path(path), map_location, require_checksum=True)
    if payload.get("format") != CKPT_FORMAT:
        raise CheckpointIntegrityError(
            f"resuming requires checkpoint format {CKPT_FORMAT}; found {payload.get('format')!r}"
        )
    provenance = payload.get("provenance")
    if (
        not isinstance(provenance, dict)
        or not isinstance(provenance.get("source"), dict)
        or not isinstance(provenance.get("runtime"), dict)
    ):
        raise CheckpointIntegrityError("resuming requires checkpoint provenance")
    return payload


def _load_with_fallback(path: Path, map_location, *, require_checksum: bool) -> dict:
    checkpoint_path = Path(path)
    try:
        return _load_verified(checkpoint_path, map_location, require_checksum=require_checksum)
    except Exception as primary_error:
        previous_path = _previous_path(checkpoint_path)
        if not previous_path.is_file():
            raise
        try:
            payload = _load_verified(previous_path, map_location, require_checksum=require_checksum)
        except Exception as previous_error:
            raise CheckpointIntegrityError(
                f"checkpoint and fallback are unusable: {checkpoint_path}, {previous_path}"
            ) from previous_error
        warnings.warn(
            f"checkpoint {checkpoint_path} is unusable ({primary_error}); "
            f"loaded fallback {previous_path}",
            RuntimeWarning,
            stacklevel=2,
        )
        return payload


def checkpoint_sha256(path) -> str:
    """Return the SHA-256 digest of a checkpoint file."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as checkpoint:
        for chunk in iter(lambda: checkpoint.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_torch_save(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as temporary_file:
            torch.save(payload, temporary_file)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())

        digest = checkpoint_sha256(temporary_path)
        if path.is_file() and _known_good_digest(path) is not None:
            _copy_previous(path)

        os.replace(temporary_path, path)
        _fsync_directory(path.parent)
        _write_checksum(path, digest)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _copy_previous(path: Path) -> None:
    previous_path = _previous_path(path)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{previous_path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with path.open("rb") as source, os.fdopen(file_descriptor, "wb") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
            destination.flush()
            os.fsync(destination.fileno())
        digest = checkpoint_sha256(temporary_path)
        os.replace(temporary_path, previous_path)
        _fsync_directory(path.parent)
        _write_checksum(previous_path, digest)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _known_good_digest(path: Path) -> str | None:
    sidecar = _checksum_path(path)
    try:
        if sidecar.is_file():
            return _verify_checksum(path)
        torch.load(path, map_location="cpu", weights_only=False)
        return checkpoint_sha256(path)
    except Exception:
        return None


def _load_verified(path: Path, map_location, *, require_checksum: bool) -> dict:
    if require_checksum and not _checksum_path(path).is_file():
        raise CheckpointIntegrityError(f"checkpoint hash is required: {_checksum_path(path)}")
    if _checksum_path(path).is_file():
        _verify_checksum(path)
    return torch.load(path, map_location=map_location, weights_only=False)


def _verify_checksum(path: Path) -> str:
    sidecar = _checksum_path(path)
    try:
        expected = sidecar.read_text().strip()
    except OSError as exc:
        raise CheckpointIntegrityError(f"cannot read checkpoint hash: {sidecar}") from exc
    if len(expected) != 64 or any(character not in "0123456789abcdef" for character in expected):
        raise CheckpointIntegrityError(f"invalid checkpoint hash: {sidecar}")
    actual = checkpoint_sha256(path)
    if actual != expected:
        raise CheckpointIntegrityError(
            f"checkpoint hash mismatch for {path}: expected {expected}, got {actual}"
        )
    return actual


def _write_checksum(path: Path, digest: str) -> None:
    sidecar = _checksum_path(path)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{sidecar.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w") as temporary_file:
            temporary_file.write(f"{digest}\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, sidecar)
        _fsync_directory(path.parent)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _checksum_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.sha256")


def _previous_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.prev{path.suffix}")


def _fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    file_descriptor = os.open(directory, flags)
    try:
        os.fsync(file_descriptor)
    finally:
        os.close(file_descriptor)


def net_config_of(ckpt: dict) -> dict:
    """Read a checkpoint's architecture stamp, tolerating both layouts we ship:
    the unified format uses "net_config", the flat bc_then_rl checkpoints use
    "config". Older stamps spell the version key "network_version" — normalize
    it to the "version" kwarg create_network actually takes, otherwise it
    silently falls back to V2 and load_state_dict fails on a shape mismatch."""
    config = ckpt.get("net_config") or ckpt["config"]
    config = dict(config)
    if "network_version" in config:
        config["version"] = config.pop("network_version")
    if config["version"] == 4 and "card_conditioned_signals" not in config:
        config["card_conditioned_signals"] = False
    if "obs_size" not in config:
        config["obs_size"] = _infer_checkpoint_obs_size(ckpt["model"], config["version"])
    return config


def _infer_checkpoint_obs_size(state_dict: dict, version: int) -> int:
    """Infer input width for checkpoints written before obs_size was stamped."""
    if version == 1:
        return int(state_dict["policy_net.0.weight"].shape[1])
    if version == 4:
        return 400 + int(state_dict["global_proj.weight"].shape[1])
    return int(state_dict["trunk.0.weight"].shape[1])


def build_net(ckpt: dict, device) -> nn.Module:
    """Rebuild the network from a checkpoint's stamped config and load weights."""
    net = create_network(**net_config_of(ckpt)).to(device)
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
