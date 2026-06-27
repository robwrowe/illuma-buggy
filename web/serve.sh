#!/bin/bash
# Launches Illuma Buggy web config tool on http://localhost:3000
# Requires Python 3 (comes with macOS)

PORT=3000
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔦 Illuma Buggy Config Tool"
echo "   Opening http://localhost:$PORT"
echo "   Press Ctrl+C to stop"
echo ""

# Open browser after 1 second
(sleep 1 && open "http://localhost:$PORT") &

# Serve the directory
cd "$DIR"
python3 -m http.server $PORT
