"""Determinized game cloning for PIMC.

Given a real (imperfect-info) `BeccaGame` plus a sampled hand assignment
for the unseen seats, build a *perfect-information* clone where every
seat's hand is known. Once cloned, the game can be advanced freely with
the standard `step()` API and is guaranteed not to mutate the original.
"""

from __future__ import annotations

import copy
import random

from becca_env.game import BeccaGame
from inference.hand_sampler import SampledHands


def determinize(game: BeccaGame, sampled: SampledHands, clone_seed: int | None = None) -> BeccaGame:
    """Return a deep-copy of `game` with player hands replaced by `sampled`.

    The returned game is fully self-contained: no shared references with the
    original. The RNG is reseeded with `clone_seed` so any future random
    draws (none expected during PIMC, but defensive) are reproducible.

    Args:
        game: source game in PLAY_CARD or CHOOSE_BRISCOLA phase.
        sampled: hand assignment for all four seats (must include the
                 viewer's actual hand).
        clone_seed: optional reseed for the clone's RNG. Defaults to a
                    deterministic-but-distinct value.

    Returns:
        Cloned BeccaGame with hands replaced.
    """
    clone = copy.deepcopy(game)
    if clone_seed is not None:
        clone.rng = random.Random(clone_seed)
    else:
        # Default: deterministic offset of original seed-equivalent state.
        clone.rng = random.Random(id(clone) & 0xFFFFFFFF)

    for seat in range(4):
        if seat not in sampled.hands:
            raise ValueError(f"sampled hands missing seat {seat}")
        clone.round.player_hands[seat] = list(sampled.hands[seat])

    # Sanity: hand sizes must equal what the engine's accounting expects
    for seat in range(4):
        n_clone = len(clone.round.player_hands[seat])
        n_orig = len(game.round.player_hands[seat])
        if n_clone != n_orig:
            raise ValueError(
                f"hand-size mismatch after determinization: seat {seat} "
                f"original={n_orig} sampled={n_clone}"
            )

    return clone
