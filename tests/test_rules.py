"""Tests for game rules — shared test vectors with TypeScript backend."""

import pytest
from becca_env.deck import Card, Suit, Value
from becca_env.rules import follow_suit_filter, determine_hand_winner, compute_round_scores


class TestFollowSuit:
    def test_must_follow_suit_if_possible(self):
        hand = [
            Card(Suit.DENARA, Value.ASSO),
            Card(Suit.DENARA, Value.TRE),
            Card(Suit.SPADE, Value.RE),
        ]
        playable = follow_suit_filter(hand, Suit.DENARA)
        assert len(playable) == 2
        assert all(c.suit == Suit.DENARA for c in playable)

    def test_can_play_anything_if_no_matching_suit(self):
        hand = [
            Card(Suit.SPADE, Value.ASSO),
            Card(Suit.COPPE, Value.RE),
            Card(Suit.BASTONI, Value.FANTE),
        ]
        playable = follow_suit_filter(hand, Suit.DENARA)
        assert playable == hand

    def test_single_matching_card(self):
        hand = [
            Card(Suit.DENARA, Value.QUATTRO),
            Card(Suit.SPADE, Value.TRE),
            Card(Suit.COPPE, Value.ASSO),
        ]
        playable = follow_suit_filter(hand, Suit.DENARA)
        assert playable == [Card(Suit.DENARA, Value.QUATTRO)]


class TestDetermineHandWinner:
    def test_highest_lead_suit_wins(self):
        """Tre (strength 10) beats Asso (strength 8) in lead suit."""
        played = [
            (0, Card(Suit.DENARA, Value.ASSO)),   # strength 8
            (1, Card(Suit.DENARA, Value.TRE)),    # strength 10
            (2, Card(Suit.DENARA, Value.QUATTRO)),# strength 1
            (3, Card(Suit.SPADE, Value.TRE)),     # off-suit, ignored
        ]
        winner = determine_hand_winner(played, Suit.COPPE)  # briscola is coppe
        assert winner == 1

    def test_briscola_beats_lead_suit(self):
        """Even weak briscola beats strong lead suit card."""
        played = [
            (0, Card(Suit.DENARA, Value.TRE)),     # lead suit, strength 10
            (1, Card(Suit.COPPE, Value.QUATTRO)),  # briscola, strength 1
            (2, Card(Suit.DENARA, Value.ASSO)),    # lead suit, strength 8
            (3, Card(Suit.SPADE, Value.RE)),       # off-suit
        ]
        winner = determine_hand_winner(played, Suit.COPPE)
        assert winner == 1

    def test_highest_briscola_wins(self):
        """When multiple briscole, highest strength wins."""
        played = [
            (0, Card(Suit.COPPE, Value.QUATTRO)),  # briscola, strength 1
            (1, Card(Suit.DENARA, Value.TRE)),     # off-suit
            (2, Card(Suit.COPPE, Value.DUE)),      # briscola, strength 9
            (3, Card(Suit.COPPE, Value.FANTE)),    # briscola, strength 5
        ]
        winner = determine_hand_winner(played, Suit.COPPE)
        assert winner == 2

    def test_off_suit_without_briscola_loses(self):
        """Cards not in lead suit and not briscola are ignored."""
        played = [
            (0, Card(Suit.DENARA, Value.QUATTRO)),  # lead, strength 1
            (1, Card(Suit.SPADE, Value.TRE)),       # off-suit, strong but irrelevant
            (2, Card(Suit.BASTONI, Value.TRE)),     # off-suit
            (3, Card(Suit.COPPE, Value.TRE)),       # off-suit
        ]
        winner = determine_hand_winner(played, Suit.BASTONI)
        # Bastoni is briscola, seat 2 has bastoni tre
        assert winner == 2

    def test_no_cards_raises(self):
        with pytest.raises(ValueError):
            determine_hand_winner([], Suit.DENARA)


class TestComputeRoundScores:
    def test_total_points_sum_correctly(self):
        """All 40 cards played across 10 hands.
        Total raw = 32 (card points) + 3 (last hand bonus) = 35.
        35 // 3 = 11 points, 35 % 3 = 2 figures.
        Both teams combined must equal this.
        """
        from becca_env.deck import DECK
        import random

        rng = random.Random(42)
        deck = list(DECK)
        rng.shuffle(deck)

        team_of_seat = {0: 0, 1: 1, 2: 0, 3: 1}
        hands = []
        for i in range(10):
            trick = [(seat, deck[i * 4 + seat]) for seat in range(4)]
            winner = determine_hand_winner(trick, Suit.DENARA)
            hands.append((winner, trick))

        scores = compute_round_scores(hands, team_of_seat)
        total_raw = scores["team0"]["raw"] + scores["team1"]["raw"]
        # 32 card points + 3 last-hand bonus = 35
        assert total_raw == 35

    def test_last_hand_bonus(self):
        """Team that wins last hand gets +1 point (raw +3)."""
        from becca_env.deck import DECK

        team_of_seat = {0: 0, 1: 1, 2: 0, 3: 1}
        # Create 10 hands where all cards are zero-point cards except last hand
        zero_cards = [c for c in DECK if c.value in (Value.QUATTRO, Value.CINQUE, Value.SEI, Value.SETTE)]

        hands = []
        for i in range(10):
            trick = [(j, zero_cards[(i * 4 + j) % len(zero_cards)]) for j in range(4)]
            # Seat 0 (team 0) always wins
            hands.append((0, trick))

        scores = compute_round_scores(hands, team_of_seat)
        # Only points come from last-hand bonus = 3 raw = 1 point
        assert scores["team0"]["points"] == 1
        assert scores["team1"]["points"] == 0
