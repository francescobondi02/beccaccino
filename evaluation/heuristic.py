"""Heuristic baseline agent for Beccaccino.

A simple but non-trivial rule-based player. Strong enough to be a meaningful
benchmark — a network that doesn't beat this is essentially random.

Strategy:
  - Briscola choice: pick the suit with the highest "hand strength" score
    (count + sum of card_strength of cards we hold in that suit).
  - Trick leader: lead the lowest non-briscola card we hold (saves trumps),
    no signal. If we only have briscola, lead the lowest briscola.
  - Follower (must follow suit, has lead-suit cards):
      * If partner is winning and we are LAST to play (trick can no longer be
        stolen), load our highest-point card (carico) onto the guaranteed win.
      * Else if our highest card in the suit beats whatever's currently winning
        the trick, play the MINIMUM card that still wins it.
      * Otherwise dump the lowest-point card in the suit.
  - Follower (free play — out of lead suit):
      * If partner is winning and we are LAST to play, load our highest-point
        non-briscola (carico) onto the win without wasting a trump.
      * Else if partner is winning, dump our lowest-point non-briscola.
      * Else, the opponent is winning. If the trick contains worthwhile points
        (>=3 raw, i.e. an Asso), trump with our LOWEST briscola that would
        win. Otherwise dump the lowest-point non-briscola.

We only load carichi when last to play, since then the trick is guaranteed:
detecting a guaranteed win earlier would require cross-trick card counting,
deliberately out of scope for this baseline.

This is deliberately straightforward and deterministic so the test suite can
pin its behavior on hand-crafted positions.
"""

from __future__ import annotations

import random

from becca_env.deck import Card, Suit, card_points, card_strength
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase
from becca_env.rules import determine_hand_winner, follow_suit_filter


def _hand_strength_for_suit(hand: list[Card], suit: Suit) -> float:
    """Score how good this suit would be as briscola given our hand."""
    cards_in_suit = [c for c in hand if c.suit == suit]
    if not cards_in_suit:
        return 0.0
    return len(cards_in_suit) + 0.5 * sum(card_strength[c.value] for c in cards_in_suit) / 10.0


def _lowest_point_card(cards: list[Card]) -> Card:
    """Return the card with the fewest points; tie-break by lower strength."""
    return min(cards, key=lambda c: (card_points[c.value], card_strength[c.value]))


def _lowest_strength_card(cards: list[Card]) -> Card:
    return min(cards, key=lambda c: card_strength[c.value])


def _highest_point_card(cards: list[Card]) -> Card:
    """Return the card with the most points (carico); tie-break by higher strength."""
    return max(cards, key=lambda c: (card_points[c.value], card_strength[c.value]))


def _current_trick_winner(game: BeccaGame) -> tuple[int, Card] | None:
    """Who is currently winning the partial trick (or None if empty)?"""
    trick = game.round.current_trick
    if not trick:
        return None
    winner_seat = determine_hand_winner(trick, game.round.briscola)
    winner_card = next(c for s, c in trick if s == winner_seat)
    return winner_seat, winner_card


def _trick_raw_points(trick: list[tuple[int, Card]]) -> int:
    return sum(card_points[c.value] for _, c in trick)


class HeuristicAgent:
    """Rule-based Beccaccino player. Returns actions in the same format as legal_actions()."""

    def __init__(self, seed: int | None = None):
        # RNG only used for breaking ties deterministically when caller passes seed
        self.rng = random.Random(seed)

    # ------------------------- public API -------------------------

    def select_action(self, game: BeccaGame, seat: int) -> object:
        if game.phase == GamePhase.CHOOSE_BRISCOLA:
            return self._choose_briscola(game, seat)
        if game.phase == GamePhase.PLAY_CARD:
            hand = game.round.player_hands[seat]
            is_leader = len(game.round.current_trick) == 0
            if is_leader:
                card = self._lead(hand, game.round.briscola)
                return (card, None)
            return self._follow(game, seat, hand)
        raise ValueError(f"HeuristicAgent: unexpected phase {game.phase}")

    # ------------------------- briscola -------------------------

    def _choose_briscola(self, game: BeccaGame, seat: int) -> Suit:
        hand = game.round.player_hands[seat]
        return max(Suit, key=lambda s: _hand_strength_for_suit(hand, s))

    # ------------------------- lead -------------------------

    def _lead(self, hand: list[Card], briscola: Suit) -> Card:
        non_briscola = [c for c in hand if c.suit != briscola]
        pool = non_briscola if non_briscola else hand
        return _lowest_point_card(pool)

    # ------------------------- follow -------------------------

    def _follow(self, game: BeccaGame, seat: int, hand: list[Card]) -> Card:
        trick = game.round.current_trick
        lead_suit = trick[0][1].suit
        briscola = game.round.briscola
        playable = follow_suit_filter(hand, lead_suit)

        cur = _current_trick_winner(game)
        # cur is guaranteed not None: trick is non-empty since we're following
        cur_seat, cur_card = cur
        partner_winning = TEAM_OF_SEAT[cur_seat] == TEAM_OF_SEAT[seat]
        # We are last to play iff the trick already holds the other 3 cards.
        is_last = len(trick) == 3

        # Must follow suit
        if all(c.suit == lead_suit for c in playable):
            return self._follow_in_suit(playable, cur_card, briscola, partner_winning, is_last)

        # Free play (no cards in lead suit)
        return self._follow_free(playable, trick, briscola, partner_winning, is_last)

    def _follow_in_suit(
        self,
        playable: list[Card],
        cur_winning_card: Card,
        briscola: Suit,
        partner_winning: bool,
        is_last: bool,
    ) -> Card:
        """We have lead-suit cards, must play one of them."""
        # If current winner is a briscola (someone trumped before us) and we
        # don't have briscola in the suit, we can't win — dump lowest points.
        cur_is_briscola = cur_winning_card.suit == briscola

        if partner_winning:
            # Last to play → trick is safe, load a carico onto the win.
            # Otherwise a later opponent might steal it, so dump cheap.
            return _highest_point_card(playable) if is_last else _lowest_point_card(playable)

        if cur_is_briscola:
            # Can't beat trump with non-trump
            return _lowest_point_card(playable)

        # Opponent winning with lead-suit card; can we beat it?
        winners = [
            c for c in playable
            if c.suit == cur_winning_card.suit
            and card_strength[c.value] > card_strength[cur_winning_card.value]
        ]
        if winners:
            # Play the cheapest *winning* card (min strength among winners)
            return _lowest_strength_card(winners)
        return _lowest_point_card(playable)

    def _follow_free(
        self,
        playable: list[Card],
        trick: list[tuple[int, Card]],
        briscola: Suit,
        partner_winning: bool,
        is_last: bool,
    ) -> Card:
        """Out of lead suit — can play anything."""
        non_briscola = [c for c in playable if c.suit != briscola]
        briscole = [c for c in playable if c.suit == briscola]

        if partner_winning:
            # Don't waste trumps on partner's win. Last to play → the trick is
            # safe, so load our highest-point non-briscola (carico); otherwise
            # dump the cheapest.
            pool = non_briscola if non_briscola else briscole
            return _highest_point_card(pool) if is_last else _lowest_point_card(pool)

        # Opponent winning. Trump if the trick is worth it AND we have briscola.
        trick_pts = _trick_raw_points(trick)
        if briscole and trick_pts >= 3:
            return _lowest_strength_card(briscole)

        # Not worth trumping; dump cheap non-briscola
        if non_briscola:
            return _lowest_point_card(non_briscola)
        return _lowest_strength_card(briscole)


# ------------------------- evaluation helpers -------------------------


def play_match_heuristic(team0_agent, team1_agent, num_games: int, win_points: int = 41,
                         seed: int = 0) -> tuple[int, int]:
    """Play num_games between two agents. Returns (team0_wins, team1_wins).

    Avoids importing from arena.py to keep this module self-contained.
    """
    t0 = 0
    t1 = 0
    for i in range(num_games):
        game = BeccaGame(seed=seed + i, win_points=win_points)
        while game.phase != GamePhase.GAME_OVER:
            seat = game.current_seat
            agent = team0_agent if TEAM_OF_SEAT[seat] == 0 else team1_agent
            game.step(agent.select_action(game, seat))
        if game.result.winner_team == 0:
            t0 += 1
        else:
            t1 += 1
    return t0, t1


def evaluate_against_heuristic(
    net,
    num_games: int = 200,
    device=None,
    seed: int = 0,
    win_points: int = 41,
) -> float:
    """Win rate of the trained net vs HeuristicAgent. Plays half on each side."""
    import torch

    from evaluation.arena import NeuralAgent

    if device is None:
        device = torch.device("cpu")

    neural = NeuralAgent(net, device, temperature=0.0)
    heur = HeuristicAgent(seed=seed + 10000)
    half = num_games // 2

    t0_a, t1_a = play_match_heuristic(neural, heur, num_games=half, seed=seed,
                                      win_points=win_points)
    t0_b, t1_b = play_match_heuristic(heur, neural, num_games=half, seed=seed + half,
                                      win_points=win_points)

    # neural was team0 in match A, team1 in match B
    neural_wins = t0_a + t1_b
    return neural_wins / (2 * half)
