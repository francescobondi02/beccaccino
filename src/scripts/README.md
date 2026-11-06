# Operator Scripts

## Overview

Command-line tools compiled to `dist/scripts` and run with Node: the annotation
database operator (status, dry-run/apply import, active-catalog restore, and
pseudonymous JSONL export) and the archived practice-match JSONL export. The
shell wrappers that build and invoke the annotation operator are documented in
`backend/scripts/annotations/README.md`.

## Interface

- `annotationDatabase.ts` (entry point when run directly)
  - `annotationImportPlanToken(input)`, `annotationRestorePlanToken(input)`:
    SHA-256 plan tokens.
  - `main()` dispatches `help`, `status`, `import`, `restore-active`, `export`.
- `annotationDatabaseCli.ts`
  - type `AnnotationDatabaseCommand`, `ANNOTATION_DATABASE_USAGE`,
    `parseAnnotationDatabaseArgs(argv)`.
- `annotationEnvironment.ts`
  - Types `DatabaseUrlDescription`, `AnnotationDatabaseTargets`,
    `LoadedAnnotationEnvironment`.
  - `describeDatabaseUrl(value)`, `loadEnvironmentFile(path)`.
- `annotationDatabaseStatus.ts`
  - `annotationDatabaseStatus(prisma)`: `{ scenarioCount, activeScenarioCount, responseCount, catalogs }`.
- `annotationToolPaths.ts`
  - `BACKEND_DIRECTORY`.
- `atomicAnnotationExport.ts`
  - `writeAnnotationExportFile(outputPath, records)`.
- `importAnnotationScenarios.ts`
  - Types `AnnotationBatchManifest`, `AnnotationImportSummary`,
    `AnnotationImportOptions`, `AnnotationRestoreSummary`,
    `AnnotationRestoreOptions`, `LoadedAnnotationBatch`.
  - `readAnnotationBatch(batchPath, manifestPath)`,
    `importLoadedAnnotationBatch(batch, options, client?)`,
    `restoreActiveAnnotationBatch(sourceBatch, options, client?)`,
    `importAnnotationBatch(batchPath, manifestPath, options, client?)`.
- `exportAnnotations.ts`
  - `annotationExportRecord(annotation, salt)`,
    `annotationExportRecords(prisma, salt)`.
- `exportPracticeMatches.ts` (entry point when run directly; `npm run practice:export`)
  - `practiceExportRecord(match)`.

## Invariants

- Database writes happen only for `import` or `restore-active` with `--apply`,
  which requires `--confirm-plan`; apply recomputes the plan inside the
  transaction and throws unless its token equals the confirmed token
  (`annotationDatabaseCli.ts:parseAnnotationDatabaseArgs`,
  `annotationDatabase.ts:main`).
- Plan tokens bind database targets, the SHA-256 of both connection URLs, a
  toolkit hash (Node version, `src/**/*.ts`, matching `dist` files,
  `scripts/annotations/*.sh`, `package.json`, `package-lock.json`,
  `prisma/schema.prisma`, `tsconfig.json`), and the plan summary including the
  catalog hash; import tokens also bind the manifest hash and replace mode
  (`annotationDatabase.ts:annotationImportPlanToken`,
  `annotationRestorePlanToken`, `annotationDatabaseToolSha256`).
- `--env-file` must be a regular, non-symlink file with no group or other
  permissions; it must define `DATABASE_URL` and `DIRECT_URL` as
  `postgres:`/`postgresql:` URLs naming the same database. A missing
  `ANNOTATION_EXPORT_SALT` in the file removes it from `process.env`
  (`annotationEnvironment.ts:loadEnvironmentFile`).
- Batch and manifest files must be canonical JSON (sorted keys plus trailing
  newline). The manifest must match exact keys, `batchId` pattern, SHA-256
  fields, `rulesVersion` `becca-annotation-rules-v2`, `methodVersion`
  `offline-full-pool-public-impact-diversity-v2`, even family quotas over
  `borderline_briscola`, `lead`, `risk`, `maxScenariosPerSourceGame` 2,
  `diversityPenalty` 0.12, scenario codes `<batchId>-NNNNN`, and every count
  and the batch SHA-256 (`importAnnotationScenarios.ts:parseManifest`,
  `readAnnotationBatch`).
- Every batch scenario must use `useful` importance and exactly one V2 family
  tag (`importAnnotationScenarios.ts:expectedBatchCounts`).
- Import is idempotent: existing scenarios matching by both code and state hash
  with identical content are skipped; partial or different matches throw an
  identifier conflict. `--replace-active` activates the batch codes and
  deactivates all other active scenarios. Import and restore run in
  serializable transactions, and restore only changes `active` flags
  (`importAnnotationScenarios.ts:importLoadedAnnotationBatch`,
  `restoreActiveAnnotationBatch`).
- Export validates every record before writing: the response hash must match
  the scenario, vocabularies and the stored state must parse, and the selected
  action must be legal. Annotator ids are replaced by an HMAC-SHA256 pseudonym
  keyed by `ANNOTATION_EXPORT_SALT` (at least 16 characters)
  (`exportAnnotations.ts:annotationExportRecord`, `annotationExportRecords`).
- Export output must be an absolute path outside the backend checkout (checked
  on the argument and again on the canonical parent directory); the file is
  written with mode `600` in a temporary sibling directory, fsynced, and
  hard-linked into place, refusing to overwrite an existing path
  (`annotationDatabaseCli.ts`, `atomicAnnotationExport.ts:writeAnnotationExportFile`).
- Practice export rejects matches whose `schemaVersion` differs from
  `PRACTICE_MATCH_PAYLOAD_VERSION`, whose payload does not parse, or that have
  no human actions (`exportPracticeMatches.ts:practiceExportRecord`).

## Side Effects

- Reads the env file and sets `DATABASE_URL`, `DIRECT_URL`, and
  `ANNOTATION_EXPORT_SALT` in `process.env` (`annotationEnvironment.ts`).
- Reads backend source, build, and config files to hash the toolkit
  (`annotationDatabase.ts`).
- Prisma reads of `AnnotationScenario`, `ExpertAnnotation`, and
  `PracticeMatch`; `AnnotationScenario` inserts and `active` updates on apply.
- Writes an export file plus a temporary directory next to it (removed
  afterwards) (`atomicAnnotationExport.ts`).
- Writes JSON results to stdout and the database target or errors to stderr;
  sets `process.exitCode = 1` on failure.

## Verification

- Run: `cd backend && npx jest tests/unit/annotationDatabase.test.ts tests/unit/exportAnnotations.test.ts`
- Run: `cd backend && npx jest tests/integration/annotationDatabase.test.ts tests/integration/annotationImport.test.ts tests/integration/practiceArchive.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
