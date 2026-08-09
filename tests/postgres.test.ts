import { PGlite } from '@electric-sql/pglite';
import { PgBoss, fromPglite } from 'pg-boss';
import { afterEach, describe, expect, it } from 'vitest';
import { researchHandlers, researchPack, projectResearchRun } from '@graphwork/pack-research';
import {
  compilePack,
  GraphRuntime,
  PostgresContextGraphStore,
  PostgresRunQueue,
  PostgresRunStore,
  type PostgresQueryable,
} from '@graphwork/core';

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

function database(): { pglite: PGlite; queryable: PostgresQueryable } {
  const pglite = new PGlite();
  databases.push(pglite);
  return { pglite, queryable: pglite as unknown as PostgresQueryable };
}

function runtime(): GraphRuntime {
  const graph = compilePack(researchPack).graphs.get('research.workflow');
  if (!graph) throw new Error('Research graph is missing.');
  return new GraphRuntime(graph, { handlers: researchHandlers, pack: researchPack });
}

describe('PostgreSQL team execution adapters', () => {
  it('persists and resumes an ordered run through the existing RunStore contract', async () => {
    const { queryable } = database();
    const store = new PostgresRunStore(queryable);
    const runId = 'run-postgres-test';

    const paused = await runtime().run(
      { goal: 'Resume a durable PostgreSQL run.' },
      { runId, store },
    );
    expect(paused.status).toBe('paused');
    expect(await store.getRun(runId)).toMatchObject({ status: 'paused' });

    const completed = await runtime().resumeStored(runId, store, {
      decisions: { approval: true },
    });
    expect(completed.status).toBe('completed');
    expect(await store.getCheckpoint(runId)).toBeUndefined();
    expect((await store.listEvents(runId)).at(-1)?.type).toBe('run.completed');
  }, 15_000);

  it('persists the typed context graph without changing Pack projection code', async () => {
    const { queryable } = database();
    const result = await runtime().run(
      { goal: 'Share typed organizational context.' },
      { decisions: { approval: true } },
    );
    if (result.status !== 'completed') throw new Error('Expected a completed run.');

    const store = new PostgresContextGraphStore(queryable, researchPack);
    await projectResearchRun(store, result);
    expect(await store.listObjects()).toHaveLength(7);
    expect(await store.listRelations()).toHaveLength(9);
    expect((await store.getObject(`${result.runId}.deliverable`))?.data.approved).toBe(true);
  });

  it('delegates distributed leases, heartbeats and retry recovery to pg-boss', async () => {
    const { pglite } = database();
    const boss = new PgBoss({
      db: fromPglite(pglite),
      backend: 'pglite',
      supervise: false,
      schedule: false,
    });
    const queue = new PostgresRunQueue(boss, {
      queueName: 'graphwork-test-runs',
      queue: { heartbeatSeconds: 10, expireInSeconds: 30, retryLimit: 1, retryDelay: 0 },
    });
    let attempts = 0;
    let resolveHandled!: (value: string) => void;
    const handled = new Promise<string>((resolve) => { resolveHandled = resolve; });

    try {
      await queue.work(async (request, context) => {
        attempts += 1;
        expect(context.signal.aborted).toBe(false);
        if (attempts === 1) throw new Error('simulated worker interruption');
        resolveHandled(request.runId);
        return { status: 'accepted' };
      }, { pollingIntervalSeconds: 0.5 });
      const jobId = await queue.enqueue({
        formatVersion: 1,
        runId: 'run-distributed-test',
        packId: 'research',
        graphId: 'research.workflow',
        graphVersion: 1,
        input: { goal: 'Execute on any healthy worker.' },
        submittedAt: new Date().toISOString(),
      });

      expect(jobId).toBeTruthy();
      await expect(Promise.race([
        handled,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Worker timed out.')), 10_000)),
      ])).resolves.toBe('run-distributed-test');
      expect(attempts).toBe(2);
    } finally {
      await queue.close();
      await boss.stop({ graceful: true, timeout: 10_000 });
    }
  }, 20_000);
});
