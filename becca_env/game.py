"""Full Beccaccino game state machine.

Supports 4 players (seats 0-3), teams: {0,2} vs {1,3}.
Phases: CHOOSE_BRISCOLA -> PLAY_CARD (repeat 10 hands) -> ROUND_END -> ... -> GAME_OVER.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum

from becca_env.deck import DECK, Card, Suit, Value
from becca_env.rules import (
    compute_round_scores,
    detect_cricca,
    determine_hand_winner,
    follow_suit_filter,
)


class GamePhase(Enum):
    CHOOSE_BRISCOLA = "choose_briscola"
    PLAY_CARD = "play_card"
    ROUND_END = "round_end"
    GAME_OVER = "game_over"


class Signal(Enum):
    STRISCIO = "striscio"
    BUSSO = "busso"
    VOLO = "volo"


TEAM_OF_SEAT = {0: 0, 1: 1, 2: 0, 3: 1}
WIN_POINTS = 41


@dataclass
class TrickRecord:
    winner: int
    cards: list[tuple[int, Card]]
    signal: Signal | None = None  # signal declared by trick leader (if any)
    signal_seat: int | None = None  # who declared


@dataclass
class RoundState:
    number: int
    briscola: Suit | None = None
    cricca: bool = False
    caller_seat: int = 0
    hands_played: list[TrickRecord] = field(default_factory=list)
    current_trick: list[tuple[int, Card]] = field(default_factory=list)
    trick_starter: int = 0
    trick_signals: list[tuple[int, Signal | None]] = field(default_factory=list)
    player_hands: dict[int, list[Card]] = field(default_factory=dict)


@dataclass
class GameResult:
    winner_team: int
    total_scores: dict[int, int]
    rounds_won: dict[int, int]


class BeccaGame:
    """Stateful Beccaccino game engine.

    Usage:
        game = BeccaGame(seed=42)
        while game.phase != GamePhase.GAME_OVER:
            seat = game.current_seat
            actions = game.legal_actions()
            game.step(action)
    """

    def __init__(self, seed: int | None = None, win_points: int = WIN_POINTS):
        self.rng = random.Random(seed)
        self.win_points = win_points
        self.total_scores = {0: 0, 1: 0}  # team -> cumulative raw points
        self.rounds_won = {0: 0, 1: 0}
        self.round_number = 0
        self.round: RoundState | None = None
        self.phase = GamePhase.CHOOSE_BRISCOLA
        self.result: GameResult | None = None

        self._start_new_round()

    @property
    def current_seat(self) -> int:
        """Which seat must act next."""
        if self.phase == GamePhase.CHOOSE_BRISCOLA:
            return self.round.caller_seat
        elif self.phase == GamePhase.PLAY_CARD:
            trick = self.round.current_trick
            return (self.round.trick_starter + len(trick)) % 4
        return -1

    def legal_actions(self) -> list:
        """Return legal actions for current_seat.

        In CHOOSE_BRISCOLA phase: list of Suit values.
        In PLAY_CARD phase: list of (Card, Signal|None) tuples if trick leader,
                           else list of Card.
        """
        if self.phase == GamePhase.CHOOSE_BRISCOLA:
            return list(Suit)

        if self.phase == GamePhase.PLAY_CARD:
            seat = self.current_seat
            hand = self.round.player_hands[seat]

            if len(self.round.current_trick) == 0:
                # Trick leader: can play any card, optionally with signal
                signals = [None, Signal.STRISCIO, Signal.BUSSO, Signal.VOLO]
                return [(card, sig) for card in hand for sig in signals]
            else:
                lead_suit = self.round.current_trick[0][1].suit
                playable = follow_suit_filter(hand, lead_suit)
                return playable

        return []

    def step(self, action) -> dict:
        """Execute one action. Returns info dict with event details.

        For CHOOSE_BRISCOLA: action is a Suit.
        For PLAY_CARD as trick leader: action is (Card, Signal|None).
        For PLAY_CARD as follower: action is a Card.
        """
        if self.phase == GamePhase.GAME_OVER:
            raise ValueError("Game is already over")

        if self.phase == GamePhase.CHOOSE_BRISCOLA:
            return self._choose_briscola(action)

        if self.phase == GamePhase.PLAY_CARD:
            return self._play_card(action)

        if self.phase == GamePhase.ROUND_END:
            raise ValueError("Round ended — call advance_round() or check game_over")

        return {}

    def get_hand(self, seat: int) -> list[Card]:
        """Get cards currently in a player's hand."""
        if self.round is None:
            return []
        return list(self.round.player_hands.get(seat, []))

    def get_observation(self, seat: int) -> dict:
        """Get the observable state from one player's perspective.

        This is the imperfect-information observation: a player can see their own hand,
        cards played on the table, trick history (who won, what was played), signals,
        but NOT other players' hands.
        """
        r = self.round
        return {
            "phase": self.phase.value,
            "my_seat": seat,
            "my_team": TEAM_OF_SEAT[seat],
            "my_hand": list(r.player_hands.get(seat, [])),
            "briscola": r.briscola,
            "round_number": r.number,
            "hand_number": len(r.hands_played) + 1,
            "current_trick": list(r.current_trick),
            "trick_starter": r.trick_starter,
            "trick_signals": list(r.trick_signals),
            "hands_played": [(tr.winner, tr.cards) for tr in r.hands_played],
            "signals_history": [(tr.signal_seat, tr.signal) for tr in r.hands_played],
            "total_scores": dict(self.total_scores),
            "rounds_won": dict(self.rounds_won),
            "caller_seat": r.caller_seat,
            "is_my_turn": self.current_seat == seat,
        }

    def _start_new_round(self):
        self.round_number += 1

        # Determine caller
        if self.round_number == 1:
            caller_seat = -1  # will be set after dealing (whoever gets 4 di denara)
        else:
            caller_seat = (self.round.caller_seat + 1) % 4

        # Deal cards
        deck = list(DECK)
        self.rng.shuffle(deck)

        player_hands: dict[int, list[Card]] = {}
        for seat in range(4):
            player_hands[seat] = deck[seat * 10 : (seat + 1) * 10]

        # Round 1: find who has quattro di denara
        if self.round_number == 1:
            quattro_denara = Card(Suit.DENARA, Value.QUATTRO)
            for seat in range(4):
                if quattro_denara in player_hands[seat]:
                    caller_seat = seat
                    break

        self.round = RoundState(
            number=self.round_number,
            caller_seat=caller_seat,
            player_hands=player_hands,
            trick_starter=caller_seat,
        )
        self.phase = GamePhase.CHOOSE_BRISCOLA

    def _choose_briscola(self, suit: Suit) -> dict:
        if not isinstance(suit, Suit):
            raise ValueError(f"Expected a Suit, got {suit}")

        self.round.briscola = suit
        self.round.trick_starter = self.round.caller_seat
        self.phase = GamePhase.PLAY_CARD

        # Check for Cricca: caller has Tre + Due + Asso of chosen briscola suit
        caller_hand = self.round.player_hands[self.round.caller_seat]
        self.round.cricca = detect_cricca(caller_hand, suit)

        return {
            "event": "briscola_chosen",
            "suit": suit,
            "caller": self.round.caller_seat,
            "cricca": self.round.cricca,
        }

    def _play_card(self, action) -> dict:
        seat = self.current_seat
        hand = self.round.player_hands[seat]
        is_leader = len(self.round.current_trick) == 0

        # Parse action
        if is_leader:
            if isinstance(action, tuple) and len(action) == 2:
                card, signal = action
            else:
                raise ValueError("Trick leader must provide (Card, Signal|None)")
        else:
            card = action
            signal = None

        # Validate card is in hand and legal
        if card not in hand:
            raise ValueError(f"Card {card} not in hand of seat {seat}")

        if not is_leader:
            lead_suit = self.round.current_trick[0][1].suit
            playable = follow_suit_filter(hand, lead_suit)
            if card not in playable:
                raise ValueError(f"Card {card} not playable (must follow suit {lead_suit})")

        # Play the card
        hand.remove(card)
        self.round.current_trick.append((seat, card))
        self.round.trick_signals.append((seat, signal))

        info = {
            "event": "card_played",
            "seat": seat,
            "card": card,
            "signal": signal,
            "trick_position": len(self.round.current_trick) - 1,
        }

        # Check if trick is complete
        if len(self.round.current_trick) == 4:
            winner_seat = determine_hand_winner(self.round.current_trick, self.round.briscola)

            # Extract leader's signal from this trick
            leader_signal = None
            leader_seat = None
            if self.round.trick_signals:
                leader_seat, leader_signal = self.round.trick_signals[0]

            self.round.hands_played.append(TrickRecord(
                winner=winner_seat,
                cards=list(self.round.current_trick),
                signal=leader_signal,
                signal_seat=leader_seat,
            ))

            info["trick_winner"] = winner_seat
            info["event"] = "trick_complete"

            # Reset for next trick
            self.round.current_trick = []
            self.round.trick_signals = []
            self.round.trick_starter = winner_seat

            # Check if round is complete (10 hands)
            if len(self.round.hands_played) == 10:
                return self._end_round(info)

        return info

    def _end_round(self, info: dict) -> dict:
        hands_for_scoring = [(tr.winner, tr.cards) for tr in self.round.hands_played]
        scores = compute_round_scores(hands_for_scoring, TEAM_OF_SEAT)

        # Apply Cricca bonus: +3 points (= +9 raw) to the caller's team
        if self.round.cricca:
            caller_team = TEAM_OF_SEAT[self.round.caller_seat]
            team_key = f"team{caller_team}"
            scores[team_key]["raw"] += 9
            scores[team_key]["points"] += 3
            info["cricca"] = True
            info["cricca_team"] = caller_team

        # Accumulate
        self.total_scores[0] += scores["team0"]["raw"]
        self.total_scores[1] += scores["team1"]["raw"]

        # Determine round winner
        if scores["team0"]["points"] > scores["team1"]["points"]:
            round_winner = 0
        elif scores["team1"]["points"] > scores["team0"]["points"]:
            round_winner = 1
        elif scores["team0"]["figures"] > scores["team1"]["figures"]:
            round_winner = 0
        elif scores["team1"]["figures"] > scores["team0"]["figures"]:
            round_winner = 1
        else:
            round_winner = 0  # tie-break

        self.rounds_won[round_winner] += 1

        info["event"] = "round_end"
        info["round_scores"] = scores
        info["round_winner"] = round_winner

        # Check if game is over
        t0_pts = self.total_scores[0] // 3
        t1_pts = self.total_scores[1] // 3
        if t0_pts >= self.win_points or t1_pts >= self.win_points:
            # If both teams cross threshold, higher score wins.
            # True tie: caller's team (briscola chooser) has advantage.
            if t0_pts >= self.win_points and t1_pts >= self.win_points:
                if t0_pts > t1_pts:
                    game_winner = 0
                elif t1_pts > t0_pts:
                    game_winner = 1
                else:
                    caller_team = TEAM_OF_SEAT[self.round.caller_seat]
                    game_winner = caller_team
            else:
                game_winner = 0 if t0_pts >= self.win_points else 1
            self.phase = GamePhase.GAME_OVER
            self.result = GameResult(
                winner_team=game_winner,
                total_scores={0: t0_pts, 1: t1_pts},
                rounds_won=dict(self.rounds_won),
            )
            info["event"] = "game_over"
            info["game_winner"] = game_winner
        else:
            self._start_new_round()
            info["new_round"] = self.round_number

        return info
