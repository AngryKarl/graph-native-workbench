import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const distribution = resolve(root, 'apps/distribution');
const destination = resolve(root, 'release/npm');
await mkdir(destination, { recursive: true });

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) throw new Error('Run distribution packing through "pnpm dist:pack".');
const child = spawn(process.execPath, [pnpmEntry, 'pack', '--pack-destination', destination], {
  cwd: distribution,
  stdio: 'inherit',
});
const code = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', resolveExit);
});
if (code !== 0) throw new Error(`pnpm pack exited with code ${code}.`);
