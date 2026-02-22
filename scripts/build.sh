#!/bin/bash
set -e

echo "Building Metro JS bundles for Expo Go..."

METRO_URL="http://localhost:8081"
OUTPUT_DIR="dist-metro"

if ! curl -s --max-time 5 "$METRO_URL/status" | grep -q "packager-status:running"; then
  echo "Error: Metro dev server not running on port 8081. Start it first."
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/ios" "$OUTPUT_DIR/android"

echo "Fetching iOS bundle from Metro..."
curl -s --max-time 180 "$METRO_URL/index.bundle?platform=ios&dev=false&minify=false&lazy=true" -o "$OUTPUT_DIR/ios/index.bundle"
IOS_SIZE=$(wc -c < "$OUTPUT_DIR/ios/index.bundle")
echo "  iOS bundle: $IOS_SIZE bytes"

echo "Fetching Android bundle from Metro..."
curl -s --max-time 180 "$METRO_URL/index.bundle?platform=android&dev=false&minify=false&lazy=true" -o "$OUTPUT_DIR/android/index.bundle"
ANDROID_SIZE=$(wc -c < "$OUTPUT_DIR/android/index.bundle")
echo "  Android bundle: $ANDROID_SIZE bytes"

if [ "$IOS_SIZE" -lt 1000 ] || [ "$ANDROID_SIZE" -lt 1000 ]; then
  echo "Error: Bundle sizes too small. Metro may have returned an error."
  exit 1
fi

echo "Build complete!"
echo "  iOS: $(echo "scale=1; $IOS_SIZE / 1048576" | bc) MB"
echo "  Android: $(echo "scale=1; $ANDROID_SIZE / 1048576" | bc) MB"
