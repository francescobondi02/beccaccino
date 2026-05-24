"""Neural networks for Beccaccino PPO agent."""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn

from becca_env.observation import OBS_SIZE

ACTION_SIZE = 160


# ---------- V1 (legacy, kept for loading old checkpoints) ----------


def _make_mlp(in_size: int, hidden: int, n_layers: int) -> nn.Sequential:
    layers = []
    for _ in range(n_layers):
        layers.append(nn.Linear(in_size, hidden))
        layers.append(nn.Tanh())
        in_size = hidden
    return nn.Sequential(*layers)


def _ortho_init(module: nn.Module, gain: float = np.sqrt(2)):
    for m in module.modules():
        if isinstance(m, nn.Linear):
            nn.init.orthogonal_(m.weight, gain=gain)
            nn.init.zeros_(m.bias)


class BeccaNet(nn.Module):
    def __init__(self, hidden_size: int = 256, num_layers: int = 2):
        super().__init__()

        self.policy_net = _make_mlp(OBS_SIZE, hidden_size, num_layers)
        self.policy_head = nn.Linear(hidden_size, ACTION_SIZE)

        self.value_net = _make_mlp(OBS_SIZE, hidden_size, num_layers)
        self.value_head = nn.Linear(hidden_size, 1)

        _ortho_init(self.policy_net)
        _ortho_init(self.value_net)
        nn.init.orthogonal_(self.policy_head.weight, gain=0.01)
        nn.init.zeros_(self.policy_head.bias)
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)
        nn.init.zeros_(self.value_head.bias)

    def forward(self, obs: torch.Tensor, action_mask: torch.Tensor):
        logits = self.policy_head(self.policy_net(obs))
        logits = logits + (1 - action_mask) * (-1e8)
        value = self.value_head(self.value_net(obs)).squeeze(-1)
        return logits, value

    def get_action_and_value(
        self, obs: torch.Tensor, action_mask: torch.Tensor, action: torch.Tensor | None = None
    ):
        logits, value = self.forward(obs, action_mask)
        dist = torch.distributions.Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        return action, dist.log_prob(action), dist.entropy(), value


# ---------- V2 (production architecture) ----------


class ResidualBlock(nn.Module):
    def __init__(self, size: int, use_layer_norm: bool = True):
        super().__init__()
        self.fc = nn.Linear(size, size)
        self.ln = nn.LayerNorm(size) if use_layer_norm else nn.Identity()
        self.act = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.act(self.ln(self.fc(x)))


class BeccaNetV2(nn.Module):
    """Shared trunk + separate policy/value heads with ReLU, LayerNorm, residuals."""

    def __init__(self, hidden_size: int = 512, num_layers: int = 3, use_layer_norm: bool = True):
        super().__init__()

        # Shared trunk: input projection + residual blocks
        trunk_layers: list[nn.Module] = [
            nn.Linear(OBS_SIZE, hidden_size),
            nn.LayerNorm(hidden_size) if use_layer_norm else nn.Identity(),
            nn.ReLU(),
        ]
        for _ in range(num_layers - 1):
            trunk_layers.append(ResidualBlock(hidden_size, use_layer_norm))
        self.trunk = nn.Sequential(*trunk_layers)

        # Policy head
        self.policy_head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, ACTION_SIZE),
        )

        # Value head
        self.value_head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, 1),
        )

        self._init_weights()

    def _init_weights(self):
        for m in self.trunk.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.zeros_(m.bias)
        for m in self.policy_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)
        for m in self.value_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=1.0)
                nn.init.zeros_(m.bias)

    def forward(self, obs: torch.Tensor, action_mask: torch.Tensor):
        h = self.trunk(obs)
        logits = self.policy_head(h)
        logits = logits + (1 - action_mask) * (-1e8)
        value = self.value_head(h).squeeze(-1)
        return logits, value

    def get_action_and_value(
        self, obs: torch.Tensor, action_mask: torch.Tensor, action: torch.Tensor | None = None
    ):
        logits, value = self.forward(obs, action_mask)
        dist = torch.distributions.Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        return action, dist.log_prob(action), dist.entropy(), value


def create_network(version: int = 2, **kwargs) -> BeccaNet | BeccaNetV2:
    if version == 1:
        return BeccaNet(
            hidden_size=kwargs.get("hidden_size", 256),
            num_layers=kwargs.get("num_layers", 2),
        )
    return BeccaNetV2(
        hidden_size=kwargs.get("hidden_size", 512),
        num_layers=kwargs.get("num_layers", 3),
        use_layer_norm=kwargs.get("use_layer_norm", True),
    )
