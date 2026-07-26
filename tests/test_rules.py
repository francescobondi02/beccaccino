"""Tests for game rules — shared test vectors with TypeScript backend."""

import pytest

from becca_env.deck import Card, Suit, Value
from becca_env.rules import (
    compute_round_scores,
    detect_cricca,
    determine_hand_winner,
    follow_suit_filter,
)


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
            (0, Card(Suit.DENARA, Value.ASSO)),  # strength 8
            (1, Card(Suit.DENARA, Value.TRE)),  # strength 10
            (2, Card(Suit.DENARA, Value.QUATTRO)),  # strength 1
            (3, Card(Suit.SPADE, Value.TRE)),  # off-suit, ignored
        ]
        winner = determine_hand_winner(played, Suit.COPPE)  # briscola is coppe
        assert winner == 1

    def test_briscola_beats_lead_suit(self):
        """Even weak briscola beats strong lead suit card."""
        played = [
            (0, Card(Suit.DENARA, Value.TRE)),  # lead suit, strength 10
            (1, Card(Suit.COPPE, Value.QUATTRO)),  # briscola, strength 1
            (2, Card(Suit.DENARA, Value.ASSO)),  # lead suit, strength 8
            (3, Card(Suit.SPADE, Value.RE)),  # off-suit
        ]
        winner = determine_hand_winner(played, Suit.COPPE)
        assert winner == 1

    def test_highest_briscola_wins(self):
        """When multiple briscole, highest strength wins."""
        played = [
            (0, Card(Suit.COPPE, Value.QUATTRO)),  # briscola, strength 1
            (1, Card(Suit.DENARA, Value.TRE)),  # off-suit
            (2, Card(Suit.COPPE, Value.DUE)),  # briscola, strength 9
            (3, Card(Suit.COPPE, Value.FANTE)),  # briscola, strength 5
        ]
        winner = determine_hand_winner(played, Suit.COPPE)
        assert winner == 2

    def test_off_suit_loses_when_no_briscola_played(self):
        """Off-suit cards are ignored; weakest lead-suit card wins if no briscola present."""
        played = [
            (0, Card(Suit.DENARA, Value.QUATTRO)),  # lead suit, strength 1
            (1, Card(Suit.SPADE, Value.TRE)),  # off-suit, strength 10 but irrelevant
            (2, Card(Suit.BASTONI, Value.TRE)),  # off-suit, strength 10 but irrelevant
            (3, Card(Suit.COPPE, Value.TRE)),  # off-suit, strength 10 but irrelevant
        ]
        # Briscola is a suit not present in any played card
        winner = determine_hand_winner(played, Suit.COPPE)
        # Only seat 0 follows lead suit (denara), so seat 0 wins despite lowest strength
        # Wait — coppe IS played by seat 3. Use a briscola not in trick.
        # Actually coppe is played. Let's set briscola to something not in trick.
        # Re-do: all off-suit cards are spade/bastoni/coppe. If briscola=coppe, seat 3 wins.
        # For a true "no briscola played" test, briscola must not appear in trick.
        played2 = [
            (0, Card(Suit.DENARA, Value.QUATTRO)),  # lead suit, strength 1
            (1, Card(Suit.SPADE, Value.TRE)),  # off-suit, strength 10
            (2, Card(Suit.SPADE, Value.DUE)),  # off-suit, strength 9
            (3, Card(Suit.SPADE, Value.ASSO)),  # off-suit, strength 8
        ]
        winner = determine_hand_winner(played2, Suit.COPPE)  # briscola not in trick
        assert winner == 0  # weakest lead card still wins when others don't follow

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
        import random

        from becca_env.deck import DECK

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
        zero_values = (Value.QUATTRO, Value.CINQUE, Value.SEI, Value.SETTE)
        zero_cards = [c for c in DECK if c.value in zero_values]

        hands = []
        for i in range(10):
            trick = [(j, zero_cards[(i * 4 + j) % len(zero_cards)]) for j in range(4)]
            # Seat 0 (team 0) always wins
            hands.append((0, trick))

        scores = compute_round_scores(hands, team_of_seat)
        # Only points come from last-hand bonus = 3 raw = 1 point
        assert scores["team0"]["points"] == 1
        assert scores["team1"]["points"] == 0


class TestDetectCricca:
    def test_cricca_detected_with_tre_due_asso(self):
        hand = [
            Card(Suit.DENARA, Value.TRE),
            Card(Suit.DENARA, Value.DUE),
            Card(Suit.DENARA, Value.ASSO),
            Card(Suit.DENARA, Value.QUATTRO),
            Card(Suit.SPADE, Value.RE),
            Card(Suit.COPPE, Value.FANTE),
            Card(Suit.BASTONI, Value.SETTE),
            Card(Suit.COPPE, Value.CINQUE),
            Card(Suit.SPADE, Value.SEI),
            Card(Suit.BASTONI, Value.CAVALLO),
        ]
        assert detect_cricca(hand, Suit.DENARA) is True

    def test_no_cricca_when_missing_one_card(self):
        hand = [
            Card(Suit.DENARA, Value.TRE),
            Card(Suit.DENARA, Value.DUE),
            # Missing asso of denara
            Card(Suit.DENARA, Value.QUATTRO),
            Card(Suit.SPADE, Value.ASSO),  # asso but wrong suit
            Card(Suit.COPPE, Value.RE),
            Card(Suit.BASTONI, Value.FANTE),
            Card(Suit.SPADE, Value.SETTE),
            Card(Suit.COPPE, Value.CINQUE),
            Card(Suit.SPADE, Value.SEI),
            Card(Suit.BASTONI, Value.CAVALLO),
        ]
        assert detect_cricca(hand, Suit.DENARA) is False

    def test_cricca_checks_correct_suit(self):
        hand = [
            Card(Suit.SPADE, Value.TRE),
            Card(Suit.SPADE, Value.DUE),
            Card(Suit.SPADE, Value.ASSO),
            Card(Suit.DENARA, Value.TRE),
            Card(Suit.DENARA, Value.DUE),
            Card(Suit.DENARA, Value.ASSO),
            Card(Suit.COPPE, Value.QUATTRO),
            Card(Suit.BASTONI, Value.CINQUE),
            Card(Suit.COPPE, Value.SEI),
            Card(Suit.BASTONI, Value.SETTE),
        ]
        assert detect_cricca(hand, Suit.SPADE) is True
        assert detect_cricca(hand, Suit.DENARA) is True
        assert detect_cricca(hand, Suit.COPPE) is False
        assert detect_cricca(hand, Suit.BASTONI) is False
