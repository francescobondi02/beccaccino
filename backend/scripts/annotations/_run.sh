#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BACKEND_DIR"
DATABASE_URL="postgresql://operator:operator@localhost:5432/becca_operator_build" \
DIRECT_URL="postgresql://operator:operator@localhost:5432/becca_operator_build" \
  npm run build --silent >&2
exec node dist/scripts/annotationDatabase.js "$@"
