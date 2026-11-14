"""Core game rules: follow-suit, trick winner, scoring."""

from becca_env.deck import Card, Suit, Value, card_points, card_strength


def detect_cricca(hand: list[Card], briscola_suit: Suit) -> bool:
    """Detect Cricca: the caller holds Tre + Due + Asso of the briscola suit.

    If true, the caller's team gets +3 points at end of the round.
    """
    required = {Value.TRE, Value.DUE, Value.ASSO}
    briscola_values = {c.value for c in hand if c.suit == briscola_suit}
    return required.issubset(briscola_values)


def follow_suit_filter(hand: list[Card], lead_suit: Suit) -> list[Card]:
    """Return playable cards given the lead suit.

    If the player has cards matching lead_suit, they must play one of those.
    Otherwise, they can play any card.
    """
    matching = [c for c in hand if c.suit == lead_suit]
    return matching if matching else hand


def determine_trick_winner(played_cards: list[tuple[int, Card]], briscola: Suit | None) -> int:
    """Determine which player (seat index) wins the trick.

    Args:
        played_cards: list of (seat, Card) in play order
        briscola: the trump suit for this round (None if not yet chosen — shouldn't happen)

    Returns:
        seat index of the winner
    """
    if not played_cards:
        raise ValueError("No cards played")

    lead_suit = played_cards[0][1].suit
    has_briscola = briscola is not None and any(c.suit == briscola for _, c in played_cards)

    best_seat = -1
    best_strength = -1

    for seat, card in played_cards:
        if has_briscola:
            if card.suit != briscola:
                continue
        else:
            if card.suit != lead_suit:
                continue

        strength = card_strength[card.value]
        if strength > best_strength:
            best_strength = strength
            best_seat = seat

    if best_seat == -1:
        raise ValueError("No valid winner found — logic error")

    return best_seat


def compute_round_scores(
    tricks: list[tuple[int, list[tuple[int, Card]]]],
    team_of_seat: dict[int, int],
) -> dict[str, dict[str, int]]:
    """Compute scores for a completed round (10 tricks).

    Args:
        tricks: list of (winner_seat, played_cards) for each trick
        team_of_seat: mapping seat -> team (0 or 1)

    Returns:
        {"team0": {"raw": N, "points": N, "figures": N},
         "team1": {"raw": N, "points": N, "figures": N}}
    """
    raw_scores = {0: 0, 1: 0}

    for i, (winner_seat, cards) in enumerate(tricks):
        team = team_of_seat[winner_seat]
        for _, card in cards:
            raw_scores[team] += card_points[card.value]

        # Last trick bonus: +3 raw (= +1 real point)
        if i == len(tricks) - 1:
            raw_scores[team] += 3

    def fmt(raw: int) -> dict[str, int]:
        return {"raw": raw, "points": raw // 3, "figures": raw % 3}

    return {"team0": fmt(raw_scores[0]), "team1": fmt(raw_scores[1])}
