#!/bin/bash
set -e

echo "Building Driver Core..."

METRO_URL="http://localhost:8081"
OUTPUT_DIR="dist-metro"

echo "Step 1: Compiling TypeScript server..."
mkdir -p server-dist
npx esbuild server/app.ts --bundle --platform=node --target=node20 --outfile=server-dist/app.js --external:pg-native --packages=external
echo "  Server compiled to server-dist/app.js"

echo "Step 2: Metro JS bundles..."
if curl -s --max-time 5 "$METRO_URL/status" 2>/dev/null | grep -q "packager-status:running"; then
  echo "  Metro dev server detected, fetching fresh bundles..."
  mkdir -p "$OUTPUT_DIR/ios" "$OUTPUT_DIR/android"

  echo "  Fetching iOS bundle..."
  curl -s --max-time 180 "$METRO_URL/index.bundle?platform=ios&dev=false&minify=false&lazy=true" -o "$OUTPUT_DIR/ios/index.bundle"
  IOS_SIZE=$(wc -c < "$OUTPUT_DIR/ios/index.bundle")
  echo "    iOS bundle: $IOS_SIZE bytes"

  echo "  Fetching Android bundle..."
  curl -s --max-time 180 "$METRO_URL/index.bundle?platform=android&dev=false&minify=false&lazy=true" -o "$OUTPUT_DIR/android/index.bundle"
  ANDROID_SIZE=$(wc -c < "$OUTPUT_DIR/android/index.bundle")
  echo "    Android bundle: $ANDROID_SIZE bytes"

  if [ "$IOS_SIZE" -lt 1000 ] || [ "$ANDROID_SIZE" -lt 1000 ]; then
    echo "  Warning: Bundle sizes too small. Metro may have returned an error."
  fi
else
  echo "  Metro dev server not running."
  if [ -f "$OUTPUT_DIR/ios/index.bundle" ] && [ -f "$OUTPUT_DIR/android/index.bundle" ]; then
    echo "  Using existing pre-built bundles:"
    echo "    iOS: $(wc -c < "$OUTPUT_DIR/ios/index.bundle") bytes"
    echo "    Android: $(wc -c < "$OUTPUT_DIR/android/index.bundle") bytes"
  else
    echo "  No pre-built bundles found. Expo Go mobile access will be unavailable."
    echo "  To build bundles, start Metro (npx expo start --web --port 8081) and re-run this script."
    mkdir -p "$OUTPUT_DIR/ios" "$OUTPUT_DIR/android"
  fi
fi

echo "Build complete!"
