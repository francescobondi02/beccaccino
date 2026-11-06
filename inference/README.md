# inference

## Overview

Inference-time search for imperfect-information play. It samples opponent
hands consistent with public information, clones the game into
perfect-information determinizations, and runs Perfect-Information Monte
Carlo (PIMC) rollouts to pick a move. `PIMCAgent` is shared by evaluation
(`evaluation.pimc_eval`) and serving tiers. Depends on
[`../becca_env/README.md`](../becca_env/README.md); the default rollout policy
lazily imports `evaluation.heuristic.HeuristicAgent`
([`../evaluation/README.md`](../evaluation/README.md)).

## Interface

- `hand_sampler.py`: `SampledHands` (`hands`, `relaxed`),
  `InfeasibleHandConstraintsError(ValueError)`,
  `sample_opponent_hands(game, viewer_seat, rng)`
  (`[hand_sampler.py:sample_opponent_hands]`).
- `determinized.py`: `determinize(game, sampled, clone_seed=None)` returns a
  deep-copied `BeccaGame` with hands replaced (`[determinized.py:determinize]`).
  With `clone_seed=None` the clone RNG is seeded from `id(clone)`, which is not
  reproducible across runs; pass `clone_seed` for determinism (`pimc.py` does).
- `pimc.py`: `PIMCConfig` (`num_determinizations = 20`,
  `rollout_depth_tricks = 10`, `rollout_policy = "heuristic"`, `seed = 0`,
  `signal_consistency_weighting = True`).
  `rollout_depth_tricks` is only a step cap of `rollout_depth_tricks * 4 + 4`
  plays; a rollout ends at round end or at the cap, whichever comes first, so
  values of 10 or more always reach round end (`[pimc.py:pimc_choose_action]`).
  The module also exports `PIMCAgent(net, config, device)` with `select_action(game, seat)`,
  `pimc_choose_action(net, game, viewer_seat, config, device)` returning a
  flat action index in `[0, 160)`; constants `CONSISTENT_SIGNAL_WEIGHT = 0.9`
  and `CONTRADICTING_SIGNAL_WEIGHT = 0.1` (`[pimc.py:pimc_choose_action]`).
- `__init__.py` is empty; import submodules directly.

## Invariants

- Proven public voids are hard constraints and are never relaxed; if no
  assignment exists `InfeasibleHandConstraintsError` is raised.
  `SampledHands.relaxed` is kept for compatibility and is always `False`
  (`[hand_sampler.py:_try_assign]`, `[hand_sampler.py:SampledHands]`).
- Sampled hands match each seat's current hand size, exclude public cards and
  the viewer's hand, and include the viewer's hand verbatim; sampling is only
  valid in `PLAY_CARD` or `CHOOSE_BRISCOLA`
  (`[hand_sampler.py:sample_opponent_hands]`). A wrong phase, or unseen cards
  that do not match the other seats' hand sizes, raises a plain `ValueError`,
  not `InfeasibleHandConstraintsError`.
- Card-choice strategy is not used as hand evidence
  (`[hand_sampler.py]` module docstring).
- `determinize` never mutates the source game, requires all four seats, and
  raises `ValueError` on any hand-size mismatch
  (`[determinized.py:determinize]`).
- `pimc_choose_action` never mutates the real game, requires
  `num_determinizations > 0`, raises `RuntimeError` with no legal action, and
  returns immediately when only one action is legal
  (`[pimc.py:pimc_choose_action]`).
- With `signal_consistency_weighting`, each sampled world is weighted by the
  product of `CONSISTENT_SIGNAL_WEIGHT` or `CONTRADICTING_SIGNAL_WEIGHT` per
  public declaration, judged with `signal_is_honest` on the declarer's
  reconstructed post-lead hand. Action values are weighted sums divided by the
  total weight (`[pimc.py:_signal_consistency_weight]`,
  `[pimc.py:pimc_choose_action]`).
- If a candidate's root step raises `ValueError` in a world, that world adds
  an unweighted `-1.0` to the candidate (`[pimc.py:pimc_choose_action]`). If a
  rollout action raises `ValueError`, the first legal action is played instead
  (`[pimc.py:_rollout_to_round_end]`).
- Leader signal variants are collapsed per card during search; the network
  then picks the signal variant for the chosen card
  (`[pimc.py:_search_action_groups]`, `[pimc.py:_preferred_variant]`).
- Rollouts stop at the end of the current round or at the
  `rollout_depth_tricks` step cap; utility is exact `±1` at
  game over, otherwise the cumulative score difference normalized by
  `win_points * 3` and clipped to `[-1, 1]` (`[pimc.py:_match_utility]`).
  `rollout_policy` must be `"net"` or `"heuristic"`
  (`[pimc.py:_rollout_to_round_end]`).
- `PIMCAgent` advances its per-call seed after each decision, so repeated
  calls are reproducible but distinct (`[pimc.py:PIMCAgent.select_action]`).

## Side Effects

- `PIMCAgent.__init__` and `pimc_choose_action` put the network in eval mode
  (`net.eval()`) (`[pimc.py:PIMCAgent.__init__]`, `[pimc.py:pimc_choose_action]`).
- PyTorch inference runs on the configured device (`[pimc.py:_greedy_action]`,
  `[pimc.py:_preferred_variant]`).
- No disk or network access.

## Verification

- Run: `cd ai && pytest tests/test_hand_sampler.py tests/test_pimc.py`
- Full suite: `cd ai && pytest`
