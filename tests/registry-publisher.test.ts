import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPackRegistryRelease,
  inspectPackArtifact,
  signPackRegistry,
  verifySignedPackRegistry,
} from '@graphwork/pack-sdk';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Registry release publisher', () => {
  it('builds the reference Packs into a signable HTTPS catalog', async () => {
    const outputDirectory = await mkdtemp(resolve('tests', '.tmp-registry-release-'));
    temporaryDirectories.push(outputDirectory);
    const configPath = resolve('registry/reference.json');
    const now = new Date('2026-08-04T12:00:00.000Z');
    const release = await buildPackRegistryRelease(
      JSON.parse(await readFile(configPath, 'utf8')) as unknown,
      {
        configDirectory: resolve('registry'),
        outputDirectory,
        artifactBaseUrl: 'https://github.com/example/project/releases/download/packs-v0.2.0',
        expiresInDays: 30,
        now,
      },
    );

    expect(release.payload).toMatchObject({
      registry: { id: 'graphwork_reference', name: 'Graphwork Reference Registry' },
      generatedAt: now.toISOString(),
      expiresAt: '2026-09-03T12:00:00.000Z',
      packs: [
        { id: 'research', version: '0.2.0', engineRange: '^0.2.2' },
        { id: 'architecture', version: '0.2.0', engineRange: '^0.2.2' },
        { id: 'customer_success', version: '0.2.0', engineRange: '^0.2.2' },
      ],
    });
    expect(release.artifacts).toHaveLength(3);
    for (const artifact of release.artifacts) {
      expect(inspectPackArtifact(artifact.artifact).checksum).toBe(artifact.checksum);
      expect(release.payload.packs.some((pack) => pack.artifactChecksum === artifact.checksum)).toBe(true);
    }
    expect(release.payload.packs[0]?.artifact).toBe(
      'https://github.com/example/project/releases/download/packs-v0.2.0/packs/research-0.2.0.gpack',
    );

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signPackRegistry(release.payload, 'graphwork.reference.v1', privateKey);
    expect(verifySignedPackRegistry(signed, {
      trustedKeys: { 'graphwork.reference.v1': publicKey },
      now,
    }).payload.packs).toHaveLength(3);
  });

  it('rejects insecure publishing URLs and excessive catalog lifetimes', async () => {
    const config = {
      formatVersion: 1,
      registry: { id: 'test', name: 'Test' },
      packs: [{ source: '../packs/research/src/index.ts' }],
    };
    await expect(buildPackRegistryRelease(config, {
      configDirectory: resolve('registry'),
      outputDirectory: resolve('tests', '.unused-release'),
      artifactBaseUrl: 'http://example.com/releases/',
      expiresInDays: 30,
    })).rejects.toThrow(/HTTPS/);
    await expect(buildPackRegistryRelease(config, {
      configDirectory: resolve('registry'),
      outputDirectory: resolve('tests', '.unused-release'),
      artifactBaseUrl: 'https://example.com/releases/',
      expiresInDays: 366,
    })).rejects.toThrow(/between 1 and 365/);
    await expect(buildPackRegistryRelease({
      ...config,
      packs: [config.packs[0], config.packs[0]],
    }, {
      configDirectory: resolve('registry'),
      outputDirectory: resolve('tests', '.unused-release'),
      artifactBaseUrl: 'https://example.com/releases/',
      expiresInDays: 30,
    })).rejects.toThrow(/duplicate Pack "research@0.2.0"/);
  });
});
