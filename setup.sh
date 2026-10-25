#!/bin/bash
# Becca Online — Clean Local Setup Script
# Run this from the project root to get everything up and running.

set -e

# Never let an inherited production URL affect local setup or migrations.
export NODE_ENV=development
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/becca'
export DIRECT_URL="$DATABASE_URL"

echo "🐘 Starting database (creates becca + becca_test)..."
docker compose --env-file backend/.env up db -d --wait

echo "📦 Installing backend dependencies..."
cd backend
npm install

echo "🔧 Generating Prisma client..."
npx prisma generate

echo "🗃️  Running migrations on becca..."
npx prisma migrate deploy

echo "🗃️  Pushing schema to becca_test..."
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/becca_test' \
DIRECT_URL='postgresql://postgres:postgres@localhost:5432/becca_test' \
npx prisma db push --skip-generate

cd ..

echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start developing:"
echo "  make dev"
echo ""
echo "To run tests:"
echo "  cd backend && npm test"
echo ""
echo "To clean up everything:"
echo "  ./cleanup.sh"
