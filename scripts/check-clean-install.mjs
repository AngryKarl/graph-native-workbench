import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'apps/distribution/package.json'), 'utf8'));
const tarball = resolve(root, `release/npm/graph-workbench-${manifest.version}.tgz`);
const installation = await mkdtemp(join(tmpdir(), 'graph-workbench-clean-install-'));

function run(command, args, cwd = installation) {
  return new Promise((resolveRun, reject) => {
    const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const windowsNpm = command === 'npm' && process.platform === 'win32';
    const executable = windowsNpm ? process.execPath : command;
    const resolvedArgs = windowsNpm ? [npmCli, ...args] : args;
    const child = spawn(executable, resolvedArgs, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

try {
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const installedCli = resolve(installation, 'node_modules/graph-workbench/dist/graph-workbench.js');
  await run(process.execPath, [resolve(root, 'scripts/check-distribution.mjs'), installedCli], root);
  console.log(`Clean-install smoke test passed for graph-workbench@${manifest.version}.`);
} finally {
  await rm(installation, { recursive: true, force: true });
}
