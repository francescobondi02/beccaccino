"""Tests for BeccaNetV4 (transformer card encoder).

V4 is the most complex network in the codebase. We pin:
  - shape correctness (drop-in compatibility with PPO pipeline)
  - that the obs decomposition reads the right slices of the observation vector
    (via reconstructing static card features from a fresh build)
  - mask correctness (illegal actions blocked)
  - log_prob math agrees with Categorical over masked logits
  - one BC training step on the real heuristic dataset works (catches any
    shape errors that only fire under realistic data)
  - param count is in a reasonable range for the transformer hyperparams
"""

from __future__ import annotations

import torch

from becca_env.observation import OBS_SIZE
from training.network import BeccaNetV4, _build_static_card_features, create_network


def test_static_features_shape_and_values():
    """Static per-card features must be (40, 16) and consistent."""
    feats = _build_static_card_features()
    assert feats.shape == (40, 16)
    # Each card has exactly one suit (4) and one value (10) → row sums in
    # those slices = 1 + 1 = 2, plus strength + points
    suit_block = feats[:, 0:4]
    value_block = feats[:, 4:14]
    assert torch.all(suit_block.sum(dim=1) == 1.0)
    assert torch.all(value_block.sum(dim=1) == 1.0)
    # Strength normalized into [0.1, 1.0] (1..10 / 10)
    assert feats[:, 14].min() >= 0.1 - 1e-6
    assert feats[:, 14].max() <= 1.0 + 1e-6


def test_v4_forward_shape():
    net = BeccaNetV4(d_model=64, nhead=4, num_layers=2, dim_feedforward=128)
    obs = torch.randn(3, OBS_SIZE)
    mask = torch.ones(3, 160)
    logits, value = net.forward(obs, mask)
    assert logits.shape == (3, 160)
    assert value.shape == (3,)


def test_v4_global_projection_includes_current_round_features():
    net = BeccaNetV4(d_model=32, nhead=2, num_layers=1, dim_feedforward=32)
    assert net.global_proj.in_features == OBS_SIZE - 400


def test_v4_mask_blocks_illegal_actions():
    net = BeccaNetV4(d_model=64, nhead=2, num_layers=2, dim_feedforward=64)
    obs = torch.randn(2, OBS_SIZE)
    mask = torch.zeros(2, 160)
    mask[:, 17] = 1.0
    logits, _ = net.forward(obs, mask)
    # All except action 17 must be ≤ -1e7
    illegal = torch.cat([logits[:, :17], logits[:, 18:]], dim=1)
    assert (illegal <= -1e7 + 1).all()
    assert torch.isfinite(logits[:, 17]).all()


def test_v4_card_conditioned_signal_decomposition():
    net = BeccaNetV4(d_model=64, nhead=2, num_layers=2, dim_feedforward=64)
    net.eval()
    obs = torch.randn(1, OBS_SIZE)
    mask = torch.ones(1, 160)
    with torch.no_grad():
        # Recompute card_logits + signal_logits manually
        per_card_dyn, global_feats = net._decompose_obs(obs)
        static = net.static_card_features.unsqueeze(0)
        per_card_input = torch.cat([static, per_card_dyn], dim=-1)
        ids_emb = net.card_id_embedding(net.card_ids).unsqueeze(0)
        card_tokens = net.card_proj(per_card_input) + ids_emb
        global_token = net.global_proj(global_feats).unsqueeze(1)
        tokens = torch.cat([card_tokens, global_token], dim=1)
        enc = net.final_norm(net.transformer(tokens))
        manual_card = net.card_logit_head(enc[:, :40]).squeeze(-1)
        manual_deltas = net.signal_delta_head(enc[:, :40])

        flat, _ = net.forward(obs, mask)
    for c in [0, 17, 39]:
        for s in range(4):
            expected = manual_card[0, c]
            if s > 0:
                expected = expected + manual_deltas[0, c, s - 1]
            got = flat[0, c * 4 + s]
            assert torch.isclose(got, expected, atol=1e-4), (
                f"action ({c},{s}): {got} vs expected {expected}"
            )
    assert not torch.allclose(manual_deltas[0, 0], manual_deltas[0, 17])


def test_v4_legacy_global_signal_head_is_still_rebuildable():
    net = BeccaNetV4(
        d_model=64,
        nhead=2,
        num_layers=2,
        dim_feedforward=64,
        card_conditioned_signals=False,
    )
    obs = torch.randn(1, OBS_SIZE)
    mask = torch.ones(1, 160)
    flat, _ = net.forward(obs, mask)
    reshaped = flat.view(1, 40, 4)
    signal_preferences = reshaped - reshaped[:, :, :1]
    torch.testing.assert_close(
        signal_preferences[:, 0],
        signal_preferences[:, 17],
    )


def test_v4_briscola_choice_trains_card_conditioned_signal_deltas():
    net = BeccaNetV4(d_model=32, nhead=2, num_layers=1, dim_feedforward=32)
    obs = torch.randn(2, OBS_SIZE)
    mask = torch.zeros(2, 160)
    mask[:, :4] = 1.0
    actions = torch.tensor([1, 3])

    _, log_probs, _, _ = net.get_action_and_value(obs, mask, action=actions)
    (-log_probs.mean()).backward()

    grads = [p.grad for p in net.signal_delta_head.parameters()]
    assert any(grad is not None and torch.count_nonzero(grad) > 0 for grad in grads)


def test_v4_log_prob_consistency():
    net = BeccaNetV4(d_model=32, nhead=2, num_layers=2, dim_feedforward=64)
    obs = torch.randn(4, OBS_SIZE)
    mask = torch.zeros(4, 160)
    legal = [10, 20, 30, 40]
    for i in legal:
        mask[:, i] = 1.0
    actions = torch.tensor([10, 20, 30, 40])
    _, log_probs, _, _ = net.get_action_and_value(obs, mask, action=actions)
    logits, _ = net.forward(obs, mask)
    expected = torch.log_softmax(logits, dim=-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    assert torch.allclose(log_probs, expected, atol=1e-5)


def test_v4_obs_decomposition_with_real_obs():
    """Decompose a real observation produced by encode_observation, check
    that the trick block dimension transposition is correct (cards on
    table show up in per-card features at the right indices)."""
    from becca_env.deck import Card, Suit, Value
    from becca_env.game import BeccaGame, GamePhase
    from becca_env.observation import CARD_INDEX, encode_observation
    from training.network import BeccaNetV4

    g = BeccaGame(seed=0)
    g.round.briscola = Suit.DENARA
    g.phase = GamePhase.PLAY_CARD
    led_card = Card(Suit.SPADE, Value.RE)
    g.round.current_trick = [(0, led_card)]

    obs = torch.from_numpy(encode_observation(g, seat=1)).unsqueeze(0)
    net = BeccaNetV4(d_model=32, nhead=2, num_layers=1, dim_feedforward=32)
    per_card_dyn, _ = net._decompose_obs(obs)
    # status(5) + trick(4) + my_hand(1) + is_briscola(1) = 11
    assert per_card_dyn.shape == (1, 40, 11)
    # The led card should have its trick-position-0 slot set to 1.
    led_idx = CARD_INDEX[led_card]
    trick_block = per_card_dyn[0, led_idx, 5:9]
    assert trick_block[0] == 1.0, f"expected trick pos 0 set; got {trick_block.tolist()}"
    assert trick_block[1:].sum() == 0.0


def test_v4_param_count_is_reasonable():
    """Default V4 should be small enough for CPU iteration but big enough
    to learn meaningful patterns. Target: 200k-500k params."""
    net = create_network(version=4)
    n = sum(p.numel() for p in net.parameters())
    assert 100_000 < n < 1_000_000, f"V4 param count out of range: {n:,}"


def test_v4_training_step_runs():
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    obs = torch.randn(8, OBS_SIZE)
    mask = torch.ones(8, 160)
    actions = torch.randint(0, 160, (8,))
    _, log_probs, ent, value = net.get_action_and_value(obs, mask, action=actions)
    loss = -log_probs.mean() + 0.5 * value.pow(2).mean() - 0.01 * ent.mean()
    loss.backward()
    opt.step()
    grad_norms = [p.grad.norm().item() for p in net.parameters() if p.grad is not None]
    assert any(g > 0 for g in grad_norms)


def test_v4_bc_works():
    """End-to-end: collect a small heuristic dataset, BC-train V4, check that
    accuracy rises above the random-action baseline."""
    from training.imitation import behavioral_clone, collect_heuristic_dataset

    ds = collect_heuristic_dataset(num_games=80, win_points=5, seed=0)
    net = create_network(version=4, d_model=64, nhead=4, num_layers=2)
    history = behavioral_clone(net, ds, epochs=2, batch_size=256, lr=3e-4, verbose=False)
    assert history["acc"][-1] > 0.30, f"V4 BC accuracy too low: {history['acc'][-1]:.1%}"


def test_v4_plays_legal_actions_in_real_env():
    """Smoke: V4 + real env loop without illegal actions / crashes."""
    from becca_env.env import BeccaEnv

    net = create_network(version=4, d_model=64, nhead=4, num_layers=2)
    env = BeccaEnv(seed=42, win_points=5)
    obs, _ = env.reset()
    steps = 0
    while True:
        o = torch.from_numpy(obs["obs"]).unsqueeze(0)
        m = torch.from_numpy(obs["action_mask"]).unsqueeze(0)
        with torch.no_grad():
            logits, _ = net.forward(o, m)
            action = int(logits.argmax(dim=-1).item())
        assert obs["action_mask"][action] == 1.0
        obs, _, term, _, _ = env.step(action)
        steps += 1
        if term or steps > 1000:
            break
    assert term, "game didn't terminate"
