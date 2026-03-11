#!/bin/bash
set -e

echo "=== Post-merge setup ==="

echo "Installing npm dependencies..."
npm install --legacy-peer-deps

echo "Rebuilding server bundle..."
npx esbuild server/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=server-dist/index.js \
  --external:pg-native \
  --packages=external

echo "=== Post-merge setup complete ==="
