"""Tests for the heuristic baseline agent.

Uses hand-crafted states: we instantiate a real BeccaGame to get the round
machinery, then overwrite player_hands / briscola / current_trick to set up
the exact position we want to probe.
"""

from __future__ import annotations

from becca_env.deck import Card, Suit, Value
from becca_env.game import BeccaGame, GamePhase
from evaluation.heuristic import HeuristicAgent, evaluate_against_heuristic


def _make_game_in_play_phase(briscola: Suit) -> BeccaGame:
    """Instantiate a game and force it into PLAY_CARD with chosen briscola."""
    g = BeccaGame(seed=0)
    # Set briscola directly (BeccaGame is in CHOOSE_BRISCOLA initially)
    g.round.briscola = briscola
    g.phase = GamePhase.PLAY_CARD
    g.round.current_trick = []
    g.round.trick_signals = []
    return g


def test_briscola_choice_picks_strongest_suit():
    """Heuristic should pick the suit where it has the most/strongest cards."""
    g = BeccaGame(seed=0)
    # Force seat 0 to be the caller and load a known hand
    g.round.caller_seat = 0
    g.round.player_hands[0] = [
        Card(Suit.DENARA, Value.TRE),
        Card(Suit.DENARA, Value.DUE),
        Card(Suit.DENARA, Value.ASSO),
        Card(Suit.DENARA, Value.RE),
        Card(Suit.SPADE, Value.QUATTRO),
        Card(Suit.SPADE, Value.CINQUE),
        Card(Suit.COPPE, Value.SEI),
        Card(Suit.BASTONI, Value.SETTE),
        Card(Suit.BASTONI, Value.FANTE),
        Card(Suit.BASTONI, Value.CAVALLO),
    ]
    agent = HeuristicAgent()
    chosen = agent.select_action(g, 0)
    assert chosen == Suit.DENARA, f"expected DENARA, got {chosen}"


def test_lead_plays_lowest_non_briscola():
    """As leader, dump the lowest-point non-briscola; never lead a trump if avoidable."""
    g = _make_game_in_play_phase(briscola=Suit.DENARA)
    g.round.trick_starter = 0
    g.round.player_hands[0] = [
        Card(Suit.DENARA, Value.ASSO),  # high briscola, must NOT be led
        Card(Suit.SPADE, Value.QUATTRO),  # 0 pts, low strength → expected
        Card(Suit.COPPE, Value.RE),  # 1 pt
        Card(Suit.BASTONI, Value.TRE),  # 1 pt, high strength
    ]
    agent = HeuristicAgent()
    card, signal = agent.select_action(g, 0)
    assert signal is None
    assert card == Card(Suit.SPADE, Value.QUATTRO)


def test_lead_with_only_briscola_plays_lowest_briscola():
    g = _make_game_in_play_phase(briscola=Suit.DENARA)
    g.round.trick_starter = 0
    g.round.player_hands[0] = [
        Card(Suit.DENARA, Value.QUATTRO),  # lowest briscola — expected
        Card(Suit.DENARA, Value.SETTE),
        Card(Suit.DENARA, Value.RE),
    ]
    card, _ = HeuristicAgent().select_action(g, 0)
    assert card == Card(Suit.DENARA, Value.QUATTRO)


def test_follow_minimum_winning_card_when_can_beat():
    """Opponent led an Asso of denara (non-briscola); we have RE & TRE & QUATTRO of denara.
    We should win it cheaply with TRE (min winning card), not RE."""
    g = _make_game_in_play_phase(briscola=Suit.SPADE)  # spade trump, denara lead
    # Seat 0 (opponent) led ASSO denara; we are seat 1
    g.round.trick_starter = 0
    g.round.current_trick = [(0, Card(Suit.DENARA, Value.ASSO))]
    g.round.player_hands[1] = [
        Card(Suit.DENARA, Value.QUATTRO),  # can't beat
        Card(Suit.DENARA, Value.RE),       # can beat (str 7 > asso str 8? no — RE=7, ASSO=8)
        Card(Suit.DENARA, Value.TRE),      # str 10, beats ASSO (str 8) ✓
        Card(Suit.DENARA, Value.DUE),      # str 9, beats ASSO ✓ — this is the MIN winner
    ]
    card = HeuristicAgent().select_action(g, 1)
    # Asso strength = 8. Winners: TRE(10), DUE(9). Lowest-strength winner = DUE.
    assert card == Card(Suit.DENARA, Value.DUE)


def test_follow_dumps_low_when_cannot_beat():
    """Opponent led TRE denara, we only have lower denara — dump 0-point card."""
    g = _make_game_in_play_phase(briscola=Suit.SPADE)
    g.round.trick_starter = 0
    g.round.current_trick = [(0, Card(Suit.DENARA, Value.TRE))]  # max strength
    g.round.player_hands[1] = [
        Card(Suit.DENARA, Value.RE),       # 1 pt
        Card(Suit.DENARA, Value.QUATTRO),  # 0 pt — expected dump
        Card(Suit.DENARA, Value.SEI),      # 0 pt
    ]
    card = HeuristicAgent().select_action(g, 1)
    # Both QUATTRO (0pt, str 1) and SEI (0pt, str 3): min by (points, strength) → QUATTRO
    assert card == Card(Suit.DENARA, Value.QUATTRO)


def test_follow_partner_winning_last_to_play_loads_carico():
    """Partner is winning and we are LAST to play (trick has 3 cards): the win
    is guaranteed, so load the highest-point card (carico) onto it.
    Seat 0 led, seat 1 (our partner) is winning with TRE denara, we are seat 3
    (team 1) last to act."""
    g = _make_game_in_play_phase(briscola=Suit.SPADE)
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.QUATTRO)),  # opp led
        (1, Card(Suit.DENARA, Value.TRE)),      # our partner (str 10) — winning
        (2, Card(Suit.DENARA, Value.SEI)),      # opp
    ]
    g.round.player_hands[3] = [
        Card(Suit.DENARA, Value.ASSO),    # 3 pts — expected carico onto the win
        Card(Suit.DENARA, Value.CINQUE),  # 0 pt
        Card(Suit.DENARA, Value.RE),      # 1 pt
    ]
    card = HeuristicAgent().select_action(g, 3)
    assert card == Card(Suit.DENARA, Value.ASSO)


def test_follow_partner_winning_not_last_dumps_cheapest():
    """Partner is winning but a later opponent can still steal (we are NOT last):
    dump the cheapest card, don't risk a carico. Seat 0 (our partner) led TRE
    and is winning; we are seat 2 (team 0), 3rd to play, seat 3 still to come."""
    g = _make_game_in_play_phase(briscola=Suit.SPADE)
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.TRE)),   # our partner (str 10) — winning
        (1, Card(Suit.DENARA, Value.SEI)),   # opp
    ]
    g.round.player_hands[2] = [
        Card(Suit.DENARA, Value.ASSO),    # 3 pts — must NOT risk it
        Card(Suit.DENARA, Value.CINQUE),  # 0 pt — expected dump
        Card(Suit.DENARA, Value.RE),      # 1 pt
    ]
    card = HeuristicAgent().select_action(g, 2)
    assert card == Card(Suit.DENARA, Value.CINQUE)


def test_free_play_trumps_opponents_asso():
    """Out of lead suit, opponent winning a trick with ASSO (3 pts) — trump it cheaply."""
    g = _make_game_in_play_phase(briscola=Suit.BASTONI)
    g.round.trick_starter = 0
    g.round.current_trick = [(0, Card(Suit.DENARA, Value.ASSO))]  # opp winning, 3 pts
    g.round.player_hands[1] = [
        Card(Suit.SPADE, Value.QUATTRO),  # can't follow suit
        Card(Suit.COPPE, Value.SETTE),
        Card(Suit.BASTONI, Value.QUATTRO),  # lowest briscola
        Card(Suit.BASTONI, Value.RE),       # higher briscola
    ]
    card = HeuristicAgent().select_action(g, 1)
    assert card == Card(Suit.BASTONI, Value.QUATTRO)


def test_free_play_does_not_trump_worthless_trick():
    """Out of suit, opponent winning a 0-point trick — don't waste trump."""
    g = _make_game_in_play_phase(briscola=Suit.BASTONI)
    g.round.trick_starter = 0
    g.round.current_trick = [(0, Card(Suit.DENARA, Value.QUATTRO))]  # 0 pts
    g.round.player_hands[1] = [
        Card(Suit.SPADE, Value.QUATTRO),  # 0 pt non-briscola — expected
        Card(Suit.COPPE, Value.RE),       # 1 pt
        Card(Suit.BASTONI, Value.DUE),
    ]
    card = HeuristicAgent().select_action(g, 1)
    assert card == Card(Suit.SPADE, Value.QUATTRO)


def test_free_play_partner_winning_last_loads_carico_no_trump():
    """Partner winning, we're out of suit and LAST to play — don't trump, but
    load our highest-point non-briscola (carico) onto the guaranteed win."""
    g = _make_game_in_play_phase(briscola=Suit.BASTONI)
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.QUATTRO)),  # opp led
        (1, Card(Suit.BASTONI, Value.CINQUE)),  # our partner trumped — winning
        (2, Card(Suit.DENARA, Value.RE)),       # opp
    ]
    g.round.player_hands[3] = [
        Card(Suit.SPADE, Value.QUATTRO),  # 0 pt non-briscola
        Card(Suit.COPPE, Value.ASSO),     # 3 pts non-briscola — expected carico
        Card(Suit.BASTONI, Value.TRE),    # don't trump partner
    ]
    card = HeuristicAgent().select_action(g, 3)
    assert card == Card(Suit.COPPE, Value.ASSO)


def test_heuristic_beats_random_decisively():
    """Sanity: heuristic should crush random over many games."""
    import random as pyrandom

    class RandAgent:
        def __init__(self, seed):
            self.rng = pyrandom.Random(seed)

        def select_action(self, game, seat):
            return self.rng.choice(game.legal_actions())

    from evaluation.heuristic import play_match_heuristic
    h = HeuristicAgent(seed=1)
    r = RandAgent(seed=2)
    h_wins, r_wins = play_match_heuristic(h, r, num_games=40, win_points=11, seed=42)
    assert h_wins > r_wins * 2, f"heuristic={h_wins} random={r_wins} — heuristic too weak"


def test_evaluate_against_heuristic_runs_end_to_end():
    """Smoke test: untrained net vs heuristic — should run without errors."""
    import torch

    from training.network import create_network

    net = create_network(version=2, hidden_size=64, num_layers=2)
    wr = evaluate_against_heuristic(net, num_games=10, win_points=5,
                                    device=torch.device("cpu"), seed=0)
    assert 0.0 <= wr <= 1.0
