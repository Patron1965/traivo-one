#!/bin/bash
set -e

echo "Building Hermes bytecode bundles for Expo Go..."

EXPORT_DIR="dist-export"
rm -rf "$EXPORT_DIR"

echo "Exporting iOS + Android bundles with Hermes bytecode..."
npx expo export --platform all --output-dir "$EXPORT_DIR" --clear 2>&1

echo "Build complete!"
cat "$EXPORT_DIR/metadata.json" | node -e "process.stdin.on('data', d => { const m = JSON.parse(d); Object.entries(m.fileMetadata).forEach(([k,v]) => console.log(k + ': ' + v.bundle + ' (' + v.assets.length + ' assets)')) })"

echo "Compiling server TypeScript..."
rm -rf server-dist
npx tsc --outDir server-dist --esModuleInterop --resolveJsonModule --module commonjs --target es2020 --skipLibCheck --allowSyntheticDefaultImports --moduleResolution node server/app.ts 2>&1 || echo "TSC failed, will use tsx at runtime"
if [ -f "server-dist/app.js" ]; then
  echo "Server compiled to server-dist/"
  ls -la server-dist/
else
  echo "Warning: Server compilation failed"
fi
