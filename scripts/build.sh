#!/usr/bin/env bash
set -e

echo "Building Kikoeru..."
echo ""

# Build frontend (outputs directly to backend/dist/ via distDir in quasar.config.js)
echo "1. Building frontend (PWA)..."
cd "$(dirname "$0")/../frontend"
npm run build
echo "   ✓ Frontend built to backend/dist/"

echo ""
echo "2. Backend (Express) is ready to serve."
echo "   Start it with: npm start -w backend"
echo "   Or:            cd backend && npm start"
echo ""
echo "Build complete. ✓"