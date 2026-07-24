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


class CentralizedCritic(nn.Module):
    """Value network over the full state (actor obs + hidden hands) for CTDE.

    A separate MLP with the BeccaNetV2 trunk shape — deliberately NOT the V4
    transformer trunk: reusing the actor trunk would risk leaking hidden-hand
    information into the policy, and the bottleneck is missing *information*, not
    capacity. Train-time only; serving/PIMC never touch it.
    """

    def __init__(self, input_size: int, hidden_size: int = 512, num_layers: int = 3,
                 use_layer_norm: bool = True):
        super().__init__()
        trunk_layers: list[nn.Module] = [
            nn.Linear(input_size, hidden_size),
            nn.LayerNorm(hidden_size) if use_layer_norm else nn.Identity(),
            nn.ReLU(),
        ]
        for _ in range(num_layers - 1):
            trunk_layers.append(ResidualBlock(hidden_size, use_layer_norm))
        self.trunk = nn.Sequential(*trunk_layers)
        self.value_head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, 1),
        )
        for m in self.trunk.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.zeros_(m.bias)
        for m in self.value_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=1.0)
                nn.init.zeros_(m.bias)

    def forward(self, full_state: torch.Tensor) -> torch.Tensor:
        return self.value_head(self.trunk(full_state)).squeeze(-1)


def create_network(version: int = 2, **kwargs) -> BeccaNet | BeccaNetV2:
    if version == 1:
        resolved = {
            "hidden_size": kwargs.get("hidden_size", 256),
            "num_layers": kwargs.get("num_layers", 2),
        }
        net = BeccaNet(**resolved)
    elif version == 3:
        resolved = {
            "hidden_size": kwargs.get("hidden_size", 512),
            "num_layers": kwargs.get("num_layers", 3),
            "use_layer_norm": kwargs.get("use_layer_norm", True),
        }
        net = BeccaNetV3(**resolved)
    elif version == 4:
        resolved = {
            "d_model": kwargs.get("d_model", 128),
            "nhead": kwargs.get("nhead", 4),
            "num_layers": kwargs.get("num_layers", 3),
            "dim_feedforward": kwargs.get("dim_feedforward", 256),
        }
        net = BeccaNetV4(**resolved)
    else:
        resolved = {
            "hidden_size": kwargs.get("hidden_size", 512),
            "num_layers": kwargs.get("num_layers", 3),
            "use_layer_norm": kwargs.get("use_layer_norm", True),
        }
        net = BeccaNetV2(**resolved)
    # Stamp the exact rebuild kwargs so create_network(**net.config) reproduces
    # this architecture bit-for-bit — the single source of truth for checkpoints.
    net.config = {"version": version, **resolved}
    return net


# ---------- V4 (transformer over card tokens + global token) ----------


def _build_static_card_features() -> torch.Tensor:
    """Shape (40, 16): suit one-hot (4) + value one-hot (10) + strength_norm
    (1) + points_norm (1). Constant across all states; registered as a buffer
    on the network so it moves to GPU automatically.
    """
    from becca_env.deck import DECK, Value, card_points, card_strength
    from becca_env.observation import SUIT_INDEX

    feats = torch.zeros(40, 16, dtype=torch.float32)
    values_list = list(Value)
    for i, card in enumerate(DECK):
        feats[i, SUIT_INDEX[card.suit]] = 1.0
        feats[i, 4 + values_list.index(card.value)] = 1.0
        feats[i, 14] = card_strength[card.value] / 10.0
        feats[i, 15] = card_points[card.value] / 3.0
    return feats


class BeccaNetV4(nn.Module):
    """Transformer encoder over 40 card tokens + 1 global context token.

    For Beccaccino specifically:
      - Cards have permutation-invariant set structure (you compare them by
        suit/value, not by position). Attention captures this naturally.
      - Per-card status (mine / partner-played / opp-played / unseen) becomes
        a feature *on the card token*, so the network reasons about each card
        in context of who has played it.
      - The global token aggregates briscola/score/seat info, naturally
        pooled by attention to influence card decisions.

    Action space: same 160-flat as V3, built as outer sum of card_logits[40]
    and signal_logits[4]. Card logits come from per-card tokens → linear; the
    signal head reads the global token output.

    Param count for default (d_model=128, nhead=4, layers=3): ~290k. Scales
    cleanly: bump d_model=256, layers=4 for GPU runs.
    """

    # Sizes derived from the v3 obs layout; if obs layout changes, these
    # offsets must be updated together with becca_env/observation.py.
    OBS_HAND_END = 40
    OBS_STATUS_END = 240    # per-card 40 × 5
    OBS_TRICK_END = 400     # 4 trick positions × 40
    OBS_BRISCOLA_END = 404  # 4
    OBS_GLOBAL_START = 400  # briscola starts here
    OBS_GLOBAL_END = 462    # signal mask ends here (briscola..void..signals)
    GLOBAL_FEAT_DIM = 62    # 400..462 — global context routes to the global token
    PER_CARD_DYNAMIC = 11   # status(5) + on_trick(4) + my_hand(1) + is_briscola(1)
    PER_CARD_STATIC = 16    # suit(4) + value(10) + strength(1) + points(1)

    def __init__(
        self,
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 3,
        dim_feedforward: int = 256,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.d_model = d_model

        # Static per-card features as a buffer (moves with .to(device))
        self.register_buffer("static_card_features", _build_static_card_features())
        self.register_buffer("card_ids", torch.arange(40, dtype=torch.long))

        # Per-card identity embedding (learned)
        self.card_id_embedding = nn.Embedding(40, d_model)

        # Project (static ⊕ dynamic) per-card features to d_model
        self.card_proj = nn.Linear(self.PER_CARD_STATIC + self.PER_CARD_DYNAMIC, d_model)

        # Global feature → d_model
        self.global_proj = nn.Linear(self.GLOBAL_FEAT_DIM, d_model)

        # Transformer encoder (pre-LN, batch_first)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.final_norm = nn.LayerNorm(d_model)

        # Heads
        self.card_logit_head = nn.Linear(d_model, 1)
        self.signal_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2), nn.ReLU(),
            nn.Linear(d_model // 2, 4),
        )
        self.value_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2), nn.ReLU(),
            nn.Linear(d_model // 2, 1),
        )

        self._init_weights()

    def _init_weights(self):
        # Conservative init: small policy heads, standard for trunks.
        for m in [self.card_proj, self.global_proj]:
            nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
            nn.init.zeros_(m.bias)
        for m in self.signal_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)
        nn.init.orthogonal_(self.card_logit_head.weight, gain=0.01)
        nn.init.zeros_(self.card_logit_head.bias)
        for m in self.value_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=1.0)
                nn.init.zeros_(m.bias)
        nn.init.normal_(self.card_id_embedding.weight, std=0.02)

    def _decompose_obs(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """obs (B, 462) -> (per_card_dynamic (B, 40, 11), global_feats (B, 62))."""
        B = obs.shape[0]  # noqa: N806  conventional batch dim name
        my_hand = obs[:, : self.OBS_HAND_END]
        card_status = obs[:, self.OBS_HAND_END : self.OBS_STATUS_END].view(B, 40, 5)
        # (B, 4, 40) → (B, 40, 4) so dim 1 is card index
        trick = obs[:, self.OBS_STATUS_END : self.OBS_TRICK_END].view(B, 4, 40).transpose(1, 2)
        briscola_oh = obs[:, self.OBS_GLOBAL_START : self.OBS_BRISCOLA_END]  # (B, 4)

        # is_briscola[b, c] = sum_s suit_oh[c, s] * briscola_oh[b, s]
        suit_oh = self.static_card_features[:, 0:4]  # (40, 4)
        is_briscola = (suit_oh.unsqueeze(0) * briscola_oh.unsqueeze(1)).sum(dim=-1)  # (B, 40)

        per_card_dynamic = torch.cat(
            [
                card_status,                    # (B, 40, 5)
                trick,                          # (B, 40, 4)
                my_hand.unsqueeze(-1),          # (B, 40, 1)
                is_briscola.unsqueeze(-1),      # (B, 40, 1)
            ],
            dim=-1,
        )  # (B, 40, 11)

        global_feats = obs[:, self.OBS_GLOBAL_START : self.OBS_GLOBAL_END]  # (B, 62)
        return per_card_dynamic, global_feats

    def forward(self, obs: torch.Tensor, action_mask: torch.Tensor):
        B = obs.shape[0]  # noqa: N806  conventional batch dim name
        per_card_dyn, global_feats = self._decompose_obs(obs)

        static = self.static_card_features.unsqueeze(0).expand(B, -1, -1)  # (B, 40, 16)
        per_card_input = torch.cat([static, per_card_dyn], dim=-1)         # (B, 40, 27)
        card_tokens = self.card_proj(per_card_input)                        # (B, 40, d)
        card_ids_emb = self.card_id_embedding(self.card_ids)                # (40, d)
        card_tokens = card_tokens + card_ids_emb.unsqueeze(0)

        global_token = self.global_proj(global_feats).unsqueeze(1)          # (B, 1, d)

        tokens = torch.cat([card_tokens, global_token], dim=1)              # (B, 41, d)
        encoded = self.final_norm(self.transformer(tokens))

        card_encoded = encoded[:, :40]              # (B, 40, d)
        global_encoded = encoded[:, 40]             # (B, d)

        card_logits = self.card_logit_head(card_encoded).squeeze(-1)        # (B, 40)
        signal_logits = self.signal_head(global_encoded)                    # (B, 4)
        value = self.value_head(global_encoded).squeeze(-1)                 # (B,)

        # Outer sum (same flat 160 interface as V3)
        combined = card_logits.unsqueeze(2) + signal_logits.unsqueeze(1)    # (B, 40, 4)
        logits = combined.reshape(B, 160) + (1 - action_mask) * (-1e8)
        return logits, value

    def get_action_and_value(
        self, obs: torch.Tensor, action_mask: torch.Tensor, action: torch.Tensor | None = None
    ):
        logits, value = self.forward(obs, action_mask)
        dist = torch.distributions.Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        return action, dist.log_prob(action), dist.entropy(), value


# ---------- V3 (factorized action head: 40 cards × 4 signals) ----------


CARD_HEAD_SIZE = 40
SIGNAL_HEAD_SIZE = 4  # none, striscio, busso, volo


class BeccaNetV3(nn.Module):
    """Same trunk as V2, but two heads:
        - card_head:   40 logits (which card to play / which suit for briscola)
        - signal_head:  4 logits (none/striscio/busso/volo) — sampled only when
                       leader; for followers we deterministically use index 0.

    The 160-action interface is preserved at the boundary: forward() still
    returns (logits[160], value), built as the *outer sum* of card + signal
    log-probs masked by the legal-action mask. PPO sees the same flat logits
    space as before, but gradients flow into a much smaller, well-conditioned
    parameter space.

    Why outer sum (not concat)?
      log p(card, signal) = log p(card) + log p(signal | leader)
      → joint logits = card_logit[c] + signal_logit[s]   (in pre-mask space)
      Then the action mask zeros out illegal (c, s) combos. For a follower,
      the mask only allows s=0, so signal_logit gradient on s != 0 is zeroed
      automatically.
    """

    def __init__(self, hidden_size: int = 512, num_layers: int = 3, use_layer_norm: bool = True):
        super().__init__()
        trunk_layers: list[nn.Module] = [
            nn.Linear(OBS_SIZE, hidden_size),
            nn.LayerNorm(hidden_size) if use_layer_norm else nn.Identity(),
            nn.ReLU(),
        ]
        for _ in range(num_layers - 1):
            trunk_layers.append(ResidualBlock(hidden_size, use_layer_norm))
        self.trunk = nn.Sequential(*trunk_layers)

        self.card_head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, CARD_HEAD_SIZE),
        )
        self.signal_head = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 4),
            nn.ReLU(),
            nn.Linear(hidden_size // 4, SIGNAL_HEAD_SIZE),
        )
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
        for m in self.card_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)
        for m in self.signal_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=0.01)
                nn.init.zeros_(m.bias)
        for m in self.value_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=1.0)
                nn.init.zeros_(m.bias)

    def forward(self, obs: torch.Tensor, action_mask: torch.Tensor):
        h = self.trunk(obs)
        card_logits = self.card_head(h)         # (B, 40)
        signal_logits = self.signal_head(h)     # (B, 4)

        # Outer sum: combined[b, c*4 + s] = card_logits[b, c] + signal_logits[b, s]
        # (B, 40, 4) → (B, 160)
        combined = card_logits.unsqueeze(2) + signal_logits.unsqueeze(1)
        logits = combined.reshape(combined.size(0), 160)

        # Apply mask
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
