import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateEngineCompatibility, GRAPHWORK_ENGINE_VERSION } from '@graphwork/pack-sdk';
import {
  migrateWorkbenchWorkspace,
  WorkbenchWorkspaceStore,
} from '../apps/workbench/src/workspace-store.js';

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
    expect(GRAPHWORK_ENGINE_VERSION).toBe('0.2.2');
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

  it('migrates v1 workspace data without losing user state', () => {
    const migrated = migrateWorkbenchWorkspace(legacyWorkspace(), {
      now: new Date('2026-01-02T03:04:05.000Z'),
      workspaceId: 'workspace-test',
    });

    expect(migrated.migratedFrom).toBe(1);
    expect(migrated.state).toMatchObject({
      formatVersion: 2,
      workspaceId: 'workspace-test',
      createdAt: '2026-01-02T03:04:05.000Z',
      activePackId: 'research',
      installedPackIds: ['architecture', 'research'],
      modelProvider: { providerId: 'deterministic' },
    });
  });

  it('backs up and atomically upgrades a persisted workspace once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graphwork-migration-'));
    temporaryDirectories.push(directory);
    const dataFile = join(directory, 'workbench.json');
    const original = `${JSON.stringify(legacyWorkspace(), null, 2)}\n`;
    await writeFile(dataFile, original, 'utf8');

    const first = new WorkbenchWorkspaceStore(dataFile).snapshot();
    const persisted = JSON.parse(await readFile(dataFile, 'utf8')) as Record<string, unknown>;
    const backup = await readFile(`${dataFile}.v1.backup`, 'utf8');
    const second = new WorkbenchWorkspaceStore(dataFile).snapshot();

    expect(first.formatVersion).toBe(2);
    expect(persisted.formatVersion).toBe(2);
    expect(persisted.version).toBeUndefined();
    expect(backup).toBe(original);
    expect(second.workspaceId).toBe(first.workspaceId);
  });

  it('rejects unknown future workspace formats without rewriting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graphwork-future-workspace-'));
    temporaryDirectories.push(directory);
    const dataFile = join(directory, 'workbench.json');
    const future = '{"formatVersion":99,"future":true}\n';
    await writeFile(dataFile, future, 'utf8');

    expect(() => new WorkbenchWorkspaceStore(dataFile)).toThrow(/can migrate version 1 or open formatVersion 2/);
    expect(await readFile(dataFile, 'utf8')).toBe(future);
  });
});
