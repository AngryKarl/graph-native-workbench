import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const expectedVersion = JSON.parse(
  await readFile(resolve(root, 'apps/distribution/package.json'), 'utf8'),
).version;
const cli = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, 'apps/distribution/dist/graphwork.js');

function run(args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolveRun({ stdout, stderr })
      : reject(new Error(`graphwork ${args.join(' ')} exited ${code}.\n${stdout}${stderr}`)));
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a Workbench smoke-test port.');
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitForWorkbench(url, child, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Workbench exited early.\n${output()}`);
    try {
      const response = await fetch(`${url}/api/workbench`);
      if (response.ok) return response.json();
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Packaged Workbench did not start within 15 seconds.\n${output()}`);
}

const workspace = await mkdtemp(join(tmpdir(), 'graphwork-distribution-'));
let serverChild;
try {
  const version = await run(['--version'], workspace);
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(`Unexpected distribution version: ${version.stdout}`);
  }
  const demo = await run(['demo'], workspace);
  if (!demo.stdout.includes('Context graph: 7 objects, 9 typed relations')) throw new Error('Packaged demo output is incomplete.');

  await run(['pack', 'init', 'distribution_smoke'], workspace);
  const packDirectory = resolve(workspace, 'packs/distribution_smoke');
  const manifest = JSON.parse(await readFile(resolve(packDirectory, 'package.json'), 'utf8'));
  if (manifest.dependencies) throw new Error('Standalone scaffold unexpectedly requires package dependencies.');
  const source = resolve(packDirectory, 'src/index.mjs');
  await stat(source);
  await run(['pack', 'validate', source], workspace);
  await run(['pack', 'test', source], workspace);
  const artifact = resolve(workspace, 'distribution_smoke-0.1.0.gpack');
  await run(['pack', 'build', source, '--output', artifact], workspace);
  await stat(artifact);
  const executed = await run(['pack', 'run', source, '--set', 'topic=distribution'], workspace);
  if (!executed.stdout.includes('Pack distribution_smoke processed: distribution')) {
    throw new Error('Standalone Pack did not execute through the packaged CLI.');
  }
  await run(['pack', 'install', artifact, '--trust'], workspace);
  const isolated = await run(['pack', 'run', 'distribution_smoke', '--installed', '--set', 'topic=isolated'], workspace);
  if (!isolated.stdout.includes('Pack distribution_smoke processed: isolated')) {
    throw new Error('Installed Pack did not execute through the packaged isolated Worker.');
  }

  const port = await freePort();
  let serverOutput = '';
  serverChild = spawn(process.execPath, [cli, 'workbench', '--port', String(port), '--no-open'], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverChild.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  serverChild.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const bootstrap = await waitForWorkbench(url, serverChild, () => serverOutput);
  if (!Array.isArray(bootstrap.catalog) || bootstrap.catalog.length < 3) throw new Error('Packaged Workbench catalog is incomplete.');
  const health = await (await fetch(`${url}/api/health`)).json();
  if (health.status !== 'ok') throw new Error('Packaged Workbench health endpoint is not ready.');
  const html = await (await fetch(url)).text();
  if (!html.includes('Graph Native Workbench')) throw new Error('Packaged Workbench client assets were not served.');

  console.log('Distribution smoke test passed: version, demo, standalone Pack, isolated install and Workbench.');
} finally {
  if (serverChild && serverChild.exitCode === null) {
    serverChild.kill();
    await Promise.race([
      new Promise((resolveExit) => serverChild.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
  }
  await rm(workspace, { recursive: true, force: true });
}
