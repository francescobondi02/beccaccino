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


def test_follow_partner_winning_dumps_cheapest():
    """Partner is winning the trick — never play high or trump.
    Setup: seat 0 led, seat 2 (our partner) is current winner with TRE denara.
    We are seat 3 (team 1). Wait — seats {0,2}=team0, {1,3}=team1.
    Let's flip: seat 1 leads, seat 3 (partner of seat 1) is winning, we are seat 0 to follow."""
    g = _make_game_in_play_phase(briscola=Suit.SPADE)
    # Setup: trick has 3 cards already; seat 3 (us, team 1) is to act.
    # Seat 1 (our partner) is currently winning with TRE denara.
    # We must dump our cheapest card and not waste the ASSO.
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.QUATTRO)),  # opp led
        (1, Card(Suit.DENARA, Value.TRE)),      # our partner (str 10) — winning
        (2, Card(Suit.DENARA, Value.SEI)),      # opp
    ]
    g.round.player_hands[3] = [
        Card(Suit.DENARA, Value.ASSO),  # 3 pts — must NOT play
        Card(Suit.DENARA, Value.CINQUE),  # 0 pt — expected dump
        Card(Suit.DENARA, Value.RE),  # 1 pt
    ]
    card = HeuristicAgent().select_action(g, 3)
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


def test_free_play_partner_winning_no_trump():
    """Partner winning, we're out of suit — don't trump, dump cheapest non-briscola."""
    g = _make_game_in_play_phase(briscola=Suit.BASTONI)
    g.round.trick_starter = 0
    g.round.current_trick = [
        (0, Card(Suit.DENARA, Value.QUATTRO)),
        (1, Card(Suit.DENARA, Value.RE)),  # opp
        (2, Card(Suit.BASTONI, Value.QUATTRO)),  # our partner trumped — winning
    ]
    g.round.player_hands[3] = [
        Card(Suit.SPADE, Value.QUATTRO),  # 0 pt non-briscola — expected
        Card(Suit.COPPE, Value.ASSO),     # 3 pts (don't waste!)
        Card(Suit.BASTONI, Value.TRE),    # don't trump partner
    ]
    card = HeuristicAgent().select_action(g, 3)
    assert card == Card(Suit.SPADE, Value.QUATTRO)


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
