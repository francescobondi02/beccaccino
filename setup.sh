#!/bin/bash
# Becca Online — Clean Local Setup Script
# Run this from the project root to get everything up and running.

set -e

echo "🐘 Starting database (creates becca + becca_test)..."
finch compose up db -d

echo "⏳ Waiting for Postgres to be ready..."
sleep 3

echo "📦 Installing backend dependencies..."
cd backend
npm install

echo "🔧 Generating Prisma client..."
npx prisma generate

echo "🗃️  Running migrations on becca..."
npx prisma migrate deploy

echo "🗃️  Pushing schema to becca_test..."
npm run db:test:prepare

cd ..

echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start developing:"
echo "  Terminal 1: cd backend && npm run dev"
echo "  Terminal 2: cd frontend && npm run dev"
echo ""
echo "To run tests:"
echo "  cd backend && npm test"
echo ""
echo "To clean up everything:"
echo "  ./cleanup.sh"
