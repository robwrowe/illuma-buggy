#!/bin/bash
# Launches Illuma Buggy web config tool (Vite dev server)
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-5173}"

echo "🔦 Illuma Buggy Config Tool"
echo "   Opening http://localhost:$PORT/illuma-buggy/"
echo "   Press Ctrl+C to stop"
echo ""

(sleep 2 && open "http://localhost:$PORT/illuma-buggy/") &

cd "$DIR"
npm run dev -- --host --port "$PORT"
