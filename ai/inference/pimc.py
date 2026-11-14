"""Perfect-Information Monte Carlo (PIMC) at inference time.

Algorithm:
  For each action decision the viewer must make:
    1. Sample N determinizations (random plausible opponent hand assignments).
    2. For each determinization and each legal action:
         - clone the game, play that action,
         - then run a configured rollout for the rest of the round,
         - score exact game-over outcomes or cumulative match progress.
    3. Weight worlds by public signal consistency and average each card's
       utility across determinizations.
    4. Let the network choose the signal variant for the selected card.

This is the textbook PIMC ("determinization + Monte Carlo") technique
that bridges the gap between perfect- and imperfect-info games. The
network handles the policy/value approximation; PIMC handles the
information uncertainty by averaging over plausible worlds.

Notes:
  - Proven public voids are hard sampling constraints and are never relaxed.
  - We use a fixed-depth rollout to round end. The engine applies Cricca,
    match thresholds, and the caller tie-break; terminal utility is exact.
  - For early-game decisions (before any tricks completed) the value
    head's uncertainty is large; PIMC averaging tames it.
  - Signal branches are equivalent until rollout policies react to them, so
    search collapses them by card instead of biasing ties toward no-signal.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace

import numpy as np
import torch

from becca_env.deck import Card
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase, Signal
from becca_env.observation import (
    CARD_INDEX,
    decode_action,
    encode_action_mask,
    encode_observation,
)
from becca_env.signals import signal_is_honest
from inference.determinized import determinize
from inference.hand_sampler import SampledHands, sample_opponent_hands

CONSISTENT_SIGNAL_WEIGHT = 0.9
CONTRADICTING_SIGNAL_WEIGHT = 0.1


@dataclass
class PIMCConfig:
    num_determinizations: int = 20
    """How many sampled worlds we average over per decision."""

    rollout_depth_tricks: int = 10
    """How deep to roll out each (action, world) pair. 10 = full round."""

    rollout_policy: str = "heuristic"
    """Who plays during the rollout phase:
       'net'       — V4 net acts for everyone (uses self-play distribution)
       'heuristic' — HeuristicAgent acts for everyone (closer to typical
                     real opponents and removes net's training-distribution
                     bias). Recommended.
    """

    seed: int = 0
    """Master RNG seed; per-determinization seeds are derived from this."""

    signal_consistency_weighting: bool = True
    """Reweight sampled worlds by consistency with public signal claims."""


class PIMCAgent:
    """Expose PIMC search through the shared evaluation/serving agent contract."""

    def __init__(
        self,
        net: torch.nn.Module,
        config: PIMCConfig | None = None,
        device: torch.device | None = None,
    ):
        self.net = net
        self.config = config if config is not None else PIMCConfig()
        self.device = device if device is not None else next(net.parameters()).device
        self._call_seed = self.config.seed
        self.net.eval()

    def select_action(self, game: BeccaGame, seat: int) -> object:
        config = replace(self.config, seed=self._call_seed)
        self._call_seed += 1
        action_idx = pimc_choose_action(self.net, game, seat, config, self.device)
        return decode_action(action_idx, game)


def _action_idx(card: Card, signal: Signal | None) -> int:
    """Convert a (card, signal) decision into a flat 160 action index."""
    sig_idx = 0 if signal is None else (list(Signal).index(signal) + 1)
    return CARD_INDEX[card] * 4 + sig_idx


def _search_action_groups(game: BeccaGame, legal_actions: list[int]) -> list[list[int]]:
    """Collapse a leader's equivalent signal variants into one search branch."""
    if game.phase != GamePhase.PLAY_CARD or game.round.current_trick:
        return [[action] for action in legal_actions]
    by_card: dict[int, list[int]] = {}
    for action in legal_actions:
        by_card.setdefault(action // 4, []).append(action)
    return list(by_card.values())


def _representative_action(group: list[int]) -> int:
    """Use the no-signal variant while search does not model signal responses."""
    return next((action for action in group if action % 4 == 0), group[0])


def _preferred_variant(
    net: torch.nn.Module,
    game: BeccaGame,
    viewer_seat: int,
    candidates: list[int],
    device: torch.device,
) -> int:
    """Let the policy select the signal variant after PIMC selects the card."""
    if len(candidates) == 1:
        return candidates[0]
    obs = encode_observation(game, viewer_seat, obs_size=net.obs_size)
    mask = encode_action_mask(game, viewer_seat)
    obs_t = torch.from_numpy(obs).unsqueeze(0).to(device)
    mask_t = torch.from_numpy(mask).unsqueeze(0).to(device)
    with torch.no_grad():
        logits, _ = net.forward(obs_t, mask_t)
    return max(candidates, key=lambda action: float(logits[0, action]))


def _signal_consistency_weight(game: BeccaGame, sampled: SampledHands) -> float:
    """Heuristic weight from public declarations under the shared convention.

    Public card history already constrains sampling through revealed cards and
    proven voids. Strategic card-choice likelihood stays neutral because PIMC
    has no calibrated model of the other players' policies.
    """
    weight = 1.0
    completed = game.round.tricks_played
    for index, trick in enumerate(completed):
        if trick.signal is None or trick.signal_seat is None or not trick.cards:
            continue
        hand_after = list(sampled.hands[trick.signal_seat])
        for later in completed[index + 1 :]:
            hand_after.extend(card for seat, card in later.cards if seat == trick.signal_seat)
        hand_after.extend(
            card for seat, card in game.round.current_trick if seat == trick.signal_seat
        )
        honest = signal_is_honest(trick.signal, hand_after, trick.cards[0][1].suit)
        weight *= CONSISTENT_SIGNAL_WEIGHT if honest else CONTRADICTING_SIGNAL_WEIGHT

    if game.round.trick_signals and game.round.current_trick:
        signal_seat, signal = game.round.trick_signals[0]
        if signal is not None:
            honest = signal_is_honest(
                signal,
                sampled.hands[signal_seat],
                game.round.current_trick[0][1].suit,
            )
            weight *= CONSISTENT_SIGNAL_WEIGHT if honest else CONTRADICTING_SIGNAL_WEIGHT
    return weight


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


def _match_utility(game: BeccaGame, viewer_seat: int) -> float:
    """Match-winning utility, including threshold and caller tie-break rules."""
    my_team = TEAM_OF_SEAT[viewer_seat]
    other = 1 - my_team
    if game.phase == GamePhase.GAME_OVER and game.result is not None:
        return 1.0 if game.result.winner_team == my_team else -1.0
    target_raw = max(game.win_points * 3, 1)
    score_diff = game.total_scores[my_team] - game.total_scores[other]
    return float(np.clip(score_diff / target_raw, -1.0, 1.0))


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

    Terminal value is match utility from the viewer's team perspective. If the
    round ends the game, the engine's threshold and caller tie-break decide
    exact ±1 utility; otherwise cumulative match score is normalized by target.
    """
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

    return _match_utility(game, viewer_seat)


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
    if config.num_determinizations <= 0:
        raise ValueError("num_determinizations must be positive")
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

    search_groups = _search_action_groups(game, legal_actions)
    action_values = np.zeros(len(search_groups), dtype=np.float64)
    total_weight = 0.0
    rng = random.Random(config.seed)

    for d_idx in range(config.num_determinizations):
        det_rng = random.Random(rng.randrange(2**31))
        sampled = sample_opponent_hands(game, viewer_seat, det_rng)
        sample_weight = (
            _signal_consistency_weight(game, sampled)
            if config.signal_consistency_weighting
            else 1.0
        )
        total_weight += sample_weight

        for ai, group in enumerate(search_groups):
            flat = _representative_action(group)
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
                max_steps=config.rollout_depth_tricks * 4 + 4,
            )
            action_values[ai] += sample_weight * v

    action_values /= total_weight
    best_idx = int(np.argmax(action_values))
    return _preferred_variant(
        net,
        game,
        viewer_seat,
        search_groups[best_idx],
        device,
    )
