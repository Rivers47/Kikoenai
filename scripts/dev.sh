#!/usr/bin/env bash
set -e

# Start both backend and frontend in development mode
echo "Starting Kikoeru monorepo development environment..."
echo "  Backend:  http://localhost:8888"
echo "  Frontend: http://localhost:8080 (proxies /api -> :8888)"
echo ""

# Start backend
echo "Starting backend..."
cd "$(dirname "$0")/../backend"
npm run dev &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend..."
cd "$(dirname "$0")/../frontend"
npm run dev &
FRONTEND_PID=$!

# Trap to kill both on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

echo ""
echo "Both processes running. Press Ctrl+C to stop."
wait