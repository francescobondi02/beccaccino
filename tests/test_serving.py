"""Tests for serving input validation.

Malformed requests across the service boundary must return a clear 4xx, not a
cryptic 500. We stub the ONNX session so these test only the validation logic,
which for width/mask errors runs before the model is invoked.
"""

from __future__ import annotations

import numpy as np
import pytest

# Serving deps (fastapi) live in the [serve] extra, not [dev]. Skip cleanly when
# they aren't installed so the core suite stays runnable without them.
pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from becca_env.observation import OBS_SIZE  # noqa: E402
from serving import app as app_module  # noqa: E402
from training.network import ACTION_SIZE  # noqa: E402


class _StubSession:
    """Mimics the exported net: applies the mask to logits (illegal -> -1e8) so
    the valid-request path selects a legal action, as the real ONNX graph does."""

    def run(self, _outputs, inputs):
        mask = inputs["action_mask"]
        logits = np.zeros((1, ACTION_SIZE), dtype=np.float32) + (1 - mask) * (-1e8)
        value = np.zeros((1,), dtype=np.float32)
        return [logits, value]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "_get_session", lambda: _StubSession())
    return TestClient(app_module.app)


def test_wrong_obs_width_returns_422(client):
    resp = client.post(
        "/predict",
        json={
            "obs": [0.0] * (OBS_SIZE - 1),
            "action_mask": [1.0] * ACTION_SIZE,
        },
    )
    assert resp.status_code == 422


def test_wrong_mask_width_returns_422(client):
    resp = client.post(
        "/predict",
        json={
            "obs": [0.0] * OBS_SIZE,
            "action_mask": [1.0] * (ACTION_SIZE - 5),
        },
    )
    assert resp.status_code == 422


def test_empty_legal_mask_returns_422_not_500(client):
    resp = client.post(
        "/predict",
        json={
            "obs": [0.0] * OBS_SIZE,
            "action_mask": [0.0] * ACTION_SIZE,  # no legal actions
        },
    )
    assert resp.status_code == 422


def test_valid_request_reaches_200(client):
    mask = [0.0] * ACTION_SIZE
    mask[17] = 1.0
    resp = client.post("/predict", json={"obs": [0.0] * OBS_SIZE, "action_mask": mask})
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] == 17
    assert 0.0 <= body["confidence"] <= 1.0
