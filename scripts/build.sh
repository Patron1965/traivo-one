#!/bin/bash
set -e

echo "Building static bundles for Expo Go..."

DIST_DIR="dist-metro"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/ios" "$DIST_DIR/android"

echo "Exporting iOS bundle..."
npx expo export:embed \
  --platform ios \
  --entry-file node_modules/expo/AppEntry.js \
  --bundle-output "$DIST_DIR/ios/index.bundle" \
  --assets-dest "$DIST_DIR/ios" \
  --dev false \
  --reset-cache 2>&1

echo "Exporting Android bundle..."
npx expo export:embed \
  --platform android \
  --entry-file node_modules/expo/AppEntry.js \
  --bundle-output "$DIST_DIR/android/index.bundle" \
  --assets-dest "$DIST_DIR/android" \
  --dev false \
  --reset-cache 2>&1

echo "Build complete! Bundles saved to $DIST_DIR/"
ls -la "$DIST_DIR/ios/"
ls -la "$DIST_DIR/android/"
