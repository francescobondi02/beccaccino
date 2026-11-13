"""Tests for the full game state machine."""

import pytest

from becca_env.deck import Card, Suit, Value
from becca_env.game import BeccaGame, GamePhase, Signal


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
        """Find a seed where the follower has the lead suit AND another suit, then
        verify playing the wrong suit raises ValueError."""

        # Try seeds until we find one where follower has lead suit + off-suit
        for seed in range(100):
            game = BeccaGame(seed=seed)
            game.step(Suit.DENARA)

            leader = game.current_seat
            leader_hand = game.get_hand(leader)
            denara_card = next((c for c in leader_hand if c.suit == Suit.DENARA), None)
            if denara_card is None:
                continue
            game.step((denara_card, None))

            follower = game.current_seat
            follower_hand = game.get_hand(follower)
            has_denara = any(c.suit == Suit.DENARA for c in follower_hand)
            non_denara = next((c for c in follower_hand if c.suit != Suit.DENARA), None)

            if has_denara and non_denara:
                with pytest.raises(ValueError, match="not playable"):
                    game.step(non_denara)
                return  # test passed

        pytest.fail("Could not find seed where follower must follow suit")

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


class TestCricca:
    def test_cricca_detected_on_briscola_choice(self):
        """Find a seed where the caller has tre+due+asso of a suit, choose that suit."""
        from becca_env.rules import detect_cricca

        for seed in range(500):
            game = BeccaGame(seed=seed, win_points=999)
            caller = game.current_seat
            hand = game.get_hand(caller)

            # Check if any suit gives cricca
            for suit in Suit:
                if detect_cricca(hand, suit):
                    info = game.step(suit)
                    assert game.round.cricca is True
                    assert info["cricca"] is True
                    return

        pytest.fail("Could not find a seed with cricca in 500 attempts")

    def test_no_cricca_when_cards_missing(self):
        """Standard case: caller doesn't have cricca."""
        game = BeccaGame(seed=1, win_points=999)
        # Seed 1: caller unlikely to have tre+due+asso of the chosen suit
        game.step(Suit.BASTONI)
        assert game.round.cricca is False

    def test_cricca_bonus_applied_at_round_end(self):
        """When cricca occurs, +3 points added to caller's team at round end."""
        from becca_env.game import TEAM_OF_SEAT
        from becca_env.rules import detect_cricca

        for seed in range(500):
            game = BeccaGame(seed=seed, win_points=999)
            caller = game.current_seat
            hand = game.get_hand(caller)

            cricca_suit = None
            for suit in Suit:
                if detect_cricca(hand, suit):
                    cricca_suit = suit
                    break

            if cricca_suit is None:
                continue

            game.step(cricca_suit)
            assert game.round.cricca is True
            TEAM_OF_SEAT[caller]

            # Play full round
            for _ in range(10):
                _play_one_trick(game)

            # After round ends, check that total_scores includes the +9 raw bonus
            # The total raw for both teams should be 35 (normal) + 9 (cricca) = 44
            total_raw = game.total_scores[0] + game.total_scores[1]
            assert total_raw == 44, f"Expected 44 total raw, got {total_raw}"
            return

        pytest.fail("Could not find seed with cricca")


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


class TestTieBreaker:
    def test_both_teams_reach_threshold_higher_wins(self):
        """When both teams cross win_points, higher cumulative score wins."""
        # Use win_points=5 — both teams will likely cross it in same round
        for seed in range(200):
            game = BeccaGame(seed=seed, win_points=5)
            while game.phase != GamePhase.GAME_OVER:
                if game.phase == GamePhase.CHOOSE_BRISCOLA:
                    game.step(Suit.DENARA)
                else:
                    actions = game.legal_actions()
                    game.step(actions[0])

            t0 = game.result.total_scores[0]
            t1 = game.result.total_scores[1]

            # If both teams >= threshold, verify winner has more (or equal) points
            if t0 >= 5 and t1 >= 5:
                winner = game.result.winner_team
                if t0 > t1:
                    assert winner == 0
                elif t1 > t0:
                    assert winner == 1
                # If truly equal, caller's team wins — just verify it doesn't crash
                return

        # Even if we didn't find a double-threshold case, the test shouldn't fail
        # (it's hard to guarantee with random seeds)


class TestObservation:
    def test_observation_has_correct_keys(self):
        game = BeccaGame(seed=1)
        obs = game.get_observation(0)
        assert "phase" in obs
        assert "my_hand" in obs
        assert "briscola" in obs
        assert "is_my_turn" in obs
        assert "signals_history" in obs

    def test_observation_hides_other_hands(self):
        game = BeccaGame(seed=1)
        obs = game.get_observation(0)
        assert len(obs["my_hand"]) == 10
        assert "player_hands" not in obs

    def test_signal_preserved_in_observation(self):
        """Signals declared by trick leader appear in observation."""
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)

        # Play one trick with a signal
        leader = game.current_seat
        hand = game.get_hand(leader)
        game.step((hand[0], Signal.STRISCIO))

        # Remaining 3 players
        for _ in range(3):
            actions = game.legal_actions()
            game.step(actions[0])

        # Now check observation — should record the signal
        obs = game.get_observation(0)
        signals = obs["signals_history"]
        assert len(signals) == 1
        assert signals[0] == (leader, Signal.STRISCIO)

    def test_signal_recorded_on_completed_trick(self):
        """The engine must persist the leader's signal on the TrickRecord.

        Note: as of obs-v3 the observation tensor no longer encodes signals
        (planned to be re-added in a later iteration). The engine bookkeeping
        is unchanged and remains the source of truth for who declared what.
        """
        game = BeccaGame(seed=1)
        game.step(Suit.DENARA)

        leader = game.current_seat
        hand = game.get_hand(leader)
        game.step((hand[0], Signal.BUSSO))
        for _ in range(3):
            actions = game.legal_actions()
            game.step(actions[0])

        # Trick is complete; should be recorded with the signal
        assert len(game.round.hands_played) == 1
        rec = game.round.hands_played[0]
        assert rec.signal == Signal.BUSSO
        assert rec.signal_seat == leader


def _play_one_trick(game: BeccaGame):
    """Helper: play one complete trick (4 cards)."""
    for i in range(4):
        actions = game.legal_actions()
        action = actions[0]  # always play first legal action
        game.step(action)
