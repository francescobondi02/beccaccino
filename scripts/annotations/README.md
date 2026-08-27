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

Apply only after checking the printed database target and dry-run summary. The
dry run emits a plan token bound to the database target, complete connection
settings, compiled toolkit, batch hash, replacement mode, exact scenario
catalog, and current insert/activation/deactivation counts. Apply requires that
exact token and fails if any relevant input or catalog state changed:

```sh
scripts/annotations/import.sh \
  ../ai/out/annotations/expert-2026-08-27-v2-b.json \
  ../ai/out/annotations/expert-2026-08-27-v2-b.manifest.json \
  --env-file "$ANNOTATION_ENV_FILE" \
  --replace-active \
  --apply \
  --confirm-plan <token-from-dry-run>
```

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
