# Annotation Database Scripts

## Overview

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
absolute path outside `backend/`. The tool rejects only paths inside `backend/`;
keep exports outside the repository too:

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

## Interface

- `_run.sh <command> [args...]`: builds the backend (`npm run build`) and runs
  `node dist/scripts/annotationDatabase.js` with the given arguments.
- `status.sh [args...]`: `_run.sh status`.
- `import.sh [args...]`: `_run.sh import`.
- `export.sh [args...]`: `_run.sh export`.
- `restore-active` has no dedicated wrapper; call `_run.sh restore-active`.
- Commands and flags are parsed by `parseAnnotationDatabaseArgs` in
  `src/scripts/annotationDatabaseCli.ts`; full usage is printed by
  `_run.sh help` (`ANNOTATION_DATABASE_USAGE`). `help` is also selected with no
  arguments or when `--help` or `-h` appears anywhere.

## Invariants

- Every command except `help` requires `--env-file`; the file must be a
  regular, non-symlink file with mode `600` or stricter and must define
  `DATABASE_URL` and `DIRECT_URL` with the same database name; host and port
  are not compared (`src/scripts/annotationEnvironment.ts:loadEnvironmentFile`).
- `--apply` requires `--confirm-plan <token>`, and `--confirm-plan` is valid
  only with `--apply` (`annotationDatabaseCli.ts:parseAnnotationDatabaseArgs`).
  Apply fails unless the recomputed plan token equals the confirmed token
  (`src/scripts/annotationDatabase.ts:annotationImportPlanToken`,
  `annotationRestorePlanToken`).
- Plan tokens also hash the Node version, backend sources, compiled `dist`
  files, these shell wrappers, `package.json`, `package-lock.json`,
  `prisma/schema.prisma`, and `tsconfig.json`, so changing Node or the toolkit
  between dry run and apply invalidates the token
  (`annotationDatabase.ts:annotationDatabaseToolSha256`).
- Import and restore run in a serializable transaction
  (`src/scripts/importAnnotationScenarios.ts:importLoadedAnnotationBatch`,
  `restoreActiveAnnotationBatch`).
- Export requires `--output` to be an absolute path outside `backend/`
  (`annotationDatabaseCli.ts:parseAnnotationDatabaseArgs`, rechecked after
  resolving symlinks) and never overwrites an existing file
  (`src/scripts/atomicAnnotationExport.ts:writeAnnotationExportFile`).
- Export requires `ANNOTATION_EXPORT_SALT` with at least 16 characters
  (`annotationDatabase.ts:main`, `src/scripts/exportAnnotations.ts:pseudonymFor`).

## Side Effects

- Runs `npm run build`, rewriting `backend/dist` (with placeholder local
  database URLs used only for the build step) (`_run.sh`).
- Reads the env file and connects to the target PostgreSQL database.
- `import --apply` inserts `AnnotationScenario` rows, active by default, so
  without `--replace-active` the new batch is active alongside the existing
  active catalog. With `--replace-active` it also toggles `active` flags.
  `restore-active --apply` only toggles `active` flags.
- `export` writes a new mode-`600` JSONL file at `--output`.
- Writes a database-target line to stderr and a JSON summary to stdout.

## Verification

- Run: `cd backend && npx jest tests/unit/annotationDatabase.test.ts tests/unit/exportAnnotations.test.ts`
- Run: `cd backend && npx jest tests/integration/annotationDatabase.test.ts tests/integration/annotationImport.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
