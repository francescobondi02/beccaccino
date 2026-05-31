"""Imitation pretraining: behavioral cloning on the heuristic baseline.

The heuristic is a strong starting point — it already plays competently.
Initializing the policy from heuristic moves gives the PPO phase a head
start of tens of percentage points vs heuristic, instead of starting from
random and slowly catching up.

Pipeline:
  1. collect_heuristic_dataset(): play many full games where every seat
     uses HeuristicAgent, record (obs, action_mask, action) tuples.
  2. behavioral_clone(): train the policy network with masked cross-entropy
     against heuristic actions. The value head is also trained with a small
     MSE loss against the round-end discounted reward (warm-starts V too).
  3. The resulting checkpoint is loaded by the trainer for RL fine-tuning.

We pretrain only the policy & value networks — opponent diversity comes
from the RL phase via the opponent pool.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F  # noqa: N812
from torch import nn

from becca_env.deck import Suit
from becca_env.game import TEAM_OF_SEAT, BeccaGame, GamePhase, Signal
from becca_env.observation import (
    CARD_INDEX,
    OBS_SIZE,
    encode_action_mask,
    encode_observation,
)
from evaluation.heuristic import HeuristicAgent

ACTION_SIZE = 160


@dataclass
class ImitationDataset:
    obs: np.ndarray             # (N, OBS_SIZE) float32
    masks: np.ndarray           # (N, 160) float32
    actions: np.ndarray         # (N,) int64
    returns: np.ndarray         # (N,) float32  — bootstrap target for value head

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
    gamma: float = 0.99,
    verbose: bool = False,
) -> ImitationDataset:
    """Self-play HeuristicAgent vs HeuristicAgent. For each transition, store
    (obs, mask, action_taken) and a discounted-return target for the value
    head computed from the seat's own per-trick + terminal reward signal.

    Reward signal mirrors the env's round-end + terminal scheme:
      - end of each round:  ±(team_score_diff)/35 to each seat
      - end of game:        ±1.0 to each seat
    """
    obs_buf: list[np.ndarray] = []
    mask_buf: list[np.ndarray] = []
    action_buf: list[int] = []
    # Per-seat per-game reward sequences (we'll compute returns at end of game)
    seat_rewards: dict[int, list[float]] = {0: [], 1: [], 2: [], 3: []}
    # Indexes of obs_buf entries belonging to each seat in the current game
    seat_indices: dict[int, list[int]] = {0: [], 1: [], 2: [], 3: []}
    returns_buf: list[float] = []

    agent = HeuristicAgent(seed=seed)

    for g_idx in range(num_games):
        game = BeccaGame(seed=seed + g_idx, win_points=win_points)
        for s in range(4):
            seat_rewards[s] = []
            seat_indices[s] = []

        while game.phase != GamePhase.GAME_OVER:
            seat = game.current_seat
            obs = encode_observation(game, seat)
            mask = encode_action_mask(game, seat)
            action = agent.select_action(game, seat)
            a_idx = _heuristic_action_to_idx(action, game)

            obs_buf.append(obs)
            mask_buf.append(mask)
            action_buf.append(a_idx)
            seat_indices[seat].append(len(obs_buf) - 1)
            seat_rewards[seat].append(0.0)  # placeholder; updated on round/game end

            info = game.step(action)
            ev = info.get("event")

            if ev in ("round_end", "game_over"):
                t0 = info["round_scores"]["team0"]["raw"]
                t1 = info["round_scores"]["team1"]["raw"]
                diff = (t0 - t1) / 35.0
                # Credit the round-end reward to each seat's MOST RECENT
                # transition in this round (a coarse approximation; the env
                # uses pending queues, but here we're building a value target
                # that needs to be a per-step series of rewards).
                for s in range(4):
                    sign = 1.0 if TEAM_OF_SEAT[s] == 0 else -1.0
                    if seat_rewards[s]:
                        seat_rewards[s][-1] += sign * diff

            if ev == "game_over":
                winner = info["game_winner"]
                for s in range(4):
                    if seat_rewards[s]:
                        sign = 1.0 if TEAM_OF_SEAT[s] == winner else -1.0
                        seat_rewards[s][-1] += sign  # ±1.0 terminal

        # Compute discounted returns per seat and assign to returns_buf
        per_seat_returns: dict[int, np.ndarray] = {}
        for s in range(4):
            r = np.asarray(seat_rewards[s], dtype=np.float32)
            if r.size == 0:
                per_seat_returns[s] = r
                continue
            ret = np.zeros_like(r)
            running = 0.0
            for t in reversed(range(len(r))):
                running = r[t] + gamma * running
                ret[t] = running
            per_seat_returns[s] = ret

        # Now write returns into returns_buf at the right indices
        # (per-seat indices were collected in temporal order)
        for s in range(4):
            for t, idx_in_buf in enumerate(seat_indices[s]):
                # extend list to required length lazily
                while len(returns_buf) <= idx_in_buf:
                    returns_buf.append(0.0)
                returns_buf[idx_in_buf] = float(per_seat_returns[s][t])

        if verbose and (g_idx + 1) % 200 == 0:
            print(f"  collected {g_idx + 1}/{num_games} games | {len(obs_buf):,} samples")

    # If returns_buf shorter than obs_buf for any reason, pad with zeros
    while len(returns_buf) < len(obs_buf):
        returns_buf.append(0.0)

    return ImitationDataset(
        obs=np.asarray(obs_buf, dtype=np.float32),
        masks=np.asarray(mask_buf, dtype=np.float32),
        actions=np.asarray(action_buf, dtype=np.int64),
        returns=np.asarray(returns_buf, dtype=np.float32),
    )


def behavioral_clone(
    net: nn.Module,
    dataset: ImitationDataset,
    epochs: int = 4,
    batch_size: int = 512,
    lr: float = 3e-4,
    value_loss_coef: float = 0.25,
    device: torch.device = torch.device("cpu"),
    verbose: bool = True,
) -> dict[str, list[float]]:
    """Train `net` on the imitation dataset.

    Loss = CE(policy_logits, heuristic_action) + coef * MSE(value, returns).

    Both V2 and V3 networks expose the same forward(obs, mask) interface.
    """
    assert dataset.obs.shape[1] == OBS_SIZE
    assert dataset.actions.shape[0] == dataset.obs.shape[0]
    assert dataset.returns.shape[0] == dataset.obs.shape[0]

    n = len(dataset)
    obs_t = torch.from_numpy(dataset.obs)
    mask_t = torch.from_numpy(dataset.masks)
    act_t = torch.from_numpy(dataset.actions)
    ret_t = torch.from_numpy(dataset.returns)

    opt = torch.optim.Adam(net.parameters(), lr=lr)
    history: dict[str, list[float]] = {"ce_loss": [], "v_loss": [], "acc": []}

    net.train()
    for epoch in range(epochs):
        idx = torch.randperm(n)
        ce_total, v_total, correct, count = 0.0, 0.0, 0, 0
        for start in range(0, n, batch_size):
            mb = idx[start : start + batch_size]
            o = obs_t[mb].to(device)
            m = mask_t[mb].to(device)
            a = act_t[mb].to(device)
            r = ret_t[mb].to(device)

            logits, value = net.forward(o, m)
            # CE: standard cross-entropy with masked logits already in `logits`
            ce = F.cross_entropy(logits, a)
            v_loss = F.mse_loss(value, r)
            loss = ce + value_loss_coef * v_loss

            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()

            with torch.no_grad():
                pred = logits.argmax(dim=-1)
                correct += (pred == a).sum().item()
                count += len(a)
                ce_total += ce.item() * len(a)
                v_total += v_loss.item() * len(a)

        history["ce_loss"].append(ce_total / count)
        history["v_loss"].append(v_total / count)
        history["acc"].append(correct / count)
        if verbose:
            print(
                f"  epoch {epoch + 1}/{epochs} | "
                f"CE={ce_total / count:.4f} V={v_total / count:.4f} "
                f"acc={correct / count:.1%}"
            )

    return history
