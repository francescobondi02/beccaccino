"""Export trained PyTorch model to ONNX for fast inference."""

from __future__ import annotations

from pathlib import Path

import torch

from training.checkpoint import build_net, load_checkpoint
from training.network import ACTION_SIZE


def export_to_onnx(
    checkpoint_path: str,
    output_path: str = "serving/model.onnx",
):
    """Export a checkpoint to ONNX format.

    The architecture is rebuilt from the checkpoint's stamped net_config, so any
    network version (incl. V4) exports without a matching CLI flag. The exported
    model takes (obs, action_mask) and returns (logits, value).
    """
    ckpt = load_checkpoint(checkpoint_path)
    net = build_net(ckpt, torch.device("cpu"))
    net.eval()

    dummy_obs = torch.zeros(1, net.obs_size)
    dummy_mask = torch.ones(1, ACTION_SIZE)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        net,
        (dummy_obs, dummy_mask),
        output_path,
        input_names=["obs", "action_mask"],
        output_names=["logits", "value"],
        dynamic_axes={
            "obs": {0: "batch"},
            "action_mask": {0: "batch"},
            "logits": {0: "batch"},
            "value": {0: "batch"},
        },
        opset_version=17,
        # TorchScript exporter: produces a batch-symbolic graph. The torch 2.x
        # dynamo exporter hardcodes the export-time batch for the V4 transformer,
        # breaking inference at batch > 1.
        dynamo=False,
    )
    print(f"Exported to {output_path}")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("checkpoint", help="Path to .pt checkpoint")
    p.add_argument("--output", default="serving/model.onnx")
    a = p.parse_args()

    export_to_onnx(a.checkpoint, a.output)
