"""Tests for the full game state machine."""

import pytest
from becca_env.game import BeccaGame, GamePhase, Signal, TEAM_OF_SEAT
from becca_env.deck import Suit, Value, Card


class TestGameInit:
    def test_game_starts_in_briscola_phase(self):
        game = BeccaGame(seed=1)
        assert game.phase == GamePhase.CHOOSE_BRISCOLA

    def test_each_player_gets_10_cards(self):
        game = BeccaGame(seed=1)
        for seat in range(4):
            assert len(game.get_hand(seat)) == 10

    def test_all_40_cards_dealt(self):
        game = BeccaGame(seed=1)
        all_cards = []
        for seat in range(4):
            all_cards.extend(game.get_hand(seat))
        assert len(all_cards) == 40
        assert len(set(all_cards)) == 40

    def test_caller_has_quattro_denara_round1(self):
        game = BeccaGame(seed=1)
        caller = game.current_seat
        hand = game.get_hand(caller)
        assert Card(Suit.DENARA, Value.QUATTRO) in hand


class TestBriscolaChoice:
    def test_choose_briscola_transitions_to_play(self):
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)
        assert game.phase == GamePhase.PLAY_CARD
        assert game.round.briscola == Suit.DENARA

    def test_invalid_briscola_raises(self):
        game = BeccaGame(seed=1)
        with pytest.raises(ValueError):
            game.step("invalid")


class TestPlayCard:
    def test_trick_leader_must_provide_tuple(self):
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)
        hand = game.get_hand(game.current_seat)
        # Leader must play (card, signal)
        with pytest.raises(ValueError):
            game.step(hand[0])  # Missing signal tuple

    def test_trick_leader_can_signal(self):
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)
        hand = game.get_hand(game.current_seat)
        info = game.step((hand[0], Signal.STRISCIO))
        assert info["signal"] == Signal.STRISCIO

    def test_trick_leader_can_skip_signal(self):
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)
        hand = game.get_hand(game.current_seat)
        info = game.step((hand[0], None))
        assert info["signal"] is None

    def test_follower_plays_card_directly(self):
        game = BeccaGame(seed=1)
        game.step(Suit.COPPE)  # choose briscola

        # Leader plays
        leader = game.current_seat
        leader_hand = game.get_hand(leader)
        game.step((leader_hand[0], None))

        # Follower plays a card (no tuple)
        follower = game.current_seat
        assert follower != leader
        actions = game.legal_actions()
        game.step(actions[0])  # Should work without tuple

    def test_must_follow_suit(self):
        game = BeccaGame(seed=42)
        game.step(Suit.DENARA)

        leader = game.current_seat
        leader_hand = game.get_hand(leader)
        # Play a denara card
        denara_card = next((c for c in leader_hand if c.suit == Suit.DENARA), leader_hand[0])
        game.step((denara_card, None))

        follower = game.current_seat
        follower_hand = game.get_hand(follower)
        has_denara = any(c.suit == Suit.DENARA for c in follower_hand)

        if has_denara:
            # Must follow suit — non-denara card should be rejected
            non_denara = next((c for c in follower_hand if c.suit != Suit.DENARA), None)
            if non_denara:
                with pytest.raises(ValueError, match="not playable"):
                    game.step(non_denara)

    def test_trick_completes_after_4_cards(self):
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)
        _play_one_trick(game)
        # After 4 cards, hands_played should have 1 entry
        assert len(game.round.hands_played) == 1


class TestFullRound:
    def test_round_ends_after_10_hands(self):
        game = BeccaGame(seed=1, win_points=999)  # high threshold to avoid game ending
        game.step(Suit.DENARA)

        for _ in range(10):
            _play_one_trick(game)

        # After 10 tricks, a new round should start
        assert game.round.number == 2
        assert game.phase == GamePhase.CHOOSE_BRISCOLA

    def test_caller_rotates_between_rounds(self):
        game = BeccaGame(seed=1, win_points=999)
        first_caller = game.current_seat
        game.step(Suit.DENARA)

        for _ in range(10):
            _play_one_trick(game)

        second_caller = game.current_seat
        assert second_caller == (first_caller + 1) % 4


class TestFullGame:
    def test_game_ends_when_threshold_reached(self):
        game = BeccaGame(seed=42, win_points=5)  # low threshold for fast test
        rounds_played = 0

        while game.phase != GamePhase.GAME_OVER:
            if game.phase == GamePhase.CHOOSE_BRISCOLA:
                game.step(Suit.DENARA)
                rounds_played += 1
            else:
                _play_one_trick(game)

        assert game.result is not None
        assert game.result.winner_team in (0, 1)
        assert rounds_played >= 1

    def test_deterministic_with_same_seed(self):
        """Same seed produces identical games."""
        results = []
        for _ in range(2):
            game = BeccaGame(seed=123, win_points=5)
            actions = []
            while game.phase != GamePhase.GAME_OVER:
                if game.phase == GamePhase.CHOOSE_BRISCOLA:
                    action = Suit.DENARA
                else:
                    legal = game.legal_actions()
                    action = legal[0]
                game.step(action)
                actions.append(str(action))
            results.append(actions)

        assert results[0] == results[1]


class TestObservation:
    def test_observation_has_correct_keys(self):
        game = BeccaGame(seed=1)
        obs = game.get_observation(0)
        assert "phase" in obs
        assert "my_hand" in obs
        assert "briscola" in obs
        assert "is_my_turn" in obs

    def test_observation_hides_other_hands(self):
        game = BeccaGame(seed=1)
        obs = game.get_observation(0)
        # Only my_hand is visible, not other players' hands
        assert len(obs["my_hand"]) == 10
        assert "player_hands" not in obs


def _play_one_trick(game: BeccaGame):
    """Helper: play one complete trick (4 cards)."""
    for i in range(4):
        seat = game.current_seat
        actions = game.legal_actions()
        action = actions[0]  # always play first legal action
        game.step(action)
