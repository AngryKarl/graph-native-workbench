import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  InMemoryRunSessionStore,
  SQLiteRunSessionStore,
} from '../apps/workbench/src/run-session-store.js';
import { WorkbenchService } from '../apps/workbench/src/service.js';
import {
  migrateWorkbenchWorkspace,
  WorkbenchWorkspaceStore,
  type StoredRunSession,
} from '../apps/workbench/src/workspace-store.js';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function workspace(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function session(runId: string, startedAt: string): StoredRunSession {
  return {
    runId,
    packId: 'research',
    graph: {
      id: 'research.workflow',
      version: 1,
      name: 'Research',
      description: 'Test graph.',
      state: { fields: {} },
      nodes: [],
      edges: [],
      budget: { maxSteps: 4, maxDurationMs: 1000, maxConcurrency: 1 },
    },
    status: 'completed',
    state: { goal: runId },
    events: [{ runId, seq: 1, timestamp: startedAt, type: 'run.started', detail: {} }],
  };
}

describe('Workbench run session store', () => {
  it('returns sessions newest first, which is the order the Runs view depends on', async () => {
    const directory = await workspace('graph-workbench-sessions-');
    const store = new SQLiteRunSessionStore(join(directory, 'runs.sqlite'));
    try {
      store.save(session('run-old', '2026-01-01T00:00:00.000Z'));
      store.save(session('run-new', '2026-03-01T00:00:00.000Z'));
      store.save(session('run-middle', '2026-02-01T00:00:00.000Z'));

      expect(store.list().map((item) => item.runId)).toEqual(['run-new', 'run-middle', 'run-old']);
    } finally {
      store.close();
    }
  });

  it('replaces a session in place when a paused run is resumed', async () => {
    const directory = await workspace('graph-workbench-sessions-update-');
    const store = new SQLiteRunSessionStore(join(directory, 'runs.sqlite'));
    try {
      store.save(session('run-1', '2026-01-01T00:00:00.000Z'));
      store.save({ ...session('run-1', '2026-01-01T00:00:00.000Z'), status: 'failed', error: 'boom' });

      expect(store.list()).toHaveLength(1);
      expect(store.get('run-1')).toMatchObject({ status: 'failed', error: 'boom' });
    } finally {
      store.close();
    }
  });

  it('survives a process restart', async () => {
    const directory = await workspace('graph-workbench-sessions-restart-');
    const file = join(directory, 'runs.sqlite');
    const first = new SQLiteRunSessionStore(file);
    first.save(session('run-durable', '2026-01-01T00:00:00.000Z'));
    first.close();

    const second = new SQLiteRunSessionStore(file);
    try {
      expect(second.get('run-durable')).toMatchObject({ runId: 'run-durable', packId: 'research' });
    } finally {
      second.close();
    }
  });

  it('hands back copies so a caller cannot mutate stored state in memory', () => {
    const store = new InMemoryRunSessionStore();
    store.save(session('run-1', '2026-01-01T00:00:00.000Z'));
    const taken = store.get('run-1')!;
    (taken.state as Record<string, unknown>).goal = 'mutated';

    expect(store.get('run-1')?.state.goal).toBe('run-1');
  });
});

describe('Workbench workspace v4 migration', () => {
  it('moves sessions out of the workspace document', () => {
    const migrated = migrateWorkbenchWorkspace({
      formatVersion: 3,
      workspaceId: 'workspace-v3',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      installedPackIds: ['research'],
      activePackId: 'research',
      drafts: {},
      runs: { 'run-1': session('run-1', '2026-01-01T00:00:00.000Z') },
      actors: {
        'local.user': {
          id: 'local.user',
          kind: 'human',
          displayName: 'Local user',
          workspaceRole: 'owner',
          roleIds: [],
        },
      },
      currentActorId: 'local.user',
    });

    expect(migrated.migratedFrom).toBe(3);
    expect(migrated.state.formatVersion).toBe(4);
    expect('runs' in migrated.state).toBe(false);
    expect(Object.keys(migrated.legacyRuns ?? {})).toEqual(['run-1']);
  });

  it('yields the legacy sessions only once, so a second reader cannot re-import them', async () => {
    const directory = await workspace('graph-workbench-legacy-runs-');
    const dataFile = join(directory, 'workbench.json');
    await writeFile(dataFile, JSON.stringify({
      formatVersion: 3,
      workspaceId: 'workspace-v3',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      installedPackIds: ['research'],
      activePackId: 'research',
      drafts: {},
      runs: { 'run-1': session('run-1', '2026-01-01T00:00:00.000Z') },
      actors: {
        'local.user': {
          id: 'local.user',
          kind: 'human',
          displayName: 'Local user',
          workspaceRole: 'owner',
          roleIds: [],
        },
      },
      currentActorId: 'local.user',
    }), 'utf8');

    const store = new WorkbenchWorkspaceStore(dataFile);
    expect(Object.keys(store.takeLegacyRuns())).toEqual(['run-1']);
    expect(Object.keys(store.takeLegacyRuns())).toEqual([]);
    // The pre-migration document is retained so a failed move is recoverable.
    expect(JSON.parse(await readFile(`${dataFile}.v3.backup`, 'utf8'))).toMatchObject({ formatVersion: 3 });
    // The upgraded document no longer carries run history at all.
    expect(JSON.parse(await readFile(dataFile, 'utf8'))).not.toHaveProperty('runs');
  });

  it('carries a v3 workspace\'s runs into the run store on first open', async () => {
    const directory = await workspace('graph-workbench-legacy-service-');
    const dataFile = join(directory, 'workbench.json');
    await writeFile(dataFile, JSON.stringify({
      formatVersion: 3,
      workspaceId: 'workspace-v3',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      installedPackIds: ['research'],
      activePackId: 'research',
      drafts: {},
      runs: { 'run-legacy': session('run-legacy', '2026-01-01T00:00:00.000Z') },
      actors: {
        'local.user': {
          id: 'local.user',
          kind: 'human',
          displayName: 'Local user',
          workspaceRole: 'owner',
          roleIds: [],
        },
      },
      currentActorId: 'local.user',
    }), 'utf8');

    const service = new WorkbenchService({ dataFile });
    try {
      const runs = (await service.describeWorkbench()).runs;
      expect(runs.map((run) => run.runId)).toContain('run-legacy');
    } finally {
      await service.close();
    }
  });
});

describe('Workbench workspace write cost', () => {
  it('does not rewrite the workspace document as runs accumulate', async () => {
    // The defect this store exists to fix: every recorded run used to
    // re-serialize the entire history, so the document grew without bound and
    // each write cost more than the last.
    const directory = await workspace('graph-workbench-write-cost-');
    const dataFile = join(directory, 'workbench.json');
    const service = new WorkbenchService({ dataFile });
    try {
      await service.install('research');
      const input = service.describePack('research').input;

      const first = await service.start(input);
      await service.decide(first.runId, true);
      const afterFirst = (await stat(dataFile)).size;

      for (let index = 0; index < 3; index += 1) {
        const run = await service.start(input);
        await service.decide(run.runId, true);
      }
      const afterFour = (await stat(dataFile)).size;

      expect((await service.describeWorkbench()).runs.length).toBeGreaterThanOrEqual(4);
      expect(afterFour).toBe(afterFirst);
    } finally {
      await service.close();
    }
  });
});
