import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphRuntime, compilePack } from '@graph-native/core';
import {
  activateInstalledPack,
  buildPackArtifact,
  inspectPackArtifact,
  installPackArtifact,
  listInstalledPacks,
  loadInstalledPack,
  rollbackInstalledPack,
  scaffoldPack,
  uninstallInstalledPack,
} from '@graph-native/pack-sdk';
import {
  bundledPackCatalog,
  discoverInstalledPackRuntimes,
} from '../apps/workbench/src/catalog.js';
import { WorkbenchService } from '../apps/workbench/src/service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  bundledPackCatalog.delete('support_ops');
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true }),
  ));
});

async function fixture() {
  const directory = await mkdtemp(resolve('tests', '.tmp-lifecycle-'));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, 'source');
  await scaffoldPack('support_ops', sourceDirectory);
  return {
    directory,
    source: resolve(sourceDirectory, 'src/index.ts'),
    registry: resolve(directory, 'registry'),
  };
}

describe('Pack lifecycle', () => {
  it('builds an inspectable artifact with compatibility and integrity metadata', async () => {
    const paths = await fixture();
    const artifact = resolve(paths.directory, 'support-ops.gpack');
    const built = await buildPackArtifact({ source: paths.source, output: artifact });
    const rebuilt = await buildPackArtifact({
      source: paths.source,
      output: resolve(paths.directory, 'support-ops-rebuilt.gpack'),
    });
    const inspected = inspectPackArtifact(artifact);

    expect(built.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(rebuilt.checksum).toBe(built.checksum);
    expect(inspected.compatible).toBe(true);
    expect(inspected.manifest.id).toBe('support_ops');
    expect(inspected.descriptor.permissions).toEqual(['handlers.execute', 'context.write']);
    expect(inspected.descriptor.integrity.files).toHaveProperty('dist/index.mjs');
  });

  it('requires explicit trust, then loads and runs an installed Pack', async () => {
    const paths = await fixture();
    const artifact = resolve(paths.directory, 'support-ops.gpack');
    await buildPackArtifact({ source: paths.source, output: artifact });

    expect(() => installPackArtifact(artifact, { root: paths.registry })).toThrow(/--trust/);
    installPackArtifact(artifact, { root: paths.registry, trust: true });
    const loaded = await loadInstalledPack('support_ops', paths.registry);
    const graph = compilePack(loaded.pack).graphs.get('support_ops.workflow');
    if (!graph) throw new Error('Installed Pack graph is missing.');
    const result = await new GraphRuntime(graph, {
      handlers: loaded.handlers,
      pack: loaded.pack,
    }).run({ topic: 'priority customer' });

    expect(result.status).toBe('completed');
    expect(result.state.result).toBe('Pack support_ops processed: priority customer');

    const registry = listInstalledPacks(paths.registry);
    const entry = resolve(
      registry.packs.support_ops!.versions['0.1.0']!.directory,
      'dist/index.mjs',
    );
    await writeFile(entry, `${await readFile(entry, 'utf8')}\n// modified after installation\n`, 'utf8');
    await expect(loadInstalledPack('support_ops', paths.registry)).rejects.toThrow(/integrity check failed/);
  });

  it('installs side-by-side versions and supports activate and rollback', async () => {
    const paths = await fixture();
    const firstArtifact = resolve(paths.directory, 'support-ops-0.1.0.gpack');
    await buildPackArtifact({ source: paths.source, output: firstArtifact });
    installPackArtifact(firstArtifact, { root: paths.registry, trust: true });

    const firstSource = await readFile(paths.source, 'utf8');
    await writeFile(
      paths.source,
      firstSource
        .replace("version: '0.1.0'", "version: '0.2.0'")
        .replace('Pack support_ops processed:', 'Pack support_ops v2 processed:'),
      'utf8',
    );
    const secondArtifact = resolve(paths.directory, 'support-ops-0.2.0.gpack');
    await buildPackArtifact({ source: paths.source, output: secondArtifact });
    installPackArtifact(secondArtifact, { root: paths.registry, trust: true });

    expect(listInstalledPacks(paths.registry).packs.support_ops?.activeVersion).toBe('0.2.0');
    activateInstalledPack('support_ops', '0.1.0', paths.registry);
    expect(listInstalledPacks(paths.registry).packs.support_ops?.activeVersion).toBe('0.1.0');
    const rolledBack = rollbackInstalledPack('support_ops', paths.registry);
    expect(rolledBack.version).toBe('0.2.0');
    uninstallInstalledPack('support_ops', '0.1.0', paths.registry);
    expect(Object.keys(listInstalledPacks(paths.registry).packs.support_ops!.versions)).toEqual(['0.2.0']);
    uninstallInstalledPack('support_ops', undefined, paths.registry);
    expect(listInstalledPacks(paths.registry).packs.support_ops).toBeUndefined();
  });

  it('rejects artifacts that target an incompatible engine', async () => {
    const paths = await fixture();
    const artifact = resolve(paths.directory, 'future.gpack');
    await buildPackArtifact({
      source: paths.source,
      output: artifact,
      engineRange: '>=9.0.0',
    });
    expect(() => installPackArtifact(artifact, {
      root: paths.registry,
      trust: true,
    })).toThrow(/current engine is 0.2.0/);
  });

  it('discovers a trusted installed Pack in the graphical Workbench', async () => {
    const paths = await fixture();
    const artifact = resolve(paths.directory, 'support-ops.gpack');
    await buildPackArtifact({ source: paths.source, output: artifact });
    installPackArtifact(artifact, { root: paths.registry, trust: true });

    const discovery = await discoverInstalledPackRuntimes(paths.registry);
    expect(discovery).toEqual({ loaded: 1, errors: [] });
    const service = new WorkbenchService({ dataFile: resolve(paths.directory, 'workbench.json') });
    expect(service.describeWorkbench().catalog.some((pack) => pack.id === 'support_ops')).toBe(true);
    service.install('support_ops');
    service.activate('support_ops');
    const result = await service.start({ topic: 'Workbench discovery' });
    expect(result.status).toBe('completed');
    expect(result.state.result).toContain('Workbench discovery');
    expect(result.context?.objects).toHaveLength(1);
    expect(result.context?.objects[0]?.type).toBe('artifact');
  });
});
