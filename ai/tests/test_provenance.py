"""Tests for source and runtime provenance manifests."""

from __future__ import annotations

import json

from training import provenance


def test_source_manifest_uses_staged_fallback(tmp_path, monkeypatch):
    expected = {
        "commit": "abc123",
        "tree": "def456",
        "dirty": False,
        "dirty_sha256": None,
    }
    (tmp_path / provenance.SOURCE_MANIFEST_FILENAME).write_text(json.dumps(expected))
    monkeypatch.setattr(provenance, "_git_source_manifest", lambda root: None)

    assert provenance.source_manifest(tmp_path) == expected


def test_runtime_manifest_contains_resolved_environment():
    manifest = provenance.runtime_manifest()

    assert manifest["python"]["version"]
    assert manifest["platform"]["system"]
    assert manifest["torch"]["version"]
    assert "numpy" in manifest["dependencies"]
    assert "torch" in manifest["dependencies"]
