#!/bin/bash
set -e

echo "Building Driver Core for production..."

echo "Step 1: Compiling TypeScript server..."
npx tsc --project tsconfig.server.json 2>/dev/null || npx esbuild server/app.ts --bundle --platform=node --target=node20 --outfile=server-dist/app.js --external:pg-native --packages=external

echo "Step 2: Checking Metro bundles..."
if [ -f "dist-metro/ios/index.bundle" ] && [ -f "dist-metro/android/index.bundle" ]; then
  IOS_SIZE=$(wc -c < "dist-metro/ios/index.bundle")
  ANDROID_SIZE=$(wc -c < "dist-metro/android/index.bundle")
  echo "  iOS bundle: $IOS_SIZE bytes"
  echo "  Android bundle: $ANDROID_SIZE bytes"
else
  echo "  Warning: Metro bundles not found in dist-metro/"
  echo "  Expo Go will not work until bundles are built in development"
  mkdir -p dist-metro/ios dist-metro/android
fi

echo "Build complete!"
