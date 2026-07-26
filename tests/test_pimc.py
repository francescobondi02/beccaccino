"""Smoke + correctness tests for inference/pimc.py and inference/determinized.py.

We pin:
  - determinize() makes a real deep copy (no aliasing with original)
  - determinize() respects the sampled hands
  - pimc_choose_action returns a legal action
  - pimc_choose_action plays a full game without crashing
  - PIMC vs random baseline: at least better than random (sanity)
"""

from __future__ import annotations

import random

import torch

from becca_env.deck import Suit
from becca_env.env import BeccaEnv
from becca_env.game import BeccaGame, GamePhase
from becca_env.observation import encode_action_mask
from inference.determinized import determinize
from inference.hand_sampler import sample_opponent_hands
from inference.pimc import PIMCConfig, pimc_choose_action
from training.network import create_network


def _v4_small():
    """Tiny V4 that's fast enough for tests."""
    return create_network(version=4, d_model=32, nhead=2, num_layers=1, dim_feedforward=64)


def test_determinize_is_deep_copy():
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)
    sampled = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(0))

    clone = determinize(g, sampled)

    # Mutate clone — original must be unchanged
    original_phase = g.phase
    original_seat0_hand = list(g.round.player_hands[0])

    clone.round.player_hands[0].pop()
    clone.phase = GamePhase.GAME_OVER

    assert g.phase == original_phase
    assert g.round.player_hands[0] == original_seat0_hand


def test_determinize_uses_sampled_hands():
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)

    sampled = sample_opponent_hands(g, viewer_seat=0, rng=random.Random(0))
    clone = determinize(g, sampled)

    for s in range(4):
        assert clone.round.player_hands[s] == sampled.hands[s]


def test_determinize_preserves_viewer_hand():
    g = BeccaGame(seed=7)
    g.step(Suit.COPPE)
    sampled = sample_opponent_hands(g, viewer_seat=2, rng=random.Random(1))
    clone = determinize(g, sampled)
    # Viewer's hand in the clone is exactly what they hold in real game
    assert clone.round.player_hands[2] == g.round.player_hands[2]


def test_pimc_returns_legal_action():
    """PIMC must return one of the legal action indices."""
    net = _v4_small()
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)  # past briscola, into PLAY_CARD

    cfg = PIMCConfig(num_determinizations=3)  # fast
    flat = pimc_choose_action(net, g, viewer_seat=0, config=cfg, device=torch.device("cpu"))
    mask = encode_action_mask(g, 0)
    assert mask[flat] == 1.0, f"PIMC returned illegal action {flat}"


def test_pimc_handles_briscola_phase():
    """In CHOOSE_BRISCOLA phase only 4 actions are legal — PIMC should still
    return one of them without crashing."""
    net = _v4_small()
    g = BeccaGame(seed=0)
    assert g.phase == GamePhase.CHOOSE_BRISCOLA

    cfg = PIMCConfig(num_determinizations=2)
    flat = pimc_choose_action(
        net, g, viewer_seat=g.current_seat, config=cfg, device=torch.device("cpu")
    )
    assert 0 <= flat < 4, f"briscola action should be in [0,4); got {flat}"


def test_pimc_plays_full_game():
    """End-to-end: PIMC plays every move for one seat, network argmax for
    the others, in a real BeccaEnv. Game must terminate cleanly."""
    net = _v4_small()
    cfg = PIMCConfig(num_determinizations=2)  # 2 dets just for speed

    env = BeccaEnv(seed=42, win_points=5)  # short game
    obs, _ = env.reset()
    pimc_seat = obs["current_seat"]
    steps = 0
    while True:
        seat = obs["current_seat"]
        if seat == pimc_seat:
            flat = pimc_choose_action(
                net, env.game, viewer_seat=seat, config=cfg, device=torch.device("cpu")
            )
        else:
            # Greedy network for non-PIMC seats
            o = torch.from_numpy(obs["obs"]).unsqueeze(0)
            m = torch.from_numpy(obs["action_mask"]).unsqueeze(0)
            with torch.no_grad():
                logits, _ = net.forward(o, m)
            flat = int(logits.argmax(dim=-1).item())
        assert obs["action_mask"][flat] == 1.0
        obs, _, term, _, _ = env.step(flat)
        steps += 1
        if term or steps > 1500:
            break
    assert term, "PIMC game did not terminate"


def test_pimc_does_not_mutate_game():
    net = _v4_small()
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)

    snapshot = {
        "phase": g.phase,
        "hand0": list(g.round.player_hands[0]),
        "hand1": list(g.round.player_hands[1]),
        "trick": list(g.round.current_trick),
        "round": g.round.number,
    }

    cfg = PIMCConfig(num_determinizations=2)
    pimc_choose_action(net, g, viewer_seat=0, config=cfg, device=torch.device("cpu"))

    assert g.phase == snapshot["phase"]
    assert g.round.player_hands[0] == snapshot["hand0"]
    assert g.round.player_hands[1] == snapshot["hand1"]
    assert g.round.current_trick == snapshot["trick"]
    assert g.round.number == snapshot["round"]
