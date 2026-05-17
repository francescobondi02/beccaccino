"""PPO (Proximal Policy Optimization) training loop for Beccaccino self-play."""

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
    device: torch.device = torch.device("cpu"),
) -> dict[str, float]:
    """Run PPO update on a batch of transitions.

    Returns dict of training metrics (losses, entropy, clip fraction).
    """
    obs = batch["obs"].to(device)
    masks = batch["action_masks"].to(device)
    actions = batch["actions"].to(device)
    old_log_probs = batch["old_log_probs"].to(device)
    advantages = batch["advantages"].to(device)
    returns = batch["returns"].to(device)

    # Normalize advantages
    advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

    n = obs.shape[0]
    metrics = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "clip_fraction": 0.0}
    num_updates = 0

    net.train()
    for _ in range(num_epochs):
        indices = torch.randperm(n, device=device)

        for start in range(0, n, minibatch_size):
            end = min(start + minibatch_size, n)
            mb_idx = indices[start:end]

            mb_obs = obs[mb_idx]
            mb_masks = masks[mb_idx]
            mb_actions = actions[mb_idx]
            mb_old_lp = old_log_probs[mb_idx]
            mb_adv = advantages[mb_idx]
            mb_ret = returns[mb_idx]

            _, new_log_prob, entropy, new_value = net.get_action_and_value(
                mb_obs, mb_masks, mb_actions
            )

            # Policy loss (clipped surrogate)
            ratio = torch.exp(new_log_prob - mb_old_lp)
            surr1 = ratio * mb_adv
            surr2 = torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * mb_adv
            policy_loss = -torch.min(surr1, surr2).mean()

            # Value loss (clipped)
            value_loss = 0.5 * (new_value - mb_ret).pow(2).mean()

            # Entropy bonus
            entropy_loss = -entropy.mean()

            loss = policy_loss + vf_coef * value_loss + ent_coef * entropy_loss

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), max_grad_norm)
            optimizer.step()

            # Track metrics
            with torch.no_grad():
                clip_frac = ((ratio - 1.0).abs() > clip_eps).float().mean().item()

            metrics["policy_loss"] += policy_loss.item()
            metrics["value_loss"] += value_loss.item()
            metrics["entropy"] += entropy.mean().item()
            metrics["clip_fraction"] += clip_frac
            num_updates += 1

    # Average metrics
    for k in metrics:
        metrics[k] /= max(num_updates, 1)

    return metrics
