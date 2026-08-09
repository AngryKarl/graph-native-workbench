import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphRuntime, InMemoryContextGraphStore, compilePack } from '@graphwork/core';
import {
  buildPackArtifact,
  createContainerIsolationCommand,
  fetchSignedPackRegistry,
  inspectPackArtifact,
  inspectInstalledPack,
  installPackArtifact,
  installPackFromSignedRegistry,
  listInstalledPacks,
  loadInstalledPackIsolated,
  scaffoldPack,
  signPackRegistry,
  verifySignedPackRegistry,
  type SignedPackRegistryPayload,
} from '@graphwork/pack-sdk';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  })));
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  delete process.env.GRAPHWORK_ISOLATION_SECRET;
});

async function packFixture(id: string) {
  const directory = await mkdtemp(resolve('tests', '.tmp-security-'));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, 'source');
  await scaffoldPack(id, sourceDirectory);
  const source = resolve(sourceDirectory, 'src/index.ts');
  const artifact = resolve(directory, `${id}.gpack`);
  await buildPackArtifact({ source, output: artifact });
  return { directory, source, artifact, root: resolve(directory, 'packs') };
}

function registryPayload(artifact: string): SignedPackRegistryPayload {
  const inspected = inspectPackArtifact(artifact);
  const now = Date.now();
  return {
    formatVersion: 1,
    registry: { id: 'official', name: 'Official test registry' },
    generatedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    packs: [{
      id: inspected.manifest.id,
      version: inspected.manifest.version,
      artifact: `/${inspected.manifest.id}.gpack`,
      artifactChecksum: inspected.checksum,
      engineRange: inspected.descriptor.engine.graphwork,
      permissions: inspected.descriptor.permissions,
    }],
  };
}

async function registryServer(document: unknown, artifact: string): Promise<string> {
  const artifactBytes = await readFile(artifact);
  const server = createServer((request, response) => {
    if (request.url === '/registry.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(document));
      return;
    }
    if (request.url?.endsWith('.gpack')) {
      response.writeHead(200, { 'content-type': 'application/vnd.graphwork.gpack' });
      response.end(artifactBytes);
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('Test registry did not bind a TCP port.');
  return `http://127.0.0.1:${bound.port}/registry.json`;
}

describe('signed Pack registry', () => {
  it('aborts a chunked Registry response at the byte limit', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      for (let index = 0; index < 17; index += 1) response.write(Buffer.alloc(64 * 1024));
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const bound = server.address();
    if (!bound || typeof bound === 'string') throw new Error('Oversized Registry server did not bind.');
    await expect(fetchSignedPackRegistry(`http://127.0.0.1:${bound.port}/registry.json`, {
      trustedKeys: {},
      allowInsecureHttp: true,
    })).rejects.toThrow(/1048576 byte limit/);
  });

  it('verifies publisher identity, expiry and tamper evidence', async () => {
    const fixture = await packFixture('signed_ops');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signPackRegistry(registryPayload(fixture.artifact), 'publisher.test', privateKey);
    const verified = verifySignedPackRegistry(signed, { trustedKeys: { 'publisher.test': publicKey } });

    expect(verified.publisherKeyId).toBe('publisher.test');
    expect(verified.payload.packs[0]?.id).toBe('signed_ops');
    expect(() => verifySignedPackRegistry({
      ...signed,
      payload: { ...signed.payload, registry: { ...signed.payload.registry, name: 'Tampered' } },
    }, { trustedKeys: { 'publisher.test': publicKey } })).toThrow(/signature verification failed/);
    expect(() => verifySignedPackRegistry(signed, {
      trustedKeys: { 'publisher.test': publicKey },
      now: new Date(Date.parse(signed.payload.expiresAt) + 1),
    })).toThrow(/expired/);
  });

  it('downloads and installs only the artifact bound by signed metadata', async () => {
    const fixture = await packFixture('signed_install');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signPackRegistry(registryPayload(fixture.artifact), 'publisher.install', privateKey);
    const registry = await registryServer(signed, fixture.artifact);

    await expect(installPackFromSignedRegistry(registry, 'signed_install', '0.1.0', {
      trustedKeys: { 'publisher.install': publicKey },
      root: fixture.root,
    })).rejects.toThrow(/require HTTPS/);

    const installed = await installPackFromSignedRegistry(registry, 'signed_install', '0.1.0', {
      trustedKeys: { 'publisher.install': publicKey },
      root: fixture.root,
      allowInsecureHttp: true,
    });
    expect(installed.trustSource).toEqual({
      mode: 'signed-registry',
      publisherKeyId: 'publisher.install',
      registry,
    });
    expect(listInstalledPacks(fixture.root).packs.signed_install?.activeVersion).toBe('0.1.0');

    const descriptorPath = resolve(installed.directory, 'graphwork.pack.json');
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { permissions: string[] };
    descriptor.permissions.push('network');
    await writeFile(descriptorPath, JSON.stringify(descriptor), 'utf8');
    await expect(inspectInstalledPack('signed_install', fixture.root)).rejects.toThrow(/descriptor integrity/);
  });
});

describe('isolated Pack workers', () => {
  it('builds a deny-by-default container boundary without exposing environment values', () => {
    const command = createContainerIsolationCommand(
      resolve('packs/example/dist/index.mjs'),
      { container: {}, environment: { PACK_TOKEN: 'not-on-the-command-line' } },
      'test-boundary',
    );
    expect(command.command).toBe('docker');
    expect(command.args).toEqual(expect.arrayContaining([
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=65532:65532',
      '--env',
      'PACK_TOKEN',
    ]));
    expect(command.args.join(' ')).not.toContain('not-on-the-command-line');
    expect(() => createContainerIsolationCommand('pack.mjs', {
      container: { network: 'bridge' },
    })).toThrow(/requires allowNetwork approval/);
  });

  it('keeps parent secrets out of handlers, isolates projectors and denies undeclared writes', async () => {
    const fixture = await packFixture('isolated_ops');
    const original = await readFile(fixture.source, 'utf8');
    await writeFile(fixture.source, original
      .replace("import { defineHandlers, definePack } from '@graphwork/pack-sdk';", "import { writeFileSync } from 'node:fs';\nimport { defineHandlers, definePack } from '@graphwork/pack-sdk';")
      .replace(
        "'isolated_ops.produce': ({ state }) => ({ result: 'Pack isolated_ops processed: ' + String(state.topic) }),",
        "'isolated_ops.produce': ({ state }) => { if (state.topic === 'filesystem') writeFileSync('escape.txt', 'blocked'); if (state.topic === 'loop') while (true) {} return { result: process.env.GRAPHWORK_ISOLATION_SECRET ?? 'hidden' }; },",
      ), 'utf8');
    await buildPackArtifact({ source: fixture.source, output: fixture.artifact });
    installPackArtifact(fixture.artifact, { root: fixture.root, trust: true });
    process.env.GRAPHWORK_ISOLATION_SECRET = 'parent-secret';

    const loaded = await loadInstalledPackIsolated('isolated_ops', fixture.root, { unsafeProcessIsolation: true });
    expect(loaded.isolationMode).toBe('unsafe-process');
    const graph = compilePack(loaded.pack).graphs.get('isolated_ops.workflow');
    if (!graph) throw new Error('Isolated test graph is missing.');
    const completed = await new GraphRuntime(graph, { handlers: loaded.handlers, pack: loaded.pack })
      .run({ topic: 'environment' });
    expect(completed.status).toBe('completed');
    expect(completed.state.result).toBe('hidden');

    const context = new InMemoryContextGraphStore(loaded.pack);
    await loaded.projector?.(context, completed);
    expect(await context.listObjects()).toHaveLength(1);

    const denied = await new GraphRuntime(graph, { handlers: loaded.handlers, pack: loaded.pack })
      .run({ topic: 'filesystem' });
    expect(denied.status).toBe('failed');
    expect(denied.status === 'failed' ? denied.error.message : '').toMatch(/permission|access/i);
    expect(existsSync(resolve(dirnameFromArtifact(fixture.root), 'escape.txt'))).toBe(false);

    const timeBound = await loadInstalledPackIsolated('isolated_ops', fixture.root, {
      unsafeProcessIsolation: true,
      maxExecutionMs: 500,
    });
    const timedOut = await new GraphRuntime(graph, { handlers: timeBound.handlers, pack: timeBound.pack })
      .run({ topic: 'loop' });
    expect(timedOut.status).toBe('failed');
    expect(timedOut.status === 'failed' ? timedOut.error.message : '').toMatch(/exceeded 500ms/);
  }, 15_000);
});

function dirnameFromArtifact(root: string): string {
  return resolve(root, 'isolated_ops', '0.1.0', 'dist');
}
