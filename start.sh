#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3360}"

case "${1:-up}" in
  up)
    if [ ! -d server/node_modules ]; then
      echo "Installing dependencies…"
      cd server && npm install && cd ..
    fi
    echo "Starting Huntflow Clone on port $PORT…"
    PORT="$PORT" node server/index.mjs
    ;;
  docker)
    docker compose up -d --build
    echo "→ http://localhost:$PORT"
    ;;
  down)
    if [ -f docker-compose.yml ]; then docker compose down; fi
    pkill -f "node server/index.mjs" 2>/dev/null || true
    ;;
  *) echo "Usage: ./start.sh [up|docker|down]"; exit 1 ;;
esac
