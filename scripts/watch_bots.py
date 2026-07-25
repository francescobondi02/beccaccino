"""Watch a tier play a full game, and report how it uses briscola and signals.

This is the diagnostic the models have never had: the win-rate numbers say a
checkpoint beats the heuristic, but nothing says whether its briscola choices are
sensible or whether striscio/busso/volo mean anything to it.

    python -m scripts.watch_bots --tier forte --games 20
    python -m scripts.watch_bots --tier forte --games 1 --trace

Signal honesty is judged against the conventional meanings:
  busso   "I have strength in this suit" — asks the partner to play high
  volo    "this is my last card of the suit" — a void is coming
  striscio"I have length in this suit"
We can check volo and busso against the declarer's actual hidden hand, which is
the closest thing to a ground truth we have.
"""

from __future__ import annotations

import argparse
from collections import Counter

from becca_env.deck import Suit, Value, card_strength
from becca_env.game import BeccaGame, GamePhase, Signal
from serving.tiers import TIERS, get_agent

DEFAULT_GAMES = 20
GAME_SEED_BASE = 5000

# A busso claims strength in the suit. Asso and above (asso/due/tre) back that
# claim — they are the point-carrying cards that can actually win the trick.
BUSSO_STRENGTH_FLOOR = card_strength[Value.ASSO]

# A striscio claims length: at least one more card of the suit still in hand.
STRISCIO_MIN_REMAINING = 2


class SignalAudit:
    """Tallies whether declared signals were consistent with the declarer's hand."""

    def __init__(self) -> None:
        self.declared: Counter[str] = Counter()
        self.truthful: Counter[str] = Counter()
        self.leads = 0

    def record(self, signal: Signal | None, hand_after: list, suit: Suit) -> None:
        self.leads += 1
        if signal is None:
            return

        self.declared[signal.value] += 1
        if self._is_truthful(signal, hand_after, suit):
            self.truthful[signal.value] += 1

    @staticmethod
    def _is_truthful(signal: Signal, hand_after: list, suit: Suit) -> bool:
        """Is the claim consistent with what the declarer still holds?

        `hand_after` is the hand once the led card is gone, which is what the
        signal is about: volo says "that was my last one".
        """
        same_suit = [c for c in hand_after if c.suit == suit]
        if signal is Signal.VOLO:
            return not same_suit
        if signal is Signal.STRISCIO:
            return len(same_suit) >= STRISCIO_MIN_REMAINING
        return any(card_strength[c.value] >= BUSSO_STRENGTH_FLOOR for c in same_suit)

    def report(self) -> str:
        if not self.declared:
            return (
                f"  signals: NONE in {self.leads} leads — the policy never signals.\n"
                "           Signals are observable but unrewarded, so this is the\n"
                "           likely outcome; it means the cooperative channel is unused."
            )
        lines = [f"  signals: {sum(self.declared.values())} declared in {self.leads} leads"]
        for name in sorted(self.declared):
            declared = self.declared[name]
            truthful = self.truthful[name]
            lines.append(
                f"    {name:9} {declared:4}x  consistent with hand: "
                f"{truthful}/{declared} ({truthful / declared:.0%})"
            )
        return "\n".join(lines)


def play_game(agent, seed: int, audit: SignalAudit, briscolas: Counter, trace: bool) -> None:
    game = BeccaGame(seed=seed)

    while game.phase != GamePhase.GAME_OVER:
        seat = game.current_seat
        is_lead = game.phase == GamePhase.PLAY_CARD and not game.round.current_trick
        action = agent.select_action(game, seat)

        if game.phase == GamePhase.CHOOSE_BRISCOLA:
            briscolas[action.value] += 1
            if trace:
                held = sum(1 for c in game.get_hand(seat) if c.suit == action)
                print(f"  seat {seat} calls briscola {action.value} (holds {held})")
            game.step(action)
            continue

        card, signal = action if is_lead else (action, None)
        game.step(action)

        if is_lead:
            audit.record(signal, game.get_hand(seat), card.suit)
        if trace:
            tag = f" [{signal.value}]" if signal else ""
            print(f"  seat {seat} plays {card.value.value} di {card.suit.value}{tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tier", default="forte", choices=sorted(TIERS))
    parser.add_argument("--games", type=int, default=DEFAULT_GAMES)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--trace", action="store_true", help="print every move")
    args = parser.parse_args()

    agent = get_agent(args.tier, args.temperature)
    audit = SignalAudit()
    briscolas: Counter[str] = Counter()

    for i in range(args.games):
        if args.trace:
            print(f"--- game {i + 1} ---")
        play_game(agent, GAME_SEED_BASE + i, audit, briscolas, args.trace)

    print(f"\ntier={args.tier} temperature={args.temperature} games={args.games}")
    print(f"  briscola calls: {dict(briscolas.most_common())}")
    print(audit.report())


if __name__ == "__main__":
    main()
