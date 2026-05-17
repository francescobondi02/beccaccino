"""Neural network architecture for Beccaccino PPO agent.

Dual-head network: shared backbone → policy head (action logits) + value head (scalar).
Input: 344-dim observation vector.
Output: 160 action logits + 1 value estimate.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from becca_env.observation import OBS_SIZE

ACTION_SIZE = 160


class BeccaNet(nn.Module):
    def __init__(self, hidden_size: int = 256, num_layers: int = 3):
        super().__init__()

        layers = []
        in_size = OBS_SIZE
        for _ in range(num_layers):
            layers.append(nn.Linear(in_size, hidden_size))
            layers.append(nn.ReLU())
            in_size = hidden_size

        self.backbone = nn.Sequential(*layers)
        self.policy_head = nn.Linear(hidden_size, ACTION_SIZE)
        self.value_head = nn.Linear(hidden_size, 1)

    def forward(self, obs: torch.Tensor, action_mask: torch.Tensor):
        """Forward pass.

        Args:
            obs: (batch, OBS_SIZE) float tensor
            action_mask: (batch, ACTION_SIZE) binary tensor (1=legal, 0=illegal)

        Returns:
            logits: (batch, ACTION_SIZE) masked logits (illegal actions = -inf)
            value: (batch,) scalar value estimates
        """
        features = self.backbone(obs)
        logits = self.policy_head(features)

        # Mask illegal actions with -inf so softmax gives them 0 probability
        logits = logits + (1 - action_mask) * (-1e8)

        value = self.value_head(features).squeeze(-1)
        return logits, value

    def get_action_and_value(
        self, obs: torch.Tensor, action_mask: torch.Tensor, action: torch.Tensor | None = None
    ):
        """Sample or evaluate an action.

        If action is None, sample from the policy.
        If action is provided, compute log_prob and entropy for that action.
        """
        logits, value = self.forward(obs, action_mask)
        dist = torch.distributions.Categorical(logits=logits)

        if action is None:
            action = dist.sample()

        log_prob = dist.log_prob(action)
        entropy = dist.entropy()

        return action, log_prob, entropy, value
