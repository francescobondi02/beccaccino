# Backend Scripts

## Overview

Operator shell wrappers for backend tooling. The only subsystem is the
annotation database toolkit, whose wrappers build the backend and run the
compiled `dist/scripts/annotationDatabase.js` against an explicit,
permission-protected environment file.

## Subdirectories & Boundaries

- annotations: [./annotations/README.md](./annotations/README.md) - `status.sh`,
  `import.sh`, `export.sh`, and `_run.sh` (including `restore-active`) for the
  expert annotation catalog; imports and restores are dry runs unless applied
  with the exact plan token, and exports write a new mode-`600` JSONL file
  outside `backend/`.
