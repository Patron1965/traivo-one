#!/bin/bash
trap 'kill $(jobs -p) 2>/dev/null; exit 0' SIGTERM SIGINT

while true; do
  npx tsx server/index.ts &
  SERVER_PID=$!
  wait $SERVER_PID
  EXIT_CODE=$?
  echo "Server exited with code $EXIT_CODE, restarting in 1 second..."
  sleep 1
done
