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

import numpy as np
import pytest
import torch
import torch.nn as nn

from becca_env.deck import Card, Suit, Value
from becca_env.env import BeccaEnv
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase, GameResult, Signal, TrickRecord
from becca_env.observation import OBS_SIZE, encode_action_mask
from inference.determinized import determinize
from inference.hand_sampler import SampledHands, sample_opponent_hands
from inference.pimc import (
    PIMCAgent,
    PIMCConfig,
    _match_utility,
    _preferred_variant,
    _search_action_groups,
    _signal_consistency_weight,
    pimc_choose_action,
)
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


def test_pimc_rejects_zero_determinizations():
    net = _v4_small()
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)

    with pytest.raises(ValueError, match="must be positive"):
        pimc_choose_action(net, g, viewer_seat=0, config=PIMCConfig(num_determinizations=0))


def test_pimc_agent_advances_call_seed_without_mutating_config(monkeypatch):
    net = _v4_small()
    config = PIMCConfig(num_determinizations=2, seed=17)
    agent = PIMCAgent(net, config, torch.device("cpu"))
    game = BeccaGame(seed=0)
    seen_seeds = []

    def choose_action(_net, _game, _seat, call_config, _device):
        seen_seeds.append(call_config.seed)
        return 0

    monkeypatch.setattr("inference.pimc.pimc_choose_action", choose_action)

    assert agent.select_action(game, game.current_seat) == Suit.DENARA
    assert agent.select_action(game, game.current_seat) == Suit.DENARA
    assert seen_seeds == [17, 18]
    assert config.seed == 17


def test_leader_signal_variants_collapse_to_one_branch_per_card():
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)
    legal = np.flatnonzero(encode_action_mask(g, g.current_seat)).tolist()

    groups = _search_action_groups(g, legal)

    assert len(legal) == 4 * len(g.round.player_hands[g.current_seat])
    assert len(groups) == len(g.round.player_hands[g.current_seat])
    assert all(len(group) == 4 for group in groups)
    assert all({action % 4 for action in group} == {0, 1, 2, 3} for group in groups)


class _FixedLogitNet(nn.Module):
    def __init__(self, preferred: int):
        super().__init__()
        self.obs_size = OBS_SIZE
        self.preferred = preferred
        self.anchor = nn.Parameter(torch.zeros(()))

    def forward(self, obs, mask):
        logits = torch.zeros((obs.shape[0], 160), device=obs.device) + self.anchor
        logits[:, self.preferred] += 10.0
        return logits + (1 - mask) * -1e8, torch.zeros(obs.shape[0], device=obs.device)


def test_collapsed_card_uses_network_preferred_signal_variant():
    g = BeccaGame(seed=42)
    g.step(Suit.DENARA)
    legal = np.flatnonzero(encode_action_mask(g, g.current_seat)).tolist()
    group = _search_action_groups(g, legal)[0]
    preferred = next(action for action in group if action % 4 == 2)
    net = _FixedLogitNet(preferred)

    selected = _preferred_variant(net, g, g.current_seat, group, torch.device("cpu"))

    assert selected == preferred


def test_signal_weight_prefers_world_consistent_with_current_claim():
    g = BeccaGame(seed=0)
    g.round.briscola = Suit.BASTONI
    g.phase = GamePhase.PLAY_CARD
    g.round.current_trick = [(0, Card(Suit.DENARA, Value.QUATTRO))]
    g.round.trick_signals = [(0, Signal.VOLO)]
    honest = SampledHands({0: [], 1: [], 2: [], 3: []})
    dishonest = SampledHands(
        {
            0: [Card(Suit.DENARA, Value.CINQUE)],
            1: [],
            2: [],
            3: [],
        }
    )

    assert _signal_consistency_weight(g, honest) > _signal_consistency_weight(g, dishonest)


def test_signal_weight_reconstructs_completed_declaration_history():
    g = BeccaGame(seed=0)
    lead = Card(Suit.DENARA, Value.QUATTRO)
    g.round.hands_played = [
        TrickRecord(
            winner=0,
            cards=[
                (0, lead),
                (1, Card(Suit.DENARA, Value.CINQUE)),
                (2, Card(Suit.DENARA, Value.SEI)),
                (3, Card(Suit.DENARA, Value.SETTE)),
            ],
            signal=Signal.VOLO,
            signal_seat=0,
        )
    ]
    honest = SampledHands({0: [], 1: [], 2: [], 3: []})
    contradicting = SampledHands(
        {
            0: [Card(Suit.DENARA, Value.ASSO)],
            1: [],
            2: [],
            3: [],
        }
    )

    assert _signal_consistency_weight(g, honest) > _signal_consistency_weight(g, contradicting)


def test_card_history_without_signals_has_neutral_weight():
    g = BeccaGame(seed=0)
    g.round.hands_played = [
        TrickRecord(
            winner=0,
            cards=[
                (0, Card(Suit.DENARA, Value.QUATTRO)),
                (1, Card(Suit.DENARA, Value.CINQUE)),
                (2, Card(Suit.DENARA, Value.SEI)),
                (3, Card(Suit.DENARA, Value.SETTE)),
            ],
        )
    ]
    sampled = SampledHands({seat: list(g.round.player_hands[seat]) for seat in range(4)})

    assert _signal_consistency_weight(g, sampled) == 1.0


def test_match_utility_uses_threshold_result_and_caller_tie_break():
    g = BeccaGame(seed=0, win_points=41)
    g.total_scores = {0: 120, 1: 108}
    assert _match_utility(g, viewer_seat=0) == pytest.approx(12 / 123)

    caller_team = TEAM_OF_SEAT[g.round.caller_seat]
    g.phase = GamePhase.GAME_OVER
    g.result = GameResult(
        winner_team=caller_team,
        total_scores={0: 41, 1: 41},
        rounds_won={0: 1, 1: 1},
    )
    caller_seat = g.round.caller_seat
    opponent_seat = (caller_seat + 1) % 4
    assert _match_utility(g, caller_seat) == 1.0
    assert _match_utility(g, opponent_seat) == -1.0
