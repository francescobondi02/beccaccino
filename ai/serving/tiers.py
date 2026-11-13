"""Difficulty tiers for practice games against bots.

Four tiers built from the retained historical checkpoints documented in
docs/EXPERIMENTS.md. Every agent exposes the same `select_action(game, seat)`
contract, so `/act` treats them uniformly.

Models are loaded lazily and cached: a tier nobody plays costs nothing, and the
process does not need every historical artifact present to serve the tiers it can.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch

from evaluation.arena import NeuralAgent
from evaluation.heuristic import HeuristicAgent
from inference.pimc import PIMCAgent, PIMCConfig
from serving.artifact import InferenceArtifactError, load_inference_artifact
from training.checkpoint import CheckpointIntegrityError, build_net, load_checkpoint

_AI_ROOT = Path(__file__).resolve().parent.parent

# PIMC search budget. 10 determinizations measures ~135 ms/move against the 60s
# turn budget; the default 20 roughly doubles that for little strength gain.
PIMC_DETERMINIZATIONS = 10

# PIMC MUST roll out with the heuristic, never the net: net rollouts measure
# ~39 s per move, which reads as a hung app.
PIMC_ROLLOUT_POLICY = "heuristic"


@dataclass(frozen=True)
class Tier:
    """A user-facing difficulty setting and how to build the agent behind it."""

    name: str
    label: str  # shown in the UI (Italian, per project convention)
    checkpoint: str | None  # path relative to the package root; None for no weights
    description: str
    inference_artifact: bool = False


TIERS: dict[str, Tier] = {
    "facile": Tier(
        name="facile",
        label="Facile",
        checkpoint="checkpoints/kaggle-runb/checkpoints/runB_bc.pt",
        description="Imitates the scripted baseline; loses to it (Elo 877).",
    ),
    "medio": Tier(
        name="medio",
        label="Medio",
        checkpoint=None,
        description="Scripted heuristic, no neural network. The yardstick.",
    ),
    "forte": Tier(
        name="forte",
        label="Forte",
        checkpoint="serving/models/kaggle_2026_10_25.pt",
        description="Operator-approved Kaggle policy; 91.5% over 400 games against random.",
        inference_artifact=True,
    ),
    "esperto": Tier(
        name="esperto",
        label="Esperto",
        checkpoint="serving/models/run_d2_champion.pt",
        description="The Run D2 champion plus experimental PIMC search over sampled hands.",
        inference_artifact=True,
    ),
}


class UnknownTierError(ValueError):
    pass


class TierUnavailableError(RuntimeError):
    """The tier is known but its checkpoint is missing from this deployment."""


_agent_cache: dict[tuple[str, float], object] = {}


def available_tiers() -> list[Tier]:
    """Tiers this process can actually serve, in increasing strength order."""
    return [t for t in TIERS.values() if t.checkpoint is None or _checkpoint_path(t).exists()]


def get_agent(tier_name: str, temperature: float = 0.0):
    """Build (or reuse) the agent for a tier.

    `temperature` only affects the neural tiers: 0 is greedy/deterministic,
    higher samples from the policy so a practice opponent is less repetitive.
    """
    tier = TIERS.get(tier_name)
    if tier is None:
        raise UnknownTierError(f"unknown tier {tier_name!r}; expected one of {sorted(TIERS)}")

    cache_key = (tier_name, temperature)
    if cache_key not in _agent_cache:
        _agent_cache[cache_key] = _build_agent(tier, temperature)
    return _agent_cache[cache_key]


def _build_agent(tier: Tier, temperature: float):
    if tier.name == "medio":
        return HeuristicAgent()

    net = _load_net(tier)
    if tier.name == "esperto":
        return PIMCAgent(
            net,
            PIMCConfig(
                num_determinizations=PIMC_DETERMINIZATIONS,
                rollout_policy=PIMC_ROLLOUT_POLICY,
            ),
            torch.device("cpu"),
        )
    return NeuralAgent(net, torch.device("cpu"), temperature=temperature)


def _checkpoint_path(tier: Tier) -> Path:
    return _AI_ROOT / tier.checkpoint


def _load_net(tier: Tier) -> torch.nn.Module:
    path = _checkpoint_path(tier)
    if not path.exists():
        raise TierUnavailableError(f"tier {tier.name!r} needs a checkpoint at {path}")

    try:
        if tier.inference_artifact:
            checkpoint = load_inference_artifact(path)
        else:
            checkpoint = load_checkpoint(path)
    except (InferenceArtifactError, CheckpointIntegrityError) as exc:
        raise TierUnavailableError(f"tier {tier.name!r} cannot load {path}: {exc}") from exc
    net = build_net(checkpoint, torch.device("cpu"))
    net.eval()
    return net
