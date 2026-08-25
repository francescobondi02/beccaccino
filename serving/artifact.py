"""Small, verified model artifacts for inference deployments."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import torch

from training.checkpoint import checkpoint_sha256, load_checkpoint

INFERENCE_ARTIFACT_FORMAT = 1
INFERENCE_ARTIFACT_KEYS = frozenset({"artifact_format", "model", "net_config", "source"})
SOURCE_KEYS = frozenset(
    {
        "checkpoint_sha256",
        "environment_step",
        "run_id",
        "selection_protocol",
        "update",
    }
)


class InferenceArtifactError(RuntimeError):
    """The deployable model artifact is missing, corrupt, or incompatible."""


def export_inference_artifact(
    source_path: str | Path,
    destination_path: str | Path,
    *,
    selection_protocol: str,
) -> str:
    """Strip training state from a selected checkpoint and return its artifact hash."""
    source_path = Path(source_path)
    destination_path = Path(destination_path)
    checkpoint = load_checkpoint(source_path)
    payload = {
        "artifact_format": INFERENCE_ARTIFACT_FORMAT,
        "net_config": dict(checkpoint["net_config"]),
        "model": checkpoint["model"],
        "source": {
            "checkpoint_sha256": checkpoint_sha256(source_path),
            "environment_step": int(checkpoint["environment_step"]),
            "run_id": str(checkpoint["run_id"]),
            "selection_protocol": selection_protocol,
            "update": int(checkpoint["update"]),
        },
    }
    _atomic_save(destination_path, payload)
    digest = checkpoint_sha256(destination_path)
    _atomic_write_text(_checksum_path(destination_path), f"{digest}\n")
    return digest


def load_inference_artifact(path: str | Path, map_location="cpu") -> dict:
    """Load a model-only artifact without enabling arbitrary pickle objects."""
    path = Path(path)
    _verify_checksum(path)
    try:
        payload = torch.load(path, map_location=map_location, weights_only=True)
    except Exception as exc:
        raise InferenceArtifactError(f"cannot load inference artifact: {path}") from exc

    if not isinstance(payload, dict) or frozenset(payload) != INFERENCE_ARTIFACT_KEYS:
        raise InferenceArtifactError(f"unexpected inference artifact fields: {path}")
    if payload["artifact_format"] != INFERENCE_ARTIFACT_FORMAT:
        raise InferenceArtifactError(
            f"unsupported inference artifact format: {payload['artifact_format']!r}"
        )
    if not isinstance(payload["model"], dict) or not isinstance(payload["net_config"], dict):
        raise InferenceArtifactError(f"invalid model payload: {path}")
    if not isinstance(payload["source"], dict) or frozenset(payload["source"]) != SOURCE_KEYS:
        raise InferenceArtifactError(f"invalid source metadata: {path}")
    return payload


def _verify_checksum(path: Path) -> None:
    sidecar = _checksum_path(path)
    try:
        expected = sidecar.read_text().strip()
    except OSError as exc:
        raise InferenceArtifactError(f"cannot read inference artifact hash: {sidecar}") from exc
    if len(expected) != 64 or any(character not in "0123456789abcdef" for character in expected):
        raise InferenceArtifactError(f"invalid inference artifact hash: {sidecar}")
    actual = checkpoint_sha256(path)
    if actual != expected:
        raise InferenceArtifactError(
            f"inference artifact hash mismatch for {path}: expected {expected}, got {actual}"
        )


def _atomic_save(path: Path, payload: dict) -> None:
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
            os.fchmod(temporary_file.fileno(), 0o644)
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _atomic_write_text(path: Path, value: str) -> None:
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w") as temporary_file:
            temporary_file.write(value)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            os.fchmod(temporary_file.fileno(), 0o644)
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _checksum_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.sha256")
