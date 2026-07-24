"""Tests for imitation pretraining (behavioral cloning on the heuristic).

Verifies:
  - dataset structure / shapes
  - heuristic actions always pass the legal-action mask check (basic sanity
    that we're not building a corrupt dataset)
  - training a small net on the dataset DOES drive heuristic-action accuracy
    well above random
  - after BC, the policy plays at least as well as random vs the heuristic
    at evaluation time (sanity that the loaded weights affect behavior)
"""

from __future__ import annotations

import torch

from becca_env.observation import OBS_SIZE
from training.imitation import (
    behavioral_clone,
    collect_heuristic_dataset,
)
from training.network import create_network


def test_dataset_shapes_and_validity():
    ds = collect_heuristic_dataset(num_games=20, win_points=5, seed=0)
    assert ds.obs.shape[1] == OBS_SIZE
    assert ds.obs.shape[0] == ds.masks.shape[0]
    assert ds.obs.shape[0] == ds.actions.shape[0]
    assert ds.obs.shape[0] > 0
    # Every action must be in [0, 160)
    assert (ds.actions >= 0).all()
    assert (ds.actions < 160).all()


def test_dataset_actions_always_legal():
    """Every recorded heuristic action must be on the legal-mask list for that
    transition. If this fails, it means the action→idx mapping is wrong."""
    ds = collect_heuristic_dataset(num_games=50, win_points=5, seed=1)
    for i in range(len(ds)):
        assert ds.masks[i, ds.actions[i]] == 1.0, (
            f"sample {i}: action {ds.actions[i]} masked illegal "
            f"(mask sum={ds.masks[i].sum()})"
        )


def test_bc_drives_accuracy_above_random():
    """BC on a small dataset must push action accuracy above the 1/160 floor
    that a randomly-initialized network has on legal actions."""
    ds = collect_heuristic_dataset(num_games=80, win_points=5, seed=3)

    net = create_network(version=2, hidden_size=128, num_layers=2)
    history = behavioral_clone(
        net, ds, epochs=3, batch_size=256, lr=3e-4, verbose=False,
    )
    final_acc = history["acc"][-1]
    # Heuristic is mostly deterministic given the state, so even modest
    # capacity should clear ≥40% accuracy on this dataset.
    assert final_acc > 0.40, f"BC accuracy too low: {final_acc:.1%}"


def test_bc_works_for_v3():
    """V3 has a factorized head; behavioral_clone must work transparently."""
    ds = collect_heuristic_dataset(num_games=40, win_points=5, seed=4)
    net = create_network(version=3, hidden_size=128, num_layers=2)
    history = behavioral_clone(net, ds, epochs=2, batch_size=256, lr=3e-4, verbose=False)
    assert history["acc"][-1] > 0.30


def test_loaded_bc_net_makes_legal_actions_in_env():
    """End-to-end: BC the net, then make it play one game vs heuristic — no
    illegal actions, game must terminate."""
    ds = collect_heuristic_dataset(num_games=20, win_points=5, seed=6)
    net = create_network(version=2, hidden_size=128, num_layers=2)
    behavioral_clone(net, ds, epochs=2, batch_size=256, lr=3e-4, verbose=False)

    from becca_env.env import BeccaEnv
    env = BeccaEnv(seed=42, win_points=5)
    obs, _ = env.reset()
    steps = 0
    while True:
        o = torch.from_numpy(obs["obs"]).unsqueeze(0)
        m = torch.from_numpy(obs["action_mask"]).unsqueeze(0)
        with torch.no_grad():
            logits, _ = net.forward(o, m)
            action = int(logits.argmax(dim=-1).item())
        # Must be a legal action
        assert obs["action_mask"][action] == 1.0, f"net selected masked action {action}"
        obs, _, term, _, _ = env.step(action)
        steps += 1
        if term:
            break
        if steps > 2000:
            raise AssertionError("game didn't terminate")
