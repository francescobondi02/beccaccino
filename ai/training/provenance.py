"""Checkpoint source and runtime provenance."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch

SOURCE_MANIFEST_FILENAME = ".source-provenance.json"


def checkpoint_provenance(repo_root: Path | None = None) -> dict[str, Any]:
    """Describe the source tree and resolved runtime that produced an artifact."""
    return {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source_manifest(repo_root),
        "runtime": runtime_manifest(),
    }


def source_manifest(repo_root: Path | None = None) -> dict[str, Any]:
    """Return Git provenance, falling back to the manifest shipped to Kaggle."""
    root = repo_root or Path(__file__).resolve().parents[1]
    git_manifest = _git_source_manifest(root)
    if git_manifest is not None:
        return git_manifest

    staged_manifest = root / SOURCE_MANIFEST_FILENAME
    if staged_manifest.is_file():
        try:
            manifest = json.loads(staged_manifest.read_text())
        except (OSError, json.JSONDecodeError):
            pass
        else:
            if isinstance(manifest, dict):
                return manifest

    return {
        "commit": None,
        "tree": None,
        "dirty": None,
        "dirty_sha256": None,
    }


def runtime_manifest() -> dict[str, Any]:
    """Capture the resolved interpreter, platform, torch, and package versions."""
    dependencies = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            dependencies[name.lower()] = distribution.version

    return {
        "python": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
            "executable": Path(sys.executable).name,
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "torch": {
            "version": torch.__version__,
            "cuda": torch.version.cuda,
            "cudnn": torch.backends.cudnn.version(),
            "deterministic_algorithms": torch.are_deterministic_algorithms_enabled(),
        },
        "dependencies": dict(sorted(dependencies.items())),
    }


def _git_source_manifest(root: Path) -> dict[str, Any] | None:
    try:
        commit = _git(root, "rev-parse", "HEAD").decode().strip()
        tree = _git(root, "rev-parse", "HEAD^{tree}").decode().strip()
        status = _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        dirty = bool(status)
        dirty_sha256 = _dirty_state_hash(root, status) if dirty else None
    except (OSError, subprocess.CalledProcessError, UnicodeDecodeError):
        return None

    return {
        "commit": commit,
        "tree": tree,
        "dirty": dirty,
        "dirty_sha256": dirty_sha256,
    }


def _dirty_state_hash(root: Path, status: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(b"status\0")
    digest.update(status)
    digest.update(b"tracked\0")
    digest.update(_git(root, "diff", "--binary", "HEAD", "--"))
    digest.update(b"staged\0")
    digest.update(_git(root, "diff", "--binary", "--cached", "HEAD", "--"))

    untracked = _git(root, "ls-files", "--others", "--exclude-standard", "-z")
    for raw_path in filter(None, untracked.split(b"\0")):
        digest.update(b"untracked\0")
        digest.update(raw_path)
        path = root / os.fsdecode(raw_path)
        try:
            if path.is_symlink():
                digest.update(os.fsencode(os.readlink(path)))
            else:
                digest.update(path.read_bytes())
        except OSError as exc:
            digest.update(f"<unreadable:{exc.errno}>".encode())
    return digest.hexdigest()


def _git(root: Path, *args: str) -> bytes:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ).stdout
