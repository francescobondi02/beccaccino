"""Test ONNX export of the V4 transformer, including batch>1 correctness.

Guards two defects: export must (1) rebuild ANY architecture from the checkpoint
(V4 could not be exported via the old CLI-default path) and (2) stay
batch-symbolic — the torch dynamo exporter hardcodes the export-time batch for
the transformer, breaking inference at batch>1.
"""

from __future__ import annotations

import numpy as np
import onnxruntime as ort
import torch

from becca_env.observation import OBS_SIZE
from serving.export_onnx import export_to_onnx
from training.checkpoint import save_checkpoint
from training.network import ACTION_SIZE, create_network


def test_v4_exports_and_runs_at_batch_gt_one(tmp_path):
    torch.manual_seed(0)
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2, dim_feedforward=128)
    net.eval()
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)

    ckpt_path = tmp_path / "v4.pt"
    save_checkpoint(ckpt_path, net=net, optimizer=opt, config={"x": 1}, step=0, update=0)

    onnx_path = tmp_path / "model.onnx"
    export_to_onnx(str(ckpt_path), str(onnx_path))
    assert onnx_path.exists()

    # Run the exported graph at batch 4 (the dynamo-broken case) and compare eager.
    batch = 4
    obs = torch.randn(batch, OBS_SIZE)
    mask = torch.ones(batch, ACTION_SIZE)
    with torch.no_grad():
        eager_logits, eager_value = net.forward(obs, mask)

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ort_logits, ort_value = sess.run(
        ["logits", "value"],
        {"obs": obs.numpy().astype(np.float32), "action_mask": mask.numpy().astype(np.float32)},
    )

    np.testing.assert_allclose(ort_logits, eager_logits.numpy(), atol=1e-4)
    np.testing.assert_allclose(ort_value, eager_value.numpy(), atol=1e-4)
