import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

const outfile = path.resolve('dist', 'index.cjs');

fs.mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile,
  format: 'cjs',
  external: ['pg-native'],
  packages: 'external',
});

console.log(`Built ${outfile}`);
