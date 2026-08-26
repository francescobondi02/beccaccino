# Expert Data Collection

BECCA annotation scenarios are produced as deterministic offline batches for
database import. The AI service never generates scenarios at startup or while
handling a request. Replenishing the annotation pool means generating and
importing another batch with a new batch ID.

This is the operator runbook for creating, validating, importing, and retaining
those batches. Generation and import are deliberately separate:

1. The generator writes a scenario JSON file and a provenance manifest
   to local disk. It cannot contact or modify any database.
2. The backend importer validates both files and checks the target database.
3. Only an import using `--apply` writes scenarios to that database.

## Safety Rules

- Never commit, log, upload, or send the master seed.
- Never overwrite the master seed. Losing it prevents exact reproduction;
  changing it produces a different batch.
- Never reuse an imported batch ID for different content.
- Never run a production import until the dry-run result and database target
  have been checked.
- Keep the batch and manifest together. Neither file is sufficient alone.
- Retain every imported pair and its generator commit for audit and recovery.

The repository ignores `.private/` and `out/annotations/`. That protects normal
Git workflows, but it is not a backup or a substitute for secret management.

## Prerequisites

Run all generation commands from `ai/`. Before the first production batch:

```bash
.venv/bin/python --version
.venv/bin/python -m pytest -q tests/test_annotation_scenarios.py
test -f serving/models/run_d2_champion.pt
test "$(wc -c < serving/models/run_d2_champion.pt)" -gt 0
```

The checked-out generator commit and model artifact become part of the
manifest. Generate from a clean, reviewed AI revision so that commit remains a
meaningful provenance identifier.

## One-Time Master Seed Setup

Create one random seed and reuse it for every batch in this collection:

```bash
mkdir -p .private out/annotations
umask 077
test ! -e .private/annotation-master.seed
openssl rand -hex 32 > .private/annotation-master.seed
chmod 600 .private/annotation-master.seed
test "$(wc -c < .private/annotation-master.seed)" -ge 32
git check-ignore .private/annotation-master.seed
```

The `test ! -e` guard must succeed before creating the file. If the seed
already exists, stop and use it; do not replace it. Store an encrypted backup
in a durable secret store before importing the first batch.

The raw seed is absent from generated files. The manifest contains only an
HMAC fingerprint that can confirm which retained seed produced the batch.

## Batch Naming

Use a unique lowercase ID containing letters, digits, and hyphens. A practical
format is:

```text
expert-YYYY-MM-DD-<sequence>
```

For example, `expert-2026-08-26-a`, then `expert-2026-08-26-b`. The ID becomes
part of every scenario code and cannot be renamed after generation.

Fifty scenarios is the recommended operational batch size, not a product
limit. Each request must be a positive count. Larger batches take longer and
can fail if the bounded 10,000-source-game search cannot fill every difficulty
and corner-case quota.

## Generate A Batch

Choose the ID once, then run:

```bash
BATCH_ID=expert-2026-08-26-a

.venv/bin/python -m scripts.generate_annotation_scenarios \
  --master-seed-file .private/annotation-master.seed \
  --batch-id "$BATCH_ID" \
  --scenario-count 50 \
  --model-artifact serving/models/run_d2_champion.pt \
  --output-batch "out/annotations/$BATCH_ID.json" \
  --manifest "out/annotations/$BATCH_ID.manifest.json" \
  --generator-commit "$(git rev-parse HEAD)"
```

Successful output includes the number of scenarios, output path, and batch
SHA-256. A failure writes neither final file. Do not edit generated JSON by
hand; any byte change makes the manifest hash invalid.

## Inspect And Validate

Review the non-secret manifest before import:

```bash
.venv/bin/python -m json.tool \
  "out/annotations/$BATCH_ID.manifest.json"
```

For a 50-scenario batch, verify:

- `batchId` is the intended unique ID;
- `generatorCommit` is the reviewed AI commit;
- `parameters.scenarioCount` is `50`;
- difficulty quotas and counts are `10` easy, `20` medium, and `20` hard;
- `minimumCuratedCorners` is at least `3`;
- `modelSha256` matches the pinned model;
- `batchSha256` is present.

The generator already validates chronology, legality, privacy, unique codes,
state hashes, objective tags, exact quotas, aggregate counts, and canonical
JSON before writing. The backend importer independently validates its accepted
scenario contract and the exact batch-file hash from the manifest.

To prove deterministic reproduction, move neither output and rerun the exact
command with the same seed, batch ID, count, model, and generator revision.
The files remain byte-identical. If any input intentionally changes, use a new
batch ID instead.

Each source-game seed is:

```text
HMAC-SHA256(private master seed, versioned domain + batch ID + game index)
```

Changing the private seed, batch ID, count, model bytes, or generator method can
change the selected scenarios. Reusing all inputs produces byte-identical
canonical JSON files.

## Selection Rules

The generator advances deterministic 41-point games with the existing heuristic
agent. It excludes every position with only one legal card choice. A leader's
four signal variants on one card still count as one card choice.

Every retained scenario receives objective public-state tags:

| Tag | Predicate |
|---|---|
| `lead` | Current trick is empty |
| `must_follow` | Acting hand contains the led suit |
| `void` | Acting hand does not contain the led suit |
| `partner_winning` | Acting player's team currently leads the trick |
| `high_value_trick` | Current trick contains at least 3 raw points |
| `late_round` | At least seven tricks are complete |
| `score_pressure` | A team is within 10 points of the 41-point target |
| `signal_decision` | The leader has legal signal variants |

Importance is rule-derived:

- `1`: standard position.
- `2`: useful or uncommon position, including score pressure, late high-value
  play, high-value void/partner decisions, or late signal decisions.
- `3`: curated corner-case combinations: void plus partner-winning plus
  high-value; must-follow plus partner-winning plus high-value under score
  pressure; or a late lead/signal decision under score pressure.

Within each difficulty bucket, higher-importance candidates replace lower-
importance candidates found earlier. Every batch reserves at least 5% of its
rows for importance-3 corner cases, rounded up. This guarantees a fixed corner
set for the backend's usefulness ranking instead of relying on seed luck.

Difficulty is computed separately from tags. Structural complexity combines
the number of distinct card choices, current-trick depth, completed history,
public signals, and round depth. The pinned model contributes only the margin
between its two highest legal-action logits. Scores, logits, observations, and
hidden state are never emitted. The target mix is exactly 20% `easy`, 40%
`medium`, and 40% `hard`, using deterministic largest-remainder rounding when
the requested count is not divisible by five. Generation fails if the bounded
search cannot fill every quota.

## Batch Contract

The batch is a JSON array ready for database import:

```json
{
  "code": "expert-2026-08-a-00001",
  "predictedDifficulty": "medium",
  "importance": 2,
  "tags": ["void", "high_value_trick"],
  "stateHash": "<SHA-256 of canonical state JSON>",
  "state": {
    "targetPoints": 41,
    "roundNumber": 1,
    "actingSeat": 2,
    "callerSeat": 0,
    "trickStarter": 0,
    "briscola": "denara",
    "totalScores": { "0": 0, "1": 0 },
    "hand": [],
    "completedTricks": [],
    "currentTrick": {
      "number": 1,
      "starterSeat": 0,
      "signal": null,
      "signalSeat": null,
      "plays": []
    },
    "legalActions": []
  }
}
```

Real `hand` and `legalActions` arrays are non-empty. `state` contains the
complete current public-state fields from `targetPoints` through
`legalActions`; it contains no database ID, version, category, deal seed,
opponent hand, model score, or hidden state. Codes are stable and derive only
from the batch ID and ordinal.

The separate manifest records:

- batch ID and non-secret seed fingerprint;
- explicit generator commit/provenance and model-file SHA-256;
- rules and method versions;
- requested count, target mix, exact quotas, and search bound;
- the minimum number of curated corner cases;
- counts by difficulty, importance, and tag;
- SHA-256 of the exact canonical batch-file bytes.

Before writing, the generator validates chronology, trick winners, card
uniqueness, legal actions, privacy, fixed vocabularies, objective tags and
importance, exact difficulty quotas, state hashes, unique codes and hashes, and
the manifest/batch hash. Batch and manifest files are written atomically.

## Import Into A Backend Database

The annotation database migration and API must be deployed before the first
production import. From `backend/`, build the exact importer that will run:

```bash
npm ci
npm run build
```

Supply `DATABASE_URL` and `DIRECT_URL` through the controlled environment used
for the target database. Do not paste production credentials into commands,
documents, shell history, or generated files.

Confirm the target without printing credentials:

```bash
node -e '
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const url = new URL(process.env[key]);
  console.log(`${key}: host=${url.hostname} database=${url.pathname.slice(1)}`);
}
'
```

Both values must identify the intended Neon production project. `DATABASE_URL`
normally uses its pooled host; `DIRECT_URL` uses the non-pooled host required
for migrations. Stop if either target is missing or unexpected.

First run without `--apply`:

```bash
npm run annotations:import -- \
  ../ai/out/annotations/expert-2026-08-26-a.json \
  ../ai/out/annotations/expert-2026-08-26-a.manifest.json
```

The JSON result must report the intended `batchId`, `validated: 50`, and
`applied: false`. In dry-run output, the number that would be inserted is
`validated - skipped`; `inserted` remains zero because no write occurred.

After independently verifying the database host is production and reviewing
the dry run, apply the same files:

```bash
npm run annotations:import -- \
  ../ai/out/annotations/expert-2026-08-26-a.json \
  ../ai/out/annotations/expert-2026-08-26-a.manifest.json \
  --apply
```

For a new batch, the result must report `validated: 50`, `inserted: 50`,
`skipped: 0`, and `applied: true`. Repeating the identical import is safe and
reports zero inserted rows. A reused code or state hash with different content
aborts the entire transaction; investigate rather than editing either file.

Importing into a local or staging database affects only that database.
Generation never adds scenarios to production. Production changes only when
the importer is connected to the production database and `--apply` is present.

## Production Launch Order

Before the first annotation deployment, use the Neon SQL editor to check for
out-of-band prototype schema:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('AnnotationScenario', 'ExpertAnnotation');
```

The expected result before the first release is zero rows. The migration
creates both tables. If either table already exists, stop and inspect its
columns and data; do not drop it or mark the migration applied without an
explicit migration and backup plan.

Then:

1. Publish and deploy the reviewed backend revision containing the annotation
   migration, API, and importer.
2. Confirm the production backend is healthy and the migration completed.
3. Configure a private backend-only `ANNOTATION_ACCESS_CODE`.
4. Publish and deploy the annotation frontend.
5. Generate and inspect the first offline batch.
6. Run the production import without `--apply`.
7. Verify the production database target and dry-run result.
8. Run the same import with `--apply`.
9. Sign in on the real website, enter the shared code, answer one scenario, and
   verify the contribution count increments.
10. Re-run the importer without `--apply`; the batch should now be fully
    skipped.

The access code is independent of generation and import. It grants an already
authenticated BECCA account permission to use annotation endpoints. Anyone
with the code and an account can grant themselves access, so distribute it
only to intended annotators. Rotating it blocks future grants but does not
revoke accounts already granted access.

## Replenishment

1. Retain the original seed file and outputs for audit and reproduction.
2. Choose a new lowercase batch ID.
3. Run the offline generator with the pinned model and explicit provenance.
4. Inspect the manifest and run the production importer without `--apply`.
5. Apply only after confirming the target and dry-run result.
6. Retain the imported batch and manifest together.

Never overwrite an imported batch under the same batch ID. A new pool requires
a new offline batch and import. Scenarios are shared rather than globally
consumed: every expert account can answer each active scenario once. Importing
ten batches of 50 therefore gives every account up to 500 unanswered scenarios.
Accounts that exhausted the old pool become eligible for newly imported rows
without another access-code grant.

There is currently no scheduler, low-pool alarm, or automatic import. Monitor
feedback collection operationally and replenish before active annotators
exhaust the pool.

## Recovery And Failure Handling

- **Seed file is missing:** restore the exact encrypted backup. Do not create a
  replacement under an existing collection or batch ID.
- **Generation cannot fill quotas:** keep the seed, use a new batch ID, and
  retry a smaller count. Do not weaken validation or hand-edit the output.
- **Manifest review is wrong:** discard both outputs and regenerate with a new
  batch ID if the bad ID might have been distributed or imported.
- **Dry run targets the wrong database:** stop. Because `--apply` was absent,
  no rows were written; correct the environment and rerun.
- **Import reports an identifier conflict:** stop and investigate retained
  batches. The transaction writes nothing.
- **Apply succeeds but the website says no scenarios remain:** verify that the
  frontend and backend revisions are deployed, the import used the same
  production database as the backend, the rows are active, and the account has
  not already answered that batch.
- **Batch files are lost after import:** do not regenerate casually. Restore
  the retained pair so its exact imported bytes and provenance remain auditable.
