"""FastAPI serving endpoint for Beccaccino AI.

Stateless inference: receives game state, returns action.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Becca AI", description="Beccaccino card game AI inference")

_session = None


class GameState(BaseModel):
    """Observation from the backend (pre-encoded OBS_SIZE vector + action mask)."""
    obs: list[float]
    action_mask: list[float]


class ActionResponse(BaseModel):
    action: int
    confidence: float


def _get_session():
    global _session
    if _session is None:
        import onnxruntime as ort
        model_path = Path(__file__).parent / "model.onnx"
        if not model_path.exists():
            raise HTTPException(500, "Model not found. Run export_onnx.py first.")
        _session = ort.InferenceSession(str(model_path))
    return _session


@app.post("/predict", response_model=ActionResponse)
def predict(state: GameState):
    """Given a game observation, return the best action."""
    session = _get_session()

    obs = np.array(state.obs, dtype=np.float32).reshape(1, -1)
    mask = np.array(state.action_mask, dtype=np.float32).reshape(1, -1)

    logits, _ = session.run(None, {"obs": obs, "action_mask": mask})
    logits = logits[0]

    # Greedy action selection
    action = int(np.argmax(logits))
    # Confidence: softmax probability of chosen action (only over legal actions)
    legal_logits = logits[mask[0] > 0]
    exp_logits = np.exp(legal_logits - legal_logits.max())
    probs = exp_logits / exp_logits.sum()
    confidence = float(probs.max())

    return ActionResponse(action=action, confidence=confidence)


@app.get("/health")
def health():
    return {"status": "ok"}
