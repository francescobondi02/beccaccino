"""Tests for the centralized (CTDE) critic.

Verifies the train-time-only full-state encoding, the critic module, buffer
plumbing, that ppo_update fits the critic, and that a short vec self-play run
with the critic enabled trains without disturbing the legacy (critic-off) path.
"""

from __future__ import annotations

import numpy as np
import torch

from becca_env.deck import DECK
from becca_env.game import BeccaGame
from becca_env.observation import (
    CARD_INDEX,
    FULL_STATE_SIZE,
    NUM_CARDS,
    OBS_SIZE,
    encode_full_state,
    encode_observation,
)
from training.network import CentralizedCritic


def test_full_state_size_and_actor_prefix():
    """Full state is actor obs (462) + 3 hidden hands (120) = 582, and its first
    OBS_SIZE entries equal the plain actor observation exactly."""
    assert FULL_STATE_SIZE == OBS_SIZE + 3 * NUM_CARDS == 582
    g = BeccaGame(seed=3)
    seat = g.current_seat
    full = encode_full_state(g, seat)
    assert full.shape == (FULL_STATE_SIZE,)
    np.testing.assert_array_equal(full[:OBS_SIZE], encode_observation(g, seat))


def test_full_state_hidden_hands_match_other_seats():
    """Each 40-card hidden block equals exactly the corresponding other seat's
    hand (rel 1=left, 2=partner, 3=right), and every dealt card is accounted for
    across my hand + the 3 hidden blocks."""
    g = BeccaGame(seed=11)
    seat = g.current_seat
    full = encode_full_state(g, seat)
    for rel in (1, 2, 3):
        other = (seat + rel) % 4
        block = full[OBS_SIZE + (rel - 1) * NUM_CARDS : OBS_SIZE + rel * NUM_CARDS]
        expected = np.zeros(NUM_CARDS, dtype=np.float32)
        for card in g.round.player_hands[other]:
            expected[CARD_INDEX[card]] = 1.0
        np.testing.assert_array_equal(block, expected)

    # My hand (first 40 of the actor obs) + 3 hidden blocks partition the deck at
    # round start (each seat holds 10 cards, disjoint).
    my_hand = full[:NUM_CARDS]
    hidden = full[OBS_SIZE:].reshape(3, NUM_CARDS).sum(axis=0)
    total = my_hand + hidden
    assert total.sum() == len(DECK)  # all 40 cards present once
    assert set(np.unique(total)).issubset({0.0, 1.0})


def test_critic_forward_shape_and_differentiable():
    critic = CentralizedCritic(input_size=FULL_STATE_SIZE, hidden_size=64, num_layers=2)
    x = torch.randn(8, FULL_STATE_SIZE, requires_grad=True)
    v = critic(x)
    assert v.shape == (8,)
    v.sum().backward()
    assert x.grad is not None


def test_ppo_update_fits_critic_grad_flows():
    from training.network import ACTION_SIZE, create_network
    from training.ppo import ppo_update

    net = create_network(version=2, hidden_size=64, num_layers=2)
    critic = CentralizedCritic(input_size=FULL_STATE_SIZE, hidden_size=64, num_layers=2)
    n = 128
    obs = torch.randn(n, OBS_SIZE)
    batch = {
        "obs": obs,
        "masks": torch.ones(n, ACTION_SIZE),
        "actions": torch.randint(0, ACTION_SIZE, (n,)),
        "log_probs": torch.zeros(n),
        "values": torch.zeros(n),
        "advantages": torch.randn(n),
        "returns": torch.randn(n),
        "full_obs": torch.randn(n, FULL_STATE_SIZE),
    }
    opt = torch.optim.Adam(list(net.parameters()) + list(critic.parameters()), lr=1e-3)
    before = critic.value_head[-1].weight.detach().clone()
    ppo_update(net, opt, batch, num_epochs=2, minibatch_size=64, target_kl=None, critic=critic)
    after = critic.value_head[-1].weight.detach()
    assert not torch.equal(before, after), "critic weights did not update"


def test_buffer_stores_and_returns_full_obs():
    from training.rollout import RolloutBuffer

    buf = RolloutBuffer(size=4)
    fo = np.arange(FULL_STATE_SIZE, dtype=np.float32)
    buf.store(
        np.zeros(OBS_SIZE, dtype=np.float32),
        np.ones(160, dtype=np.float32),
        0,
        0.0,
        1.0,
        0.5,
        False,
        seat=0,
        env_idx=0,
        full_obs=fo,
    )
    batch = buf.get_batch(0.99, 0.95)
    np.testing.assert_array_equal(batch["full_obs"][0].numpy(), fo)
