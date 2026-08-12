import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPackArtifact,
  inspectInstalledPack,
  registryPayloadFromArtifacts,
  scaffoldPack,
  signPackRegistry,
} from '@graph-workbench/pack-sdk';
import { loadRegistryTrustConfig, WorkbenchRegistryService } from '../apps/workbench/src/registry-service.js';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  })));
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Workbench Registry catalog', () => {
  it('loads no sources when the trust file is absent', async () => {
    await expect(loadRegistryTrustConfig(resolve('tests', '.missing-trust.json'))).resolves.toEqual({
      formatVersion: 1,
      registries: [],
    });
  });

  it('aliases the legacy reference Registry key id during migration', async () => {
    const directory = await mkdtemp(resolve('tests', '.tmp-workbench-trust-migration-'));
    temporaryDirectories.push(directory);
    const configPath = resolve(directory, 'trust.json');
    await writeFile(configPath, JSON.stringify({
      formatVersion: 1,
      registries: [{
        id: 'reference',
        url: 'https://angrykarl.github.io/graphwork/registry/registry.json',
        trustedKeys: [{ keyId: 'graphwork.reference.v1', publicKeyPath: 'publisher-public.pem' }],
      }],
    }));

    await expect(loadRegistryTrustConfig(configPath)).resolves.toMatchObject({
      registries: [{
        url: 'https://angrykarl.github.io/graph-workbench/registry/registry.json',
        trustedKeys: [
          { keyId: 'graphwork.reference.v1' },
          { keyId: 'graph-workbench.reference.v1' },
        ],
      }],
    });
  });

  it('browses verified metadata and re-verifies an artifact before installation', async () => {
    const directory = await mkdtemp(resolve('tests', '.tmp-workbench-registry-'));
    temporaryDirectories.push(directory);
    const source = resolve(directory, 'source');
    const artifact = resolve(directory, 'catalog_pack.gpack');
    const packRoot = resolve(directory, 'packs');
    await scaffoldPack('catalog_pack', source);
    await buildPackArtifact({ source: resolve(source, 'src/index.ts'), output: artifact });

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await writeFile(resolve(directory, 'publisher-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    const now = Date.now();
    const payload = registryPayloadFromArtifacts({
      id: 'verified_catalog',
      name: 'Verified catalog',
      generatedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
      artifacts: [{ path: artifact, url: '/catalog_pack.gpack' }],
    });
    const signed = signPackRegistry(payload, 'publisher.catalog', privateKey);
    const artifactBytes = await readFile(artifact);
    const server = createServer((request, response) => {
      if (request.url === '/registry.json') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(signed));
      } else if (request.url === '/catalog_pack.gpack') {
        response.writeHead(200, { 'content-type': 'application/vnd.graph-workbench.gpack' });
        response.end(artifactBytes);
      } else {
        response.writeHead(404).end();
      }
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Registry server did not bind.');

    const configPath = resolve(directory, 'trust.json');
    await writeFile(configPath, JSON.stringify({
      formatVersion: 1,
      registries: [{
        id: 'catalog',
        url: `http://127.0.0.1:${address.port}/registry.json`,
        allowInsecureHttp: true,
        trustedKeys: [{ keyId: 'publisher.catalog', publicKeyPath: 'publisher-public.pem' }],
      }],
    }));
    const service = await WorkbenchRegistryService.fromConfigFile(configPath, packRoot);

    expect((await service.catalog())[0]).toMatchObject({
      id: 'catalog',
      name: 'Verified catalog',
      status: 'verified',
      publisherKeyId: 'publisher.catalog',
      packs: [{
        id: 'catalog_pack',
        name: 'Catalog Pack Pack',
        installed: false,
        compatible: true,
        compatibilityMessage: 'Compatible with Graph Workbench 0.4.0.',
      }],
    });

    await service.install('catalog', 'catalog_pack', '0.1.0');
    expect((await service.catalog())[0]).toMatchObject({ packs: [{ installed: true, active: true }] });
    await expect(inspectInstalledPack('catalog_pack', packRoot)).resolves.toMatchObject({
      installation: { trustSource: { mode: 'signed-registry', publisherKeyId: 'publisher.catalog' } },
    });
  });

  it('rejects non-loopback HTTP trust sources', async () => {
    const directory = await mkdtemp(resolve('tests', '.tmp-workbench-trust-'));
    temporaryDirectories.push(directory);
    const configPath = resolve(directory, 'trust.json');
    await writeFile(configPath, JSON.stringify({
      formatVersion: 1,
      registries: [{
        id: 'unsafe',
        url: 'http://example.com/registry.json',
        allowInsecureHttp: true,
        trustedKeys: [{ keyId: 'publisher', publicKeyPath: 'publisher.pem' }],
      }],
    }));
    await expect(loadRegistryTrustConfig(configPath)).rejects.toThrow(/HTTP only on localhost/);
  });
});
