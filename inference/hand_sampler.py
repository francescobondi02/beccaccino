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

  4. **Forced-play deduction** — currently NOT used (could deduce e.g.
     "if s played the only X they had, they have no more X"). This is a
     proper subset of the void mask anyway and the void mask captures
     the strongest deduction, so we keep the sampler simple.

The sampling problem is therefore: distribute the unseen cards among the
three other seats such that each seat gets exactly its hand_size and no
seat gets a forbidden suit. We solve this by:

  - Decomposing unseen cards by suit.
  - For each suit, the "eligible seats" are those NOT void in that suit.
  - For each suit, randomly distribute its cards among eligible seats,
    while respecting per-seat remaining capacity.
  - When the distribution would over-fill a seat or under-fill another
    (which can happen if eligibility constraints are tight), we retry.
  - Capped at MAX_RETRIES; falls back to ignoring void on the final
    retries to guarantee progress (rare; logged as `relaxed=True`).

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
    relaxed: bool = False  # True if void constraints were relaxed to succeed


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
    max_retries: int = 20,
) -> SampledHands:
    """Sample one plausible assignment of unseen cards to the three other seats.

    Args:
        game: current game state. Must be in PLAY_CARD phase (sampling
              before briscola is chosen is meaningless — the caller's own
              hand is unknown to no one).
        viewer_seat: the seat from whose perspective we sample. Their hand
                     is taken as-is (perfectly known to themselves).
        rng: a Python `random.Random` (seedable for reproducibility).
        max_retries: how many times to retry if void constraints make the
                     sampling infeasible. After half the retries we relax
                     the void constraint as a last resort.

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

    for attempt in range(max_retries):
        relax = attempt >= max_retries // 2
        result = _try_assign(unseen, other_seats, target_sizes, voids, rng, relax)
        if result is not None:
            hands = {viewer_seat: list(my_hand), **result}
            return SampledHands(hands=hands, relaxed=relax)

    # Last-ditch fallback: ignore void entirely. With hand sizes correct
    # this always succeeds as a plain partition.
    rng.shuffle(unseen)
    fallback: dict[int, list[Card]] = {}
    cursor = 0
    for s in other_seats:
        fallback[s] = unseen[cursor : cursor + target_sizes[s]]
        cursor += target_sizes[s]
    return SampledHands(
        hands={viewer_seat: list(my_hand), **fallback},
        relaxed=True,
    )


def _try_assign(
    unseen: list[Card],
    other_seats: list[int],
    target_sizes: dict[int, int],
    voids: dict[int, set[Suit]],
    rng: random.Random,
    relax: bool,
) -> dict[int, list[Card]] | None:
    """One attempt: distribute `unseen` to `other_seats` honoring sizes and voids.

    Approach: per-suit greedy randomized fill with capacity tracking.
    Returns None on infeasibility (caller will retry or relax).
    """
    by_suit: dict[Suit, list[Card]] = defaultdict(list)
    for c in unseen:
        by_suit[c.suit].append(c)

    capacity = {s: target_sizes[s] for s in other_seats}
    out: dict[int, list[Card]] = {s: [] for s in other_seats}

    suits_in_random_order = list(by_suit.keys())
    rng.shuffle(suits_in_random_order)

    for suit in suits_in_random_order:
        cards = list(by_suit[suit])
        rng.shuffle(cards)

        if relax:
            eligible = list(other_seats)
        else:
            eligible = [s for s in other_seats if suit not in voids[s]]
        if not eligible:
            return None  # nobody can take this suit → infeasible

        # Distribute cards to eligible seats while respecting capacity
        for card in cards:
            choices = [s for s in eligible if capacity[s] > 0]
            if not choices:
                return None  # all eligible seats full but suit cards remain
            chosen = rng.choice(choices)
            out[chosen].append(card)
            capacity[chosen] -= 1

    # Final size check (defensive — should pass by construction)
    for s in other_seats:
        if len(out[s]) != target_sizes[s]:
            return None

    return out
