"""Tests for PPO update direction and stabilization.

The loss-direction tests use tiny fixed modules so failures point to PPO math,
not production-network initialization.
"""

from __future__ import annotations

import pytest
import torch
import torch.nn as nn

from becca_env.observation import OBS_SIZE
from training.network import ACTION_SIZE, BeccaNetV2
from training.ppo import ppo_update


class _TinyActorCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.policy_logits = nn.Parameter(torch.zeros(2))
        self.value = nn.Parameter(torch.tensor(0.0))

    def get_action_and_value(
        self,
        obs: torch.Tensor,
        action_mask: torch.Tensor,
        action: torch.Tensor | None = None,
    ):
        logits = self.policy_logits.expand(obs.shape[0], -1)
        logits = logits + (1 - action_mask) * -1e8
        dist = torch.distributions.Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        return action, dist.log_prob(action), dist.entropy(), self.value.expand(obs.shape[0])


class _TinyCentralizedCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.value = nn.Parameter(torch.tensor(0.0))

    def forward(self, full_obs: torch.Tensor) -> torch.Tensor:
        return self.value.expand(full_obs.shape[0])


def _make_tiny_batch(
    net: _TinyActorCritic,
    advantages: torch.Tensor,
    returns: torch.Tensor,
    critic: _TinyCentralizedCritic | None = None,
) -> dict[str, torch.Tensor]:
    n = advantages.shape[0]
    obs = torch.zeros(n, 1)
    masks = torch.ones(n, 2)
    actions = torch.arange(n) % 2
    full_obs = torch.zeros(n, 1)
    with torch.no_grad():
        _, log_probs, _, actor_values = net.get_action_and_value(obs, masks, actions)
        values = critic(full_obs) if critic is not None else actor_values
    batch = {
        "obs": obs,
        "masks": masks,
        "actions": actions,
        "log_probs": log_probs.clone(),
        "values": values.clone(),
        "advantages": advantages,
        "returns": returns,
    }
    if critic is not None:
        batch["full_obs"] = full_obs
    return batch


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


def test_policy_moves_taken_actions_in_advantage_direction():
    net = _TinyActorCritic()
    batch = _make_tiny_batch(
        net,
        advantages=torch.tensor([1.0, -1.0]),
        returns=torch.zeros(2),
    )
    before = batch["log_probs"].clone()
    optimizer = torch.optim.SGD(net.parameters(), lr=0.5)

    ppo_update(
        net,
        optimizer,
        batch,
        vf_coef=0.0,
        ent_coef=0.0,
        max_grad_norm=10.0,
        num_epochs=1,
        minibatch_size=2,
        target_kl=None,
    )

    with torch.no_grad():
        _, after, _, _ = net.get_action_and_value(batch["obs"], batch["masks"], batch["actions"])
    assert after[0] > before[0]
    assert after[1] < before[1]


@pytest.mark.parametrize("use_critic", [False, True], ids=["actor-value", "centralized-critic"])
def test_value_prediction_moves_toward_returns(use_critic: bool):
    net = _TinyActorCritic()
    critic = _TinyCentralizedCritic() if use_critic else None
    batch = _make_tiny_batch(
        net,
        advantages=torch.zeros(4),
        returns=torch.ones(4),
        critic=critic,
    )
    params = list(net.parameters()) + (list(critic.parameters()) if critic is not None else [])
    optimizer = torch.optim.SGD(params, lr=0.2)
    value = critic.value if critic is not None else net.value
    before_error = (value.detach() - 1.0).square()

    for _ in range(5):
        ppo_update(
            net,
            optimizer,
            batch,
            clip_eps=10.0,
            vf_coef=1.0,
            ent_coef=0.0,
            max_grad_norm=10.0,
            num_epochs=1,
            minibatch_size=4,
            target_kl=None,
            critic=critic,
        )

    after_error = (value.detach() - 1.0).square()
    assert after_error < before_error


def test_tiny_target_kl_stops_before_epoch_budget():
    net = _TinyActorCritic()
    batch = _make_tiny_batch(
        net,
        advantages=torch.tensor([1.0, -1.0]),
        returns=torch.zeros(2),
    )
    optimizer = torch.optim.SGD(net.parameters(), lr=1.0)

    metrics = ppo_update(
        net,
        optimizer,
        batch,
        vf_coef=0.0,
        ent_coef=0.0,
        max_grad_norm=10.0,
        num_epochs=8,
        minibatch_size=2,
        target_kl=1e-8,
    )

    assert metrics["epochs_used"] < 8


def test_combined_policy_and_critic_gradients_are_clipped_before_step():
    net = _TinyActorCritic()
    critic = _TinyCentralizedCritic()
    batch = _make_tiny_batch(
        net,
        advantages=torch.zeros(4),
        returns=torch.full((4,), 1e6),
        critic=critic,
    )
    params = list(net.parameters()) + list(critic.parameters())
    optimizer = torch.optim.SGD(params, lr=0.01)
    max_grad_norm = 0.05
    raw_critic_grad_norms: list[float] = []
    step_grad_norms: list[float] = []
    hook = critic.value.register_hook(lambda grad: raw_critic_grad_norms.append(grad.norm().item()))
    original_step = optimizer.step

    def inspect_gradients_then_step():
        grad_norms = [param.grad.norm() for param in params if param.grad is not None]
        step_grad_norms.append(torch.stack(grad_norms).norm().item())
        return original_step()

    optimizer.step = inspect_gradients_then_step
    ppo_update(
        net,
        optimizer,
        batch,
        vf_coef=1.0,
        ent_coef=0.0,
        max_grad_norm=max_grad_norm,
        num_epochs=1,
        minibatch_size=4,
        target_kl=None,
        critic=critic,
    )
    hook.remove()

    assert raw_critic_grad_norms[0] > max_grad_norm * 100
    assert step_grad_norms[0] <= max_grad_norm + 1e-6


def test_kl_early_stop_engages_before_cumulative_average_would():
    """With per-epoch reset the brake fires while the CUMULATIVE KL is still
    below target — the exact scenario where the old cross-epoch accumulator
    would have kept training. epochs_used < num_epochs AND cumulative
    approx_kl <= target_kl is impossible under the old (diluted) logic.

    Rather than hand-tune a single LR (fragile — the discriminating window
    shifts with obs dims / net size), we sweep a small LR grid and require that
    at least one lands in the discriminating regime. Some LR always produces the
    gradual per-epoch KL growth that separates the two logics.
    """
    num_epochs = 10
    target_kl = 0.015
    discriminated = False
    for lr in (0.006, 0.008, 0.01, 0.012, 0.015):
        torch.manual_seed(1)
        net = BeccaNetV2(hidden_size=64, num_layers=2)
        batch = _make_batch(512, net, seed=1)
        optimizer = torch.optim.Adam(net.parameters(), lr=lr)
        metrics = ppo_update(
            net,
            optimizer,
            batch,
            ent_coef=0.0,
            num_epochs=num_epochs,
            minibatch_size=512,
            target_kl=target_kl,
        )
        # Discriminating iff the brake fired (epochs_used < num_epochs) while the
        # cumulative KL is still <= target — the old cumulative logic could never
        # early-stop in that state (it stops only once the cumulative mean itself
        # exceeds target).
        if metrics["epochs_used"] < num_epochs and metrics["approx_kl"] <= target_kl:
            discriminated = True
            break
    assert discriminated, "no LR produced the per-epoch-vs-cumulative discriminating regime"


def test_kl_early_stop_disabled_runs_all_epochs():
    """target_kl=None must run the full epoch budget."""
    torch.manual_seed(2)
    net = BeccaNetV2(hidden_size=64, num_layers=2)
    batch = _make_batch(512, net, seed=2)
    optimizer = torch.optim.Adam(net.parameters(), lr=0.05)

    metrics = ppo_update(
        net,
        optimizer,
        batch,
        ent_coef=0.0,
        num_epochs=5,
        minibatch_size=512,
        target_kl=None,
    )
    assert metrics["epochs_used"] == 5
