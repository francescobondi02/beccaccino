"""Tests for the PPO update, focused on the KL early-stopping contract.

The subtle bug these guard against: KL early-stop must compare the CURRENT
epoch's mean divergence to target_kl. An accumulator that spans all epochs is
diluted by epoch-0's near-zero KL, so the brake engages far too late (or never).
"""

from __future__ import annotations

import torch

from becca_env.observation import OBS_SIZE
from training.network import ACTION_SIZE, BeccaNetV2
from training.ppo import ppo_update


def _make_batch(n: int, net: BeccaNetV2, seed: int = 0) -> dict[str, torch.Tensor]:
    """Build a self-consistent PPO batch: old_log_probs/values come from the
    net's own initial forward pass, so the first epoch's KL starts near zero and
    grows as the policy is updated — the regime where the dilution bug hides."""
    torch.manual_seed(seed)
    obs = torch.randn(n, OBS_SIZE)
    masks = torch.ones(n, ACTION_SIZE)
    with torch.no_grad():
        actions, log_probs, _, values = net.get_action_and_value(obs, masks)
    return {
        "obs": obs,
        "masks": masks,
        "actions": actions,
        "log_probs": log_probs,
        "values": values,
        "advantages": torch.randn(n),
        "returns": torch.randn(n),
    }


def test_kl_early_stop_engages_before_cumulative_average_would():
    """With per-epoch reset the brake fires while the CUMULATIVE KL is still
    below target — the exact scenario where the old cross-epoch accumulator
    would have kept training. epochs_used < num_epochs AND cumulative
    approx_kl <= target_kl is impossible under the old (diluted) logic.
    """
    torch.manual_seed(1)
    net = BeccaNetV2(hidden_size=64, num_layers=2)
    batch = _make_batch(512, net, seed=1)

    # LR tuned so per-epoch KL grows gradually and crosses target_kl mid-run
    # while the cumulative average is still well below it.
    optimizer = torch.optim.Adam(net.parameters(), lr=0.01)
    num_epochs = 10
    target_kl = 0.015

    metrics = ppo_update(
        net, optimizer, batch,
        ent_coef=0.0, num_epochs=num_epochs, minibatch_size=512, target_kl=target_kl,
    )

    assert metrics["epochs_used"] < num_epochs, "early stop never engaged"
    assert metrics["approx_kl"] <= target_kl, (
        "cumulative KL is below target yet the brake fired — proving the "
        "per-epoch reset is what engaged it (the old cross-epoch average would not)"
    )


def test_kl_early_stop_disabled_runs_all_epochs():
    """target_kl=None must run the full epoch budget."""
    torch.manual_seed(2)
    net = BeccaNetV2(hidden_size=64, num_layers=2)
    batch = _make_batch(512, net, seed=2)
    optimizer = torch.optim.Adam(net.parameters(), lr=0.05)

    metrics = ppo_update(
        net, optimizer, batch,
        ent_coef=0.0, num_epochs=5, minibatch_size=512, target_kl=None,
    )
    assert metrics["epochs_used"] == 5
