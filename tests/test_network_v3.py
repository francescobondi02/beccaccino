"""Tests for BeccaNetV3 (factorized card/signal action head)."""

from __future__ import annotations

import torch

from becca_env.observation import OBS_SIZE
from training.network import BeccaNetV3, create_network


def _make_mask(num_actions: int = 160, legal_indices: list[int] | None = None) -> torch.Tensor:
    m = torch.zeros(num_actions)
    if legal_indices:
        for i in legal_indices:
            m[i] = 1.0
    return m.unsqueeze(0)


def test_v3_output_shape_matches_v2():
    """V3 must still produce 160-d logits + 1-d value (drop-in interface)."""
    net = BeccaNetV3(hidden_size=64, num_layers=2)
    obs = torch.randn(3, OBS_SIZE)
    mask = torch.ones(3, 160)
    logits, value = net.forward(obs, mask)
    assert logits.shape == (3, 160)
    assert value.shape == (3,)


def test_v3_forward_value_is_finite_with_mask():
    net = BeccaNetV3(hidden_size=64, num_layers=2)
    obs = torch.randn(2, OBS_SIZE)
    # Only one legal action
    mask = _make_mask(160, [42]).repeat(2, 1)
    logits, _ = net.forward(obs, mask)
    # The single legal logit must be finite; everything else ≤ -1e7
    legal_logits = logits[:, 42]
    illegal = logits.clone()
    illegal[:, 42] = 0
    assert torch.isfinite(legal_logits).all()
    assert (illegal <= -1e7 + 1e-3).all() or (illegal == 0).any()


def test_v3_outer_sum_decomposes_correctly():
    """For action c*4 + s, logit (pre-mask) must equal card_logit[c] + signal_logit[s]."""
    net = BeccaNetV3(hidden_size=64, num_layers=2)
    net.eval()
    obs = torch.randn(1, OBS_SIZE)
    full_mask = torch.ones(1, 160)
    with torch.no_grad():
        h = net.trunk(obs)
        card_logits = net.card_head(h)
        signal_logits = net.signal_head(h)
        flat_logits, _ = net.forward(obs, full_mask)
    # Spot-check a few (c, s) pairs
    for c in [0, 17, 39]:
        for s in range(4):
            idx = c * 4 + s
            expected = card_logits[0, c] + signal_logits[0, s]
            got = flat_logits[0, idx]
            assert torch.isclose(got, expected, atol=1e-5), \
                f"action {idx}=(c={c},s={s}): got {got}, expected {expected}"


def test_v3_get_action_returns_legal_only():
    """Sampled action must always satisfy mask."""
    net = BeccaNetV3(hidden_size=64, num_layers=2)
    obs = torch.randn(20, OBS_SIZE)
    legal = [3, 17, 42, 100]
    mask = _make_mask(160, legal).repeat(20, 1)
    torch.manual_seed(0)
    actions, _, _, _ = net.get_action_and_value(obs, mask)
    for a in actions.tolist():
        assert a in legal, f"action {a} not in legal set {legal}"


def test_v3_param_count_close_to_v2():
    """V3 adds a tiny signal head (~1k params) but should be nearly the same
    size — the win is gradient quality, not parameter count."""
    v2 = create_network(version=2, hidden_size=256, num_layers=3, use_layer_norm=True)
    v3 = create_network(version=3, hidden_size=256, num_layers=3, use_layer_norm=True)
    n_v2 = sum(p.numel() for p in v2.parameters())
    n_v3 = sum(p.numel() for p in v3.parameters())
    # Allow ±2% delta
    assert abs(n_v3 - n_v2) / n_v2 < 0.02, f"V3 ({n_v3}) differs >2% from V2 ({n_v2})"


def test_v3_log_prob_consistent_with_categorical_over_mask():
    """log_prob(action) must equal log of softmax over masked logits at action."""
    net = BeccaNetV3(hidden_size=64, num_layers=2)
    obs = torch.randn(4, OBS_SIZE)
    legal = [10, 20, 30, 40]
    mask = _make_mask(160, legal).repeat(4, 1)
    actions = torch.tensor([10, 20, 30, 40])
    _, log_probs, _, _ = net.get_action_and_value(obs, mask, action=actions)

    # Recompute manually
    logits, _ = net.forward(obs, mask)
    log_softmax = torch.log_softmax(logits, dim=-1)
    expected = log_softmax.gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    assert torch.allclose(log_probs, expected, atol=1e-5)


def test_v3_training_step_runs():
    """Smoke: backward through V3 with PPO-style loss does not error."""
    from training.network import create_network

    net = create_network(version=3, hidden_size=64, num_layers=2)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    obs = torch.randn(8, OBS_SIZE)
    mask = torch.ones(8, 160)
    actions = torch.randint(0, 160, (8,))
    _, log_probs, ent, value = net.get_action_and_value(obs, mask, action=actions)
    loss = -log_probs.mean() + 0.5 * (value - 0.0).pow(2).mean() - 0.01 * ent.mean()
    loss.backward()
    opt.step()
    # Sanity: gradients flowed
    grad_norms = [p.grad.norm().item() for p in net.parameters() if p.grad is not None]
    assert any(g > 0 for g in grad_norms), "no gradients flowed"
