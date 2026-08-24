"""Perfect-Information Monte Carlo (PIMC) at inference time.

Algorithm:
  For each action decision the viewer must make:
    1. Sample N determinizations (random plausible opponent hand assignments).
    2. For each determinization and each legal action:
         - clone the game, play that action,
         - then run a greedy policy rollout (V4 acts for everyone) for the
           rest of the round (or up to a depth limit),
         - read V4's value head at the leaf as the action's value under
           that determinization.
    3. Average each action's value across determinizations → pick argmax.

This is the textbook PIMC ("determinization + Monte Carlo") technique
that bridges the gap between perfect- and imperfect-info games. The
network handles the policy/value approximation; PIMC handles the
information uncertainty by averaging over plausible worlds.

Notes:
  - We use a *fixed-depth* rollout (full round end). Cricca/round-end
    scoring is computed by the engine itself via `_end_round` when the
    last trick lands, so the value at round end is exact in the
    determinized world.
  - For early-game decisions (before any tricks completed) the value
    head's uncertainty is large; PIMC averaging tames it.
  - For decisions inside the current trick, the engine's normal step()
    handles signal/follow-suit constraints; we just feed it the chosen
    card from the legal mask.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import numpy as np
import torch

from becca_env.deck import Card
from becca_env.game import BeccaGame, GamePhase, Signal
from becca_env.observation import (
    CARD_INDEX,
    decode_action,
    encode_action_mask,
    encode_observation,
)
from inference.determinized import determinize
from inference.hand_sampler import sample_opponent_hands


@dataclass
class PIMCConfig:
    num_determinizations: int = 20
    """How many sampled worlds we average over per decision."""

    rollout_depth_tricks: int = 10
    """How deep to roll out each (action, world) pair. 10 = full round."""

    discount: float = 1.0
    """Reward discounting between game steps. 1.0 since game is short."""

    rollout_policy: str = "heuristic"
    """Who plays during the rollout phase:
       'net'       — V4 net acts for everyone (uses self-play distribution)
       'heuristic' — HeuristicAgent acts for everyone (closer to typical
                     real opponents and removes net's training-distribution
                     bias). Recommended.
    """

    seed: int = 0
    """Master RNG seed; per-determinization seeds are derived from this."""


def _action_idx(card: Card, signal: Signal | None) -> int:
    """Convert a (card, signal) decision into a flat 160 action index."""
    sig_idx = 0 if signal is None else (list(Signal).index(signal) + 1)
    return CARD_INDEX[card] * 4 + sig_idx


def _greedy_action(
    net: torch.nn.Module,
    game: BeccaGame,
    seat: int,
    device: torch.device,
) -> int:
    """Pick the network's argmax-legal action for `seat` in `game`.

    Returns the flat action index (0..159).
    """
    obs = encode_observation(game, seat, obs_size=net.obs_size)
    mask = encode_action_mask(game, seat)
    obs_t = torch.from_numpy(obs).unsqueeze(0).to(device)
    mask_t = torch.from_numpy(mask).unsqueeze(0).to(device)
    with torch.no_grad():
        logits, _ = net.forward(obs_t, mask_t)
    return int(logits.argmax(dim=-1).item())


def _value_at(
    net: torch.nn.Module,
    game: BeccaGame,
    seat: int,
    device: torch.device,
) -> float:
    """Read V4's value head at the current state from `seat`'s viewpoint."""
    obs = encode_observation(game, seat, obs_size=net.obs_size)
    mask = encode_action_mask(game, seat)
    obs_t = torch.from_numpy(obs).unsqueeze(0).to(device)
    mask_t = torch.from_numpy(mask).unsqueeze(0).to(device)
    with torch.no_grad():
        _, value = net.forward(obs_t, mask_t)
    return float(value.item())


def _round_end_value(
    pre_total_scores_team_diff: int,
    game: BeccaGame,
    viewer_seat: int,
) -> float:
    """Value of a state where the rollout-round just ended.

    Computes the *delta* in total score (this team - other team) caused by
    the rollout, normalized into roughly [-1, 1] range. This is what
    matters for action choice — independent of pre-round scores.
    """
    from becca_env.game import TEAM_OF_SEAT

    my_team = TEAM_OF_SEAT[viewer_seat]
    other = 1 - my_team
    diff_now = game.total_scores[my_team] - game.total_scores[other]
    delta = diff_now - pre_total_scores_team_diff
    # Round delivers up to 35 raw + 9 cricca = 44 raw on the extreme end;
    # normalize by 35 (typical) for a comfortable [-1.something, +1.something]
    return float(delta) / 35.0


def _rollout_to_round_end(
    net: torch.nn.Module,
    game: BeccaGame,
    viewer_seat: int,
    device: torch.device,
    rollout_policy: str = "heuristic",
    heuristic_agent=None,
    max_steps: int = 80,
) -> float:
    """Greedy rollout until the current round ends.

    Action source per step is controlled by `rollout_policy`:
      - 'net':       net.argmax(legal) for every seat
      - 'heuristic': HeuristicAgent.select_action for every seat

    Terminal value is the *delta* in total team-score caused by the
    rollout — i.e. the value the action actually delivered in this
    determinized world.
    """
    from becca_env.game import TEAM_OF_SEAT

    my_team = TEAM_OF_SEAT[viewer_seat]
    other = 1 - my_team
    pre_diff = game.total_scores[my_team] - game.total_scores[other]

    target_round = game.round.number if game.round else None
    steps = 0
    while game.phase != GamePhase.GAME_OVER and steps < max_steps:
        # Round ended (engine has either started a new round or set GAME_OVER)
        if game.round is None or game.round.number != target_round:
            break

        seat = game.current_seat
        if seat < 0:
            break

        if rollout_policy == "net":
            flat = _greedy_action(net, game, seat, device)
            action = decode_action(flat, game)
        elif rollout_policy == "heuristic":
            assert heuristic_agent is not None
            action = heuristic_agent.select_action(game, seat)
        else:
            raise ValueError(f"unknown rollout_policy: {rollout_policy}")

        try:
            game.step(action)
        except ValueError:
            legal = game.legal_actions()
            game.step(legal[0])
        steps += 1

    return _round_end_value(pre_diff, game, viewer_seat)


def pimc_choose_action(
    net: torch.nn.Module,
    game: BeccaGame,
    viewer_seat: int,
    config: PIMCConfig | None = None,
    device: torch.device | None = None,
) -> int:
    """Choose the best legal flat action index using PIMC search.

    Args:
        net: V4 network (in eval mode is preferred — we set it).
        game: current real game state. Will NOT be mutated.
        viewer_seat: seat for whom we are choosing.
        config: PIMC hyperparams.
        device: torch device.

    Returns:
        Flat action index in [0, 160).
    """
    if config is None:
        config = PIMCConfig()
    if device is None:
        device = next(net.parameters()).device
    net.eval()

    # Compute legal action mask once
    base_mask = encode_action_mask(game, viewer_seat)
    legal_actions = np.flatnonzero(base_mask).tolist()
    if not legal_actions:
        raise RuntimeError("No legal actions available at viewer seat")
    if len(legal_actions) == 1:
        return legal_actions[0]

    # Lazy-import heuristic so PIMC remains usable in env without it
    heur = None
    if config.rollout_policy == "heuristic":
        from evaluation.heuristic import HeuristicAgent

        heur = HeuristicAgent(seed=config.seed)

    # Accumulate values per action across determinizations
    action_values = np.zeros(len(legal_actions), dtype=np.float64)
    rng = random.Random(config.seed)

    for d_idx in range(config.num_determinizations):
        det_rng = random.Random(rng.randrange(2**31))
        sampled = sample_opponent_hands(game, viewer_seat, det_rng)

        for ai, flat in enumerate(legal_actions):
            clone = determinize(game, sampled, clone_seed=det_rng.randrange(2**31))
            action = decode_action(flat, clone)
            try:
                clone.step(action)
            except ValueError:
                # Should be rare: viewer's hand is preserved exactly so
                # their legal actions match the original.
                action_values[ai] += -1.0
                continue

            v = _rollout_to_round_end(
                net,
                clone,
                viewer_seat,
                device,
                rollout_policy=config.rollout_policy,
                heuristic_agent=heur,
            )
            action_values[ai] += v

    action_values /= max(config.num_determinizations, 1)
    best_idx = int(np.argmax(action_values))
    return legal_actions[best_idx]
