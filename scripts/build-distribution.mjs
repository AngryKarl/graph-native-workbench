import { copyFile, cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const distribution = resolve(root, 'apps/distribution');
const output = resolve(distribution, 'dist');
const manifest = JSON.parse(await readFile(resolve(distribution, 'package.json'), 'utf8'));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'bundle',
  external: ['esbuild'],
  treeShaking: true,
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  define: {
    __GRAPHWORK_PACKAGED__: 'true',
    __GRAPHWORK_VERSION__: JSON.stringify(manifest.version),
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(root, 'apps/cli/src/main.ts')],
    outfile: resolve(output, 'graphwork.js'),
  }),
  build({
    ...shared,
    entryPoints: [resolve(root, 'apps/workbench/src/server.ts')],
    outfile: resolve(output, 'workbench-server.mjs'),
  }),
]);

await Promise.all([
  cp(resolve(root, 'apps/workbench/dist/client'), resolve(output, 'client'), { recursive: true }),
  copyFile(resolve(root, 'packages/pack-sdk/src/isolated-worker.mjs'), resolve(output, 'isolated-worker.mjs')),
]);

const entry = await readFile(resolve(output, 'graphwork.js'), 'utf8');
if (!entry.startsWith('#!/usr/bin/env node')) throw new Error('Distribution entrypoint is missing its Node.js shebang.');
const files = await Promise.all(['graphwork.js', 'workbench-server.mjs', 'isolated-worker.mjs'].map(async (file) => ({
  file,
  bytes: (await stat(resolve(output, file))).size,
})));
console.log(`Built graphwork@${manifest.version}`);
for (const file of files) console.log(`  ${file.file} (${file.bytes} bytes)`);
