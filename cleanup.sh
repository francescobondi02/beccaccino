#!/bin/bash
# Becca Online — Full Cleanup Script
# Removes all local artifacts so you're back to a clean state.

set -e

echo "🧹 Stopping and removing containers + volumes..."
docker compose down -v 2>/dev/null || echo "  (no containers running)"

echo "🗑️  Removing backend node_modules..."
rm -rf backend/node_modules

echo "🗑️  Removing frontend node_modules..."
rm -rf frontend/node_modules

echo "🗑️  Removing mobile node_modules..."
rm -rf mobile/node_modules

echo "✅ Done! Project is clean."
