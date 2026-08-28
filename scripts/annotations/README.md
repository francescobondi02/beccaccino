# Annotation Database Scripts

These scripts run the validated backend annotation tooling against an explicit
environment file. Create it at an unpredictable path without following an
existing file or symlink, then open the printed path in a trusted editor:

```sh
ANNOTATION_ENV_FILE="$(mktemp /tmp/becca-prod-annotation.env.XXXXXX)"
export ANNOTATION_ENV_FILE
chmod 600 "$ANNOTATION_ENV_FILE"
printf 'Created %s\n' "$ANNOTATION_ENV_FILE"
```

It must contain both Prisma URLs. Add a stable private export salt only when
exporting responses:

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
ANNOTATION_EXPORT_SALT="at-least-16-private-characters"
```

Inspect the current catalog:

```sh
scripts/annotations/status.sh \
  --env-file "$ANNOTATION_ENV_FILE"
```

Validate a batch without writing:

```sh
scripts/annotations/import.sh \
  ../ai/out/annotations/expert-2026-08-27-v2-b.json \
  ../ai/out/annotations/expert-2026-08-27-v2-b.manifest.json \
  --env-file "$ANNOTATION_ENV_FILE" \
  --replace-active
```

Validation covers the canonical batch and manifest bytes, exact batch hash,
rules and method versions, generator and model provenance, generation
parameters, family quotas, and every published aggregate count.

Apply only after checking the printed database target and dry-run summary. The
dry run emits a plan token bound to the database target, complete connection
settings, compiled toolkit, complete manifest bytes, replacement mode, exact
scenario catalog, and current insert/activation/deactivation counts. Apply
requires that exact token and fails if any relevant input or catalog state
changed:

```sh
scripts/annotations/import.sh \
  ../ai/out/annotations/expert-2026-08-27-v2-b.json \
  ../ai/out/annotations/expert-2026-08-27-v2-b.manifest.json \
  --env-file "$ANNOTATION_ENV_FILE" \
  --replace-active \
  --apply \
  --confirm-plan <token-from-dry-run>
```

Restore a previously imported and retained source batch by its `sourceBatch`.
The dry run confirms that the batch exists and reports the exact activation
and deactivation counts:

```sh
scripts/annotations/_run.sh restore-active expert-2026-08-26-a \
  --env-file "$ANNOTATION_ENV_FILE"
```

After reviewing the target, retained row count, and plan token, apply the same
restore plan:

```sh
scripts/annotations/_run.sh restore-active expert-2026-08-26-a \
  --env-file "$ANNOTATION_ENV_FILE" \
  --apply \
  --confirm-plan <token-from-dry-run>
```

Restore only changes `active` flags in one serializable transaction. It does
not delete scenario rows or expert responses, and apply fails if the catalog
changed after the dry run.

Export pseudonymous, self-contained JSONL to a new mode-`600` file at an
absolute path outside the checkout:

```sh
mkdir -p "$HOME/.becca/annotation-exports"
chmod 700 "$HOME/.becca/annotation-exports"
scripts/annotations/export.sh \
  --env-file "$ANNOTATION_ENV_FILE" \
  --output "$HOME/.becca/annotation-exports/annotations-$(date +%F).jsonl"
```

Export refuses to overwrite an existing path and publishes the file only after
every row validates. Status and dry-run are database-read-only but update local
generated build artifacts. Database credentials and export salts never belong
in the repository or command-line arguments.
