"""Tests for the model-only artifact shipped with the inference service."""

from __future__ import annotations

from pathlib import Path

import pytest
import torch

from serving.artifact import (
    INFERENCE_ARTIFACT_KEYS,
    InferenceArtifactError,
    export_inference_artifact,
    load_inference_artifact,
)
from training.checkpoint import build_net, save_checkpoint
from training.network import create_network

DEPLOYED_ARTIFACT = (
    Path(__file__).resolve().parent.parent / "serving" / "models" / "run_d2_champion.pt"
)
RUN_D2_SOURCE_SHA256 = "2d281bf0d1150c7629c33360c840b5c3e051599c2a977801a29d8eac79407775"


def _state_dicts_equal(left: dict, right: dict) -> bool:
    return left.keys() == right.keys() and all(torch.equal(left[key], right[key]) for key in left)


def test_export_strips_training_state_and_preserves_weights(tmp_path):
    net = create_network(version=2, hidden_size=64, num_layers=2)
    optimizer = torch.optim.Adam(net.parameters())
    source = tmp_path / "source.pt"
    save_checkpoint(
        source,
        net=net,
        optimizer=optimizer,
        config={},
        step=123,
        update=7,
        extra={"environment_step": 456, "run_id": "test-run"},
    )

    destination = tmp_path / "model.pt"
    export_inference_artifact(
        source,
        destination,
        selection_protocol="test-selection",
    )
    artifact = load_inference_artifact(destination)

    assert frozenset(artifact) == INFERENCE_ARTIFACT_KEYS
    assert artifact["source"]["run_id"] == "test-run"
    assert artifact["source"]["update"] == 7
    assert artifact["source"]["environment_step"] == 456
    assert artifact["source"]["selection_protocol"] == "test-selection"
    assert _state_dicts_equal(net.state_dict(), build_net(artifact, "cpu").state_dict())


def test_load_rejects_tampered_artifact(tmp_path):
    path = tmp_path / "model.pt"
    path.write_bytes(b"model")
    (tmp_path / "model.pt.sha256").write_text("0" * 64 + "\n")

    with pytest.raises(InferenceArtifactError, match="hash mismatch"):
        load_inference_artifact(path)


def test_load_requires_checksum(tmp_path):
    path = tmp_path / "model.pt"
    torch.save({}, path)

    with pytest.raises(InferenceArtifactError, match="cannot read inference artifact hash"):
        load_inference_artifact(path)


def test_committed_artifact_is_the_promoted_run_d2_champion():
    artifact = load_inference_artifact(DEPLOYED_ARTIFACT)

    assert artifact["source"] == {
        "checkpoint_sha256": RUN_D2_SOURCE_SHA256,
        "environment_step": 39_321_600,
        "run_id": "runD2",
        "selection_protocol": "runD2-winner-vs-runC-20260825",
        "update": 1200,
    }
    net = build_net(artifact, torch.device("cpu"))
    assert sum(parameter.numel() for parameter in net.parameters()) == 1_262_021
