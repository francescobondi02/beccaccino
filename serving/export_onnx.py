"""Export trained PyTorch model to ONNX for fast inference."""

from __future__ import annotations

from pathlib import Path

import torch

from becca_env.observation import OBS_SIZE
from training.network import ACTION_SIZE, create_network


def export_to_onnx(
    checkpoint_path: str,
    output_path: str = "serving/model.onnx",
    network_version: int = 2,
    hidden_size: int = 512,
    num_layers: int = 3,
):
    """Export a checkpoint to ONNX format.

    The exported model takes (obs, action_mask) and returns (logits, value).
    """
    net = create_network(version=network_version, hidden_size=hidden_size, num_layers=num_layers)
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    net.load_state_dict(ckpt["model"])
    net.eval()

    dummy_obs = torch.zeros(1, OBS_SIZE)
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
    )
    print(f"Exported to {output_path}")


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("checkpoint", help="Path to .pt checkpoint")
    p.add_argument("--output", default="serving/model.onnx")
    p.add_argument("--network-version", type=int, default=2)
    p.add_argument("--hidden", type=int, default=512)
    p.add_argument("--layers", type=int, default=3)
    a = p.parse_args()

    export_to_onnx(a.checkpoint, a.output, a.network_version, a.hidden, a.layers)
