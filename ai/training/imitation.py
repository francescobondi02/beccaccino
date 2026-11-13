"""Imitation pretraining: behavioral cloning on the heuristic baseline.

The heuristic is a strong starting point — it already plays competently.
Initializing the policy from heuristic moves gives the PPO phase a head
start of tens of percentage points vs heuristic, instead of starting from
random and slowly catching up.

Pipeline:
  1. collect_heuristic_dataset(): play many full games where every seat
     uses HeuristicAgent, record (obs, action_mask, action) tuples.
  2. behavioral_clone(): train the policy network with masked cross-entropy
     against heuristic actions.
  3. The resulting checkpoint is loaded by the trainer for RL fine-tuning.

Policy-only by design: BC does NOT warm-start the value head. BC value targets
would be raw discounted returns at gamma=0.99, but the PPO phase fits the value
head to ReturnNormalizer-scaled returns at gamma=0.995 — a warm-start at the
wrong scale AND discount that PPO must immediately unlearn. Since low
explained_variance is the measured bottleneck, we let PPO learn V from scratch
under its own correct, normalized targets.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F  # noqa: N812
from torch import nn

from becca_env.deck import Suit
from becca_env.game import BeccaGame, GamePhase, Signal
from becca_env.observation import (
    CARD_INDEX,
    OBS_SIZE,
    encode_action_mask,
    encode_observation,
)
from evaluation.heuristic import HeuristicAgent


@dataclass
class ImitationDataset:
    obs: np.ndarray  # (N, OBS_SIZE) float32
    masks: np.ndarray  # (N, 160) float32
    actions: np.ndarray  # (N,) int64

    def __len__(self) -> int:
        return self.obs.shape[0]


def _heuristic_action_to_idx(action, game: BeccaGame) -> int:
    """Map a HeuristicAgent action back to the flat 160-action index space."""
    if game.phase == GamePhase.CHOOSE_BRISCOLA:
        # action is a Suit
        return list(Suit).index(action)

    # PLAY_CARD
    is_leader = len(game.round.current_trick) == 0
    if is_leader:
        # action is (card, signal|None)
        card, signal = action
        sig_idx = 0 if signal is None else (list(Signal).index(signal) + 1)
    else:
        card = action
        sig_idx = 0
    return CARD_INDEX[card] * 4 + sig_idx


def collect_heuristic_dataset(
    num_games: int = 2000,
    win_points: int = 5,
    seed: int = 0,
    verbose: bool = False,
    declare_signals: bool = True,
) -> ImitationDataset:
    """Self-play HeuristicAgent vs HeuristicAgent, recording (obs, mask, action)
    for every transition. Used as policy-only cross-entropy targets.

    `declare_signals` makes the teacher declare the honest signal on every lead.
    On by default: an action is (card, signal), so a silent teacher supplies zero
    evidence about 3 of the 4 signal slots and BC leaves them at initialization —
    which is how the shipped model ended up picking signals at ~chance.
    """
    obs_buf: list[np.ndarray] = []
    mask_buf: list[np.ndarray] = []
    action_buf: list[int] = []

    agent = HeuristicAgent(seed=seed, declare_signals=declare_signals)

    for g_idx in range(num_games):
        game = BeccaGame(seed=seed + g_idx, win_points=win_points)

        while game.phase != GamePhase.GAME_OVER:
            seat = game.current_seat
            obs_buf.append(encode_observation(game, seat))
            mask_buf.append(encode_action_mask(game, seat))
            action = agent.select_action(game, seat)
            action_buf.append(_heuristic_action_to_idx(action, game))
            game.step(action)

        if verbose and (g_idx + 1) % 200 == 0:
            print(f"  collected {g_idx + 1}/{num_games} games | {len(obs_buf):,} samples")

    return ImitationDataset(
        obs=np.asarray(obs_buf, dtype=np.float32),
        masks=np.asarray(mask_buf, dtype=np.float32),
        actions=np.asarray(action_buf, dtype=np.int64),
    )


def behavioral_clone(
    net: nn.Module,
    dataset: ImitationDataset,
    epochs: int = 4,
    batch_size: int = 512,
    lr: float = 3e-4,
    device: torch.device = torch.device("cpu"),
    verbose: bool = True,
) -> dict[str, list[float]]:
    """Train `net`'s policy on the imitation dataset with masked cross-entropy.

    Policy-only: the value head is left for PPO to train from scratch (see the
    module docstring). Both V2/V3/V4 networks expose the same forward(obs, mask).
    """
    assert dataset.obs.shape[1] == OBS_SIZE
    assert dataset.actions.shape[0] == dataset.obs.shape[0]

    n = len(dataset)
    obs_t = torch.from_numpy(dataset.obs)
    mask_t = torch.from_numpy(dataset.masks)
    act_t = torch.from_numpy(dataset.actions)

    opt = torch.optim.Adam(net.parameters(), lr=lr)
    history: dict[str, list[float]] = {"ce_loss": [], "acc": []}

    net.train()
    for epoch in range(epochs):
        idx = torch.randperm(n)
        ce_total, correct, count = 0.0, 0, 0
        for start in range(0, n, batch_size):
            mb = idx[start : start + batch_size]
            o = obs_t[mb].to(device)
            m = mask_t[mb].to(device)
            a = act_t[mb].to(device)

            logits, _ = net.forward(o, m)
            ce = F.cross_entropy(logits, a)

            opt.zero_grad()
            ce.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()

            with torch.no_grad():
                pred = logits.argmax(dim=-1)
                correct += (pred == a).sum().item()
                count += len(a)
                ce_total += ce.item() * len(a)

        history["ce_loss"].append(ce_total / count)
        history["acc"].append(correct / count)
        if verbose:
            print(
                f"  epoch {epoch + 1}/{epochs} | "
                f"CE={ce_total / count:.4f} acc={correct / count:.1%}"
            )

    return history
