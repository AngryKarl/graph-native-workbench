import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { researchHandlers, researchPack } from '@graph-workbench/pack-research';
import { compilePack, GraphRuntime, SQLiteRunStore } from '@graph-workbench/core';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const paths = temporaryDirectories.splice(0);
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

function runtime(): GraphRuntime {
  const graph = compilePack(researchPack).graphs.get('research.workflow');
  if (!graph) throw new Error('Research graph is missing.');
  return new GraphRuntime(graph, { handlers: researchHandlers, pack: researchPack });
}

describe('durable run store', () => {
  it('restores events, state and a human checkpoint after reopening SQLite', async () => {
    const directory = await mkdtemp(resolve('tests', '.tmp-runs-'));
    temporaryDirectories.push(directory);
    const databasePath = resolve(directory, 'runs.sqlite');
    const runId = 'run-durable-test';

    const firstStore = new SQLiteRunStore(databasePath);
    const paused = await runtime().run(
      { goal: 'Resume after a process restart.' },
      { runId, store: firstStore },
    );
    expect(paused.status).toBe('paused');
    expect(await firstStore.getRun(runId)).toMatchObject({ status: 'paused' });
    expect((await firstStore.listEvents(runId)).at(-1)?.type).toBe('run.paused');
    firstStore.close();

    const reopenedStore = new SQLiteRunStore(databasePath);
    try {
      const completed = await runtime().resumeStored(runId, reopenedStore, {
        decisions: { approval: true },
      });
      expect(completed.status).toBe('completed');
      expect(await reopenedStore.getRun(runId)).toMatchObject({
        status: 'completed',
        state: { approved: true },
      });
      expect(await reopenedStore.getCheckpoint(runId)).toBeUndefined();

      const events = await reopenedStore.listEvents(runId);
      expect(events.some((event) => event.type === 'run.resumed')).toBe(true);
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(events.map((event) => event.seq)).toEqual(
        [...events.map((event) => event.seq)].sort((left, right) => left - right),
      );
    } finally {
      reopenedStore.close();
    }
  });

  it('persists a failed run and its diagnostic event', async () => {
    const graph = compilePack(researchPack).graphs.get('research.workflow');
    if (!graph) throw new Error('Research graph is missing.');
    const store = new SQLiteRunStore(':memory:');
    try {
      const result = await new GraphRuntime(graph, {
        handlers: {
          ...researchHandlers,
          'research.normalize_brief': () => {
            throw new Error('deterministic failure');
          },
        },
        pack: researchPack,
      }).run({ goal: 'Persist failure.' }, { runId: 'run-failure-test', store });

      expect(result.status).toBe('failed');
      expect(await store.getRun('run-failure-test')).toMatchObject({
        status: 'failed',
        error: 'deterministic failure',
      });
      expect((await store.listEvents('run-failure-test')).at(-1)?.type).toBe('run.failed');
      expect(await store.getCheckpoint('run-failure-test')).toMatchObject({
        readyNodeIds: ['normalize_brief'],
      });

      const recovered = await runtime().resumeStored('run-failure-test', store, {
        decisions: { approval: true },
      });
      expect(recovered.status).toBe('completed');
      expect(await store.getRun('run-failure-test')).toMatchObject({ status: 'completed', error: null });
    } finally {
      store.close();
    }
  });
});
