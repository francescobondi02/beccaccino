# evaluation

## Overview

Offline strength measurement for Beccaccino agents: baseline agents (random
and rule-based heuristic), seeded arena matches, mirrored-deal promotion
records, Elo ladders, confidence intervals, PIMC-vs-heuristic
evaluation, and the fail-closed NearPerfect-v1 evidence gate. Depends on
[`../becca_env/README.md`](../becca_env/README.md) for the engine,
`training.network.BeccaNet` for neural agents, and `inference.pimc` for search.

## Interface

- `arena.py`: `RandomAgent(seed=None)` and
  `NeuralAgent(net, device=cpu, temperature=0.0)`, both exposing
  `select_action(game, seat)`; `NeuralAgent` takes the argmax when
  `temperature <= 0` and samples from `logits / temperature` otherwise
  (`[arena.py:NeuralAgent.select_action]`). Also `MatchResult`, `GameRecord`,
  `MirroredDealRecord`, `AgentFactory = Callable[[int], object]` (seed to
  fresh agent, used by `iter_mirrored_deals`), `play_recorded_game`,
  `iter_mirrored_deals`, `play_match`, `evaluate_side_balanced`,
  `elo_ladder`, `evaluate_against_random`; constants `EVAL_SEED_BASE`,
  `ELO_SCALE`, `LADDER_INIT_RATING`, `LADDER_ITERATIONS`
  (`[arena.py:EVAL_SEED_BASE]`, `[arena.py:iter_mirrored_deals]`).
  `play_match` never sets `MatchResult.draws` or `total_rounds`, so they stay
  `0`; `total_games` and `team0_winrate` count wins only
  (`[arena.py:play_match]`).
- `heuristic.py`: `HeuristicAgent(seed=None, declare_signals=False)` and
  `evaluate_against_heuristic` (`[heuristic.py:HeuristicAgent]`). The seeded
  `rng` is created but never used: decisions are deterministic for a given
  state regardless of `seed` (`[heuristic.py:HeuristicAgent.__init__]`).
- `protocol.py`: `ChampionSummary`, `sha256_file`, `summarize_champion`,
  `write_score_jsonl`, `MIN_CHAMPION_DEALS = 1_000`
  (`[protocol.py:write_score_jsonl]`).
- `stats.py`: `wilson_interval`, `paired_mean_interval`,
  `paired_difference_interval`, `DEFAULT_Z = 1.96` (stdlib only; paired
  intervals use `statistics.stdev`) (`[stats.py:wilson_interval]`).
- `pimc_eval.py`: `evaluate_pimc_against_heuristic(net, num_games=100,
  win_points=41, num_determinizations=20, seed=0, device=None)`. It wraps the
  network in `inference.pimc.PIMCAgent` (the module docstring's
  `pimc_choose_action()` wording is outdated) and plays side-balanced games
  against `HeuristicAgent(seed=seed + 10000)`. Its default `seed=0` is not
  `EVAL_SEED_BASE`, so pass the seed explicitly for comparable numbers
  (`[pimc_eval.py:evaluate_pimc_against_heuristic]`).
- `near_perfect.py`: `NearPerfectSpec`, `GateResult`, `load_evidence`,
  `evaluate_near_perfect`, `PROTOCOL_ID = "NearPerfect-v1"`
  (`[near_perfect.py:evaluate_near_perfect]`). `NearPerfectSpec` defaults
  (`[near_perfect.py:NearPerfectSpec]`):
  - 3 training seeds; at least 1,000 mirrored deals per opponent.
  - Minimum opponents per category: 2 historical, 2 independent rule, 1 PIMC,
    1 search teacher.
  - PIMC gain at least `0.02`.
  - 1,000 latency samples with p95 below 1 s and maximum below 5 s.
  - 3 approximate best-response agents, each with at least 5,000 deals and an
    edge upper bound of at most `0.02`.
  - At least 200 expert states, all forced states correct, at least 95%
    acceptable-action agreement, and zero critical misses.

## Invariants

- `EVAL_SEED_BASE = 20260724` must never change, or historical evaluation
  numbers stop being comparable (`[arena.py:EVAL_SEED_BASE]`).
- `HeuristicAgent` is the frozen evaluation yardstick: `declare_signals`
  defaults to `False` and its play must not change
  (`[heuristic.py:HeuristicAgent.__init__]`).
- Team 0 controls seats 0 and 2, team 1 seats 1 and 3 in every match
  (`[arena.py:play_match]`); `candidate_team` must be 0 or 1 and `num_deals`
  must be positive (`[arena.py:play_recorded_game]`,
  `[arena.py:iter_mirrored_deals]`).
- Promotion replays every seed on both sides with fresh agents per leg
  (`[arena.py:iter_mirrored_deals]`); side-balanced evaluation uses disjoint
  seed blocks and plays `2 * (num_games // 2)` games
  (`[arena.py:evaluate_side_balanced]`).
- `summarize_champion` rejects empty input and duplicate seeds, returns
  `"insufficient"` below `MIN_CHAMPION_DEALS`, and promotes only when the
  paired interval lower bound exceeds `0.5`
  (`[protocol.py:summarize_champion]`).
- `write_score_jsonl` requires a non-blank `protocol_id` and a contiguous seed
  block starting at `seed_base` (`[protocol.py:write_score_jsonl]`).
- `paired_difference_interval` requires equal-length inputs. The paired
  helpers raise `ValueError` on empty input; with one sample,
  `paired_mean_interval` returns `(0.0, 1.0)` and
  `paired_difference_interval` returns `(-1.0, 1.0)`
  (`[stats.py:paired_difference_interval]`, `[stats.py:paired_mean_interval]`).
  `wilson_interval` does not raise: it returns `(0.0, 0.0)` when `n == 0`
  (`[stats.py:wilson_interval]`).
- The NearPerfect gate is fail-closed: it only validates persisted evidence
  and fails on any missing threshold or artifact
  (`[near_perfect.py:evaluate_near_perfect]`,
  `[near_perfect.py:_require_artifact]`).

## Side Effects

- `write_score_jsonl` creates parent directories and writes a new JSONL file
  opened with mode `"x"`, so it never overwrites an existing score artifact
  (`[protocol.py:write_score_jsonl]`).
- `sha256_file` and `load_evidence` read files from disk
  (`[protocol.py:sha256_file]`, `[near_perfect.py:load_evidence]`);
  `_require_artifact` checks file existence
  (`[near_perfect.py:_require_artifact]`).
- `NeuralAgent` runs PyTorch inference on the configured device
  (`[arena.py:NeuralAgent.select_action]`).

## Verification

- Run: `cd ai && pytest tests/test_arena.py tests/test_heuristic.py tests/test_stats.py tests/test_evaluation_protocol.py tests/test_near_perfect.py`
- Full suite: `cd ai && pytest`
- No test covers `pimc_eval.py`.
