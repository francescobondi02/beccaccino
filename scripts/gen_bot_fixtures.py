"""Generate the cross-language fixtures the backend serializer is checked against.

Layer 2b of the bot-play fidelity strategy (docs/BOT_PLAY_DESIGN.md §5.3b). The
Python parity tests only prove Python agrees with itself; nothing there exercises
the TypeScript serializer. These fixtures close that gap: each case pairs the
state DTO the backend must produce with the observation it must yield, so a
backend test can assert its own serializer output against a known-good DTO.

    python -m scripts.gen_bot_fixtures

Cases deliberately target the blocks a naive serializer drops — cumulative scores
in raw units, the whole round's tricks, signals, voids, and left/right seats —
because those do not change which cards are legal, so the runtime 409 gate
(§5.3) cannot catch them.
"""

from __future__ import annotations

import json
from pathlib import Path

from becca_env.deck import Suit
from becca_env.game import BeccaGame, Signal
from becca_env.observation import encode_observation
from serving.state_adapter import game_to_state_dict

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "serving" / "fixtures" / "bot_states.json"
SEED = 7
# Raw points chosen so points//3 has a non-zero remainder: a serializer that
# sends real points and drops the figures column produces a different vector.
RAW_SCORES_WITH_REMAINDER = {0: 37, 1: 14}


def _lead_with_signal(game: BeccaGame, signal: Signal) -> None:
    """Lead a non-briscola card carrying `signal`, then finish the trick."""
    hand = game.round.player_hands[game.current_seat]
    card = next(c for c in hand if c.suit != game.round.briscola)
    game.step((card, signal))
    while game.round.current_trick:
        game.step(game.legal_actions()[0])


def _case(name: str, description: str, game: BeccaGame, seat: int) -> dict:
    return {
        "name": name,
        "description": description,
        "seat": seat,
        "state": game_to_state_dict(game, seat),
        "expected_obs": encode_observation(game, seat).tolist(),
    }


def build_cases() -> list[dict]:
    cases = []

    game = BeccaGame(seed=SEED)
    cases.append(
        _case(
            "briscola_choice",
            "Caller must pick briscola; no tricks played yet.",
            game,
            game.current_seat,
        )
    )

    game = BeccaGame(seed=SEED)
    game.step(Suit.DENARA)
    cases.append(
        _case(
            "first_lead",
            "Briscola set, empty trick — the simplest play_card position.",
            game,
            game.current_seat,
        )
    )

    game = BeccaGame(seed=SEED)
    game.step(Suit.DENARA)
    _lead_with_signal(game, Signal.BUSSO)
    _lead_with_signal(game, Signal.VOLO)
    game.step(game.legal_actions()[0])  # leave a trick in progress
    cases.append(
        _case(
            "signals_and_void_mid_trick",
            "Two completed tricks with signals, a trick in progress, voids deduced. "
            "Catches a serializer that sends only the latest hand.",
            game,
            game.current_seat,
        )
    )

    game = BeccaGame(seed=SEED)
    game.step(Suit.DENARA)
    _lead_with_signal(game, Signal.STRISCIO)
    game.total_scores = dict(RAW_SCORES_WITH_REMAINDER)
    cases.append(
        _case(
            "cumulative_raw_scores",
            "Scores carry a figures remainder (raw 37 = 12 points + 1 figure). "
            "Catches summing team0Points without team0Figures.",
            game,
            game.current_seat,
        )
    )

    # Same position from every seat: the relative-seat rows (left opp / partner /
    # right opp) differ per viewer, so a rotation bug shows up here.
    game = BeccaGame(seed=SEED)
    game.step(Suit.DENARA)
    _lead_with_signal(game, Signal.BUSSO)
    cases += [
        _case(
            f"all_seats_view_seat{seat}",
            f"Identical board encoded from seat {seat}; catches seat rotation.",
            game,
            seat,
        )
        for seat in range(4)
    ]

    return cases


def main() -> None:
    cases = build_cases()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps({"cases": cases}, indent=2) + "\n")
    print(f"wrote {len(cases)} cases to {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
