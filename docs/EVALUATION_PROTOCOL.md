# Evaluation Protocol

## Champion Selection

Training evaluation is monitoring only. Freeze the candidate and incumbent
checkpoint hashes, choose a fresh one-use seed block before scoring, then run:

```bash
python -m scripts.score_checkpoints \
  --candidate checkpoints/candidate.pt \
  --incumbent checkpoints/deployed.pt \
  --protocol-id "${PROTOCOL_ID}" \
  --seed-base "${FRESH_SEED_BASE}" \
  --games 1000 \
  --output "runs/${PROTOCOL_ID}/score.jsonl"
```

Every deal is played with both team assignments. Promotion requires at least
1,000 mirrored deals and a paired 95% lower bound above 50%. An inconclusive
result retains the incumbent. Do not add deals after seeing the interval; use a
new predeclared protocol for the next candidate.

## NearPerfect-v1

The only permitted claim is:

> No material exploit found under NearPerfect-v1.

It does not claim solved play or game-theoretic perfection. The evidence
manifest fails closed unless all of these predeclared gates pass:

| Gate | Requirement |
|---|---|
| Training replication | 3 distinct training seeds |
| Opponent panel | 1,000 mirrored deals each against at least 2 historical champions, 2 independently implemented rule agents, repaired PIMC, and a search teacher |
| PIMC repair | At least +2 percentage points over its bare champion and paired 95% lower bound above zero |
| Deployment latency | At least 1,000 CPU decisions; p95 below 1 second and maximum below 5 seconds |
| Approximate best response | At least 3 independently constructed exploiters, 5,000 fresh mirrored deals each, familywise one-sided 95% upper bound on score edge at most 2% |
| Expert corpus | At least 200 frozen states; 100% forced/solved correctness, at least 95% acceptable-action agreement, zero critical misses |

All opponent, PIMC, ABR, latency, and expert summaries must link to persisted
artifacts. Per-deal match artifacts use the `score.jsonl` format and include
checkpoint hashes, protocol identity, seed block, both mirrored legs, confidence
intervals, and public-state slices.

Validate a completed evidence manifest with:

```bash
python -m scripts.check_near_perfect runs/near-perfect-v1/evidence.json
```

Exit code 0 supports the scoped claim. Any missing artifact, insufficient sample,
threshold miss, or malformed interval returns exit code 1. No current repository
artifact passes this protocol; the gate is implemented, but the experiments are
unrun.

Completed and open evidence is tracked in [EXPERIMENTS.md](EXPERIMENTS.md).
