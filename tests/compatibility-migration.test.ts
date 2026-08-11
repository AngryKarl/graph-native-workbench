import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateEngineCompatibility,
  GRAPH_WORKBENCH_ENGINE_VERSION,
  packPackageDescriptorSchema,
} from '@graph-workbench/pack-sdk';
import {
  migrateWorkbenchWorkspace,
  WorkbenchWorkspaceStore,
} from '../apps/workbench/src/workspace-store.js';
import {
  applyLegacyWorkbenchEnvironment,
  migrateLegacyWorkbenchDirectory,
} from '../apps/workbench/src/environment.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function legacyWorkspace() {
  return {
    version: 1,
    installedPackIds: ['architecture', 'research'],
    activePackId: 'research',
    drafts: {},
    runs: {},
    modelProvider: { providerId: 'deterministic', model: 'deterministic' },
  };
}

describe('compatibility and workspace migration', () => {
  it('uses the Pack SDK package version as the engine compatibility authority', () => {
    expect(GRAPH_WORKBENCH_ENGINE_VERSION).toBe('0.3.0');
  });

  it('maps legacy environment variables without overriding the new namespace', () => {
    const environment = {
      GRAPHWORK_PORT: '4312',
      GRAPHWORK_DATA: 'legacy.json',
      GRAPH_WORKBENCH_DATA: 'current.json',
    };
    const warnings: string[] = [];

    expect(applyLegacyWorkbenchEnvironment(environment, (message) => warnings.push(message))).toEqual([
      'GRAPHWORK_PORT -> GRAPH_WORKBENCH_PORT',
    ]);
    expect(environment).toMatchObject({
      GRAPH_WORKBENCH_PORT: '4312',
      GRAPH_WORKBENCH_DATA: 'current.json',
    });
    expect(warnings).toHaveLength(1);
  });

  it('copies a legacy .graphwork directory once without removing the source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-directory-migration-'));
    temporaryDirectories.push(directory);
    const legacyData = join(directory, '.graphwork', 'workbench.json');
    await mkdir(join(directory, '.graphwork'), { recursive: true });
    await writeFile(legacyData, '{"legacy":true}\n', 'utf8');

    expect(await migrateLegacyWorkbenchDirectory(directory, () => undefined)).toBe(true);
    expect(await readFile(join(directory, '.graph-workbench', 'workbench.json'), 'utf8')).toBe('{"legacy":true}\n');
    expect(await readFile(legacyData, 'utf8')).toBe('{"legacy":true}\n');
    expect(await migrateLegacyWorkbenchDirectory(directory, () => undefined)).toBe(false);
  });

  it('returns actionable engine compatibility reasons from one authority', () => {
    expect(evaluateEngineCompatibility('^0.1.0', '0.1.0')).toMatchObject({
      compatible: true,
      code: 'compatible',
    });
    expect(evaluateEngineCompatibility('>=0.2.0', '0.1.0')).toMatchObject({
      compatible: false,
      code: 'requires-newer-engine',
    });
    expect(evaluateEngineCompatibility('<0.1.0', '0.1.0')).toMatchObject({
      compatible: false,
      code: 'requires-older-engine',
    });
  });

  it('normalizes legacy Graphwork Pack descriptors to the current engine key', () => {
    const descriptor = packPackageDescriptorSchema.parse({
      formatVersion: 1,
      pack: {
        id: 'legacy_pack',
        version: '0.2.0',
        manifest: 'manifest.json',
        entry: 'dist/index.mjs',
      },
      engine: { graphwork: '^0.2.0' },
      permissions: ['handlers.execute'],
      integrity: {
        algorithm: 'sha256',
        files: {
          'manifest.json': 'a'.repeat(64),
          'dist/index.mjs': 'b'.repeat(64),
        },
      },
    });

    expect(descriptor.engine).toEqual({ 'graph-workbench': '^0.2.0' });
  });

  it('migrates v1 workspace data without losing user state', () => {
    const migrated = migrateWorkbenchWorkspace(legacyWorkspace(), {
      now: new Date('2026-01-02T03:04:05.000Z'),
      workspaceId: 'workspace-test',
    });

    expect(migrated.migratedFrom).toBe(1);
    expect(migrated.state).toMatchObject({
      formatVersion: 3,
      workspaceId: 'workspace-test',
      createdAt: '2026-01-02T03:04:05.000Z',
      activePackId: 'research',
      installedPackIds: ['architecture', 'research'],
      modelProvider: { providerId: 'deterministic' },
      currentActorId: 'local.user',
    });
    expect(migrated.state.actors['local.user']).toMatchObject({ workspaceRole: 'owner' });
  });

  it('migrates a v2 workspace to persistent local-owner identity', () => {
    const migrated = migrateWorkbenchWorkspace({
      formatVersion: 2,
      workspaceId: 'workspace-v2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      installedPackIds: ['architecture'],
      activePackId: 'architecture',
      drafts: {},
      runs: {},
    });

    expect(migrated.migratedFrom).toBe(2);
    expect(migrated.state).toMatchObject({
      formatVersion: 3,
      workspaceId: 'workspace-v2',
      currentActorId: 'local.user',
      actors: { 'local.user': { workspaceRole: 'owner' } },
    });
  });

  it('backs up and atomically upgrades a persisted workspace once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-migration-'));
    temporaryDirectories.push(directory);
    const dataFile = join(directory, 'workbench.json');
    const original = `${JSON.stringify(legacyWorkspace(), null, 2)}\n`;
    await writeFile(dataFile, original, 'utf8');

    const first = new WorkbenchWorkspaceStore(dataFile).snapshot();
    const persisted = JSON.parse(await readFile(dataFile, 'utf8')) as Record<string, unknown>;
    const backup = await readFile(`${dataFile}.v1.backup`, 'utf8');
    const second = new WorkbenchWorkspaceStore(dataFile).snapshot();

    expect(first.formatVersion).toBe(3);
    expect(persisted.formatVersion).toBe(3);
    expect(persisted.version).toBeUndefined();
    expect(backup).toBe(original);
    expect(second.workspaceId).toBe(first.workspaceId);
  });

  it('rejects unknown future workspace formats without rewriting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-future-workspace-'));
    temporaryDirectories.push(directory);
    const dataFile = join(directory, 'workbench.json');
    const future = '{"formatVersion":99,"future":true}\n';
    await writeFile(dataFile, future, 'utf8');

    expect(() => new WorkbenchWorkspaceStore(dataFile)).toThrow(/can migrate version 1\/2 or open formatVersion 3/);
    expect(await readFile(dataFile, 'utf8')).toBe(future);
  });
});
