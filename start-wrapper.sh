#!/bin/bash

# Kill any existing process on port 5000
existing_pid=$(lsof -ti :5000 2>/dev/null)
if [ -n "$existing_pid" ]; then
  echo "[wrapper] Killing existing process on port 5000: $existing_pid"
  kill -9 $existing_pid 2>/dev/null
  sleep 1
fi

echo "[wrapper] Starting server at $(date)"

# Build first if dist doesn't exist
if [ ! -f dist/index.cjs ]; then
  echo "[wrapper] Building..."
  npm run build
fi

exec node dist/index.cjs
