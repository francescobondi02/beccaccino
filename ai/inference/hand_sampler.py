"""Hand sampler for PIMC: produce plausible (partner, opp_left, opp_right)
hand assignments given the public information.

The viewer's own hand is fully known (no sampling needed for it). For the
other three seats, we know:

  1. Hand sizes — each seat starts with 10 cards and plays 1 per trick.
     So if k tricks have completed and the in-progress trick has p cards
     played, hand_size[s] = 10 - tricks_completed - (1 if s already
     played in current trick else 0).

  2. Cards already revealed (in completed tricks + in-progress trick) are
     OFF the unseen pool.

  3. **Void constraint** — if seat s failed to follow a lead suit S in any
     prior trick, s has no S in their CURRENT hand either (they would
     have followed if they could). So the cards we deal to s must
     exclude suit S.

  4. Card-choice strategy is not treated as hand evidence. The sampler has no
     calibrated model of the other players' policies, so observed legal choices
     constrain worlds only through revealed cards and follow-suit failures.

The sampling problem is therefore: distribute the unseen cards among the
three other seats such that each seat gets exactly its hand_size and no
seat gets a forbidden suit. We solve this by:

  - Decomposing unseen cards by suit.
  - For each suit, the "eligible seats" are those NOT void in that suit.
  - For each suit, randomly distribute its cards among eligible seats,
    while respecting per-seat remaining capacity.
  - Solve the four-suit capacity allocation exactly with backtracking, then
    randomly assign concrete cards inside that feasible allocation.

Output: dict `{seat -> list[Card]}` where each list has the right size and
satisfies all hard constraints (cards are unique across seats, total set
equals the unseen pool).
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass

from becca_env.deck import DECK, Card, Suit
from becca_env.game import BeccaGame, GamePhase


@dataclass
class SampledHands:
    """Result of one determinization attempt."""

    hands: dict[int, list[Card]]
    relaxed: bool = False  # Kept for checkpoint/API compatibility; always False.


class InfeasibleHandConstraintsError(ValueError):
    """The public cards, hand sizes, and proven voids have no joint assignment."""


def _public_cards(game: BeccaGame) -> set[Card]:
    """Cards visible to everyone: completed tricks + in-progress trick."""
    seen: set[Card] = set()
    for tr in game.round.hands_played:
        for _, c in tr.cards:
            seen.add(c)
    for _, c in game.round.current_trick:
        seen.add(c)
    return seen


def _seat_hand_sizes(game: BeccaGame) -> dict[int, int]:
    """How many cards does each seat currently hold?

    Reads `game.round.player_hands` directly. We trust the engine; if the
    sampler is called for a determinization wrapper that doesn't have real
    hands, the caller must override this.
    """
    return {s: len(game.round.player_hands[s]) for s in range(4)}


def _void_suits_per_seat(game: BeccaGame) -> dict[int, set[Suit]]:
    """For each seat, the set of suits that seat is *known* void in.

    Void deduction: if seat S played a non-lead-suit card on a trick whose
    lead was L, then S has no L in hand. Applies to completed tricks and
    the in-progress trick.
    """
    voids: dict[int, set[Suit]] = {s: set() for s in range(4)}
    r = game.round
    for tr in r.hands_played:
        if not tr.cards:
            continue
        lead_suit = tr.cards[0][1].suit
        for s, card in tr.cards[1:]:
            if card.suit != lead_suit:
                voids[s].add(lead_suit)
    if r.current_trick:
        lead_suit = r.current_trick[0][1].suit
        for s, card in r.current_trick[1:]:
            if card.suit != lead_suit:
                voids[s].add(lead_suit)
    return voids


def sample_opponent_hands(
    game: BeccaGame,
    viewer_seat: int,
    rng: random.Random,
) -> SampledHands:
    """Sample one plausible assignment of unseen cards to the three other seats.

    Args:
        game: current game state. Must be in PLAY_CARD phase (sampling
              before briscola is chosen is meaningless — the caller's own
              hand is unknown to no one).
        viewer_seat: the seat from whose perspective we sample. Their hand
                     is taken as-is (perfectly known to themselves).
        rng: a Python `random.Random` (seedable for reproducibility).
    Returns:
        SampledHands with `hands` mapping each of the four seats to a list
        of Cards. The viewer's own hand is included (copied verbatim).
    """
    if game.phase not in (GamePhase.PLAY_CARD, GamePhase.CHOOSE_BRISCOLA):
        raise ValueError(f"Cannot sample hands in phase {game.phase}")

    my_hand = list(game.round.player_hands[viewer_seat])
    other_seats = [s for s in range(4) if s != viewer_seat]

    seen = _public_cards(game) | set(my_hand)
    unseen = [c for c in DECK if c not in seen]

    target_sizes = _seat_hand_sizes(game)
    voids = _void_suits_per_seat(game)

    total_target = sum(target_sizes[s] for s in other_seats)
    if total_target != len(unseen):
        raise ValueError(
            f"hand-size sanity failed: unseen={len(unseen)} but seats "
            f"{other_seats} need {total_target} cards total"
        )

    result = _try_assign(unseen, other_seats, target_sizes, voids, rng)
    if result is None:
        raise InfeasibleHandConstraintsError(
            "no hand assignment satisfies public cards, hand sizes, and proven voids"
        )
    return SampledHands(hands={viewer_seat: list(my_hand), **result})


def _try_assign(
    unseen: list[Card],
    other_seats: list[int],
    target_sizes: dict[int, int],
    voids: dict[int, set[Suit]],
    rng: random.Random,
) -> dict[int, list[Card]] | None:
    """Find a randomized exact allocation honoring sizes and proven voids."""
    by_suit: dict[Suit, list[Card]] = defaultdict(list)
    for c in unseen:
        by_suit[c.suit].append(c)

    suit_specs = []
    for suit, cards in by_suit.items():
        eligible = tuple(seat for seat in other_seats if suit not in voids[seat])
        if cards and not eligible:
            return None
        suit_specs.append((suit, len(cards), eligible))
    rng.shuffle(suit_specs)
    suit_specs.sort(key=lambda spec: (len(spec[2]), -spec[1]))

    allocation: dict[Suit, dict[int, int]] = {}

    def solve(index: int, capacity: dict[int, int]) -> bool:
        if index == len(suit_specs):
            return all(remaining == 0 for remaining in capacity.values())
        suit, count, eligible = suit_specs[index]
        candidates = list(_bounded_compositions(count, eligible, capacity))
        rng.shuffle(candidates)
        for counts in candidates:
            next_capacity = dict(capacity)
            for seat, assigned in counts.items():
                next_capacity[seat] -= assigned
            if solve(index + 1, next_capacity):
                allocation[suit] = counts
                return True
        return False

    if not solve(0, {seat: target_sizes[seat] for seat in other_seats}):
        return None

    out: dict[int, list[Card]] = {seat: [] for seat in other_seats}
    for suit, cards in by_suit.items():
        shuffled = list(cards)
        rng.shuffle(shuffled)
        cursor = 0
        for seat in other_seats:
            count = allocation[suit].get(seat, 0)
            out[seat].extend(shuffled[cursor : cursor + count])
            cursor += count
    return out


def _bounded_compositions(
    total: int,
    seats: tuple[int, ...],
    capacity: dict[int, int],
):
    """Yield all ways to place one suit across eligible seats within capacity."""
    if not seats:
        if total == 0:
            yield {}
        return
    seat = seats[0]
    if len(seats) == 1:
        if total <= capacity[seat]:
            yield {seat: total}
        return
    for count in range(min(total, capacity[seat]) + 1):
        for rest in _bounded_compositions(total - count, seats[1:], capacity):
            yield {seat: count, **rest}
