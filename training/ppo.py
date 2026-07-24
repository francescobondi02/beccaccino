"""PPO update with standard stabilization techniques.

- Clipped surrogate objective
- Clipped value function
- KL early stopping (halt epochs if policy diverges too much)
- Advantage normalization
"""

from __future__ import annotations

import torch
import torch.nn as nn


def ppo_update(
    net: nn.Module,
    optimizer: torch.optim.Optimizer,
    batch: dict[str, torch.Tensor],
    clip_eps: float = 0.2,
    vf_coef: float = 0.5,
    ent_coef: float = 0.01,
    max_grad_norm: float = 0.5,
    num_epochs: int = 4,
    minibatch_size: int = 256,
    target_kl: float | None = 0.015,
    device: torch.device = torch.device("cpu"),
) -> dict[str, float]:
    """PPO update with KL early stopping and value clipping.

    Args:
        target_kl: if approx KL exceeds this, stop epoch early. None = disabled.
    """
    obs = batch["obs"].to(device)
    masks = batch["masks"].to(device)
    actions = batch["actions"].to(device)
    old_log_probs = batch["log_probs"].to(device)
    old_values = batch["values"].to(device)
    advantages = batch["advantages"].to(device)
    returns = batch["returns"].to(device)

    # Normalize advantages
    advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

    n = obs.shape[0]
    totals = {
        "policy_loss": 0.0, "value_loss": 0.0,
        "entropy": 0.0, "clip_frac": 0.0, "approx_kl": 0.0,
    }
    count = 0
    early_stopped = False

    net.train()
    for epoch in range(num_epochs):
        # KL early-stop must compare THIS epoch's mean divergence to target_kl.
        # A cumulative accumulator dilutes it with epoch-0's near-zero KL, so the
        # brake would almost never engage.
        epoch_kl_sum = 0.0
        epoch_mb_count = 0
        idx = torch.randperm(n, device=device)
        for start in range(0, n, minibatch_size):
            mb = idx[start : start + minibatch_size]

            _, new_lp, ent, new_val = net.get_action_and_value(
                obs[mb], masks[mb], actions[mb]
            )

            # Policy loss (clipped surrogate)
            log_ratio = new_lp - old_log_probs[mb]
            ratio = torch.exp(log_ratio)
            adv = advantages[mb]
            surr1 = ratio * adv
            surr2 = torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * adv
            pi_loss = -torch.min(surr1, surr2).mean()

            # Value loss (clipped)
            v_clipped = old_values[mb] + torch.clamp(
                new_val - old_values[mb], -clip_eps, clip_eps
            )
            v_loss_unclipped = (new_val - returns[mb]).pow(2)
            v_loss_clipped = (v_clipped - returns[mb]).pow(2)
            v_loss = 0.5 * torch.max(v_loss_unclipped, v_loss_clipped).mean()

            # Entropy bonus
            e_loss = -ent.mean()

            loss = pi_loss + vf_coef * v_loss + ent_coef * e_loss
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), max_grad_norm)
            optimizer.step()

            # Metrics
            with torch.no_grad():
                approx_kl = ((ratio - 1) - log_ratio).mean().item()
                cf = ((ratio - 1.0).abs() > clip_eps).float().mean().item()

            totals["policy_loss"] += pi_loss.item()
            totals["value_loss"] += v_loss.item()
            totals["entropy"] += ent.mean().item()
            totals["clip_frac"] += cf
            totals["approx_kl"] += approx_kl
            count += 1
            epoch_kl_sum += approx_kl
            epoch_mb_count += 1

        # KL early stopping: if THIS epoch's mean divergence exceeds target, halt
        # remaining epochs. Cumulative totals are kept for logging only.
        if target_kl is not None and epoch_mb_count > 0:
            if epoch_kl_sum / epoch_mb_count > target_kl:
                early_stopped = True
                break

    metrics = {k: v / max(count, 1) for k, v in totals.items()}
    metrics["epochs_used"] = epoch + 1 if early_stopped else num_epochs
    return metrics
