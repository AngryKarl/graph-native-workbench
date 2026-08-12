import { describe, expect, it } from 'vitest';
import {
  projectResearchRun,
  researchHandlers,
  researchPack,
} from '@graph-workbench/pack-research';
import {
  compilePack,
  GraphRuntime,
  InMemoryContextGraphStore,
  queryContextObjects,
  SQLiteContextGraphStore,
  traverseContext,
  verifyPortableArtifact,
} from '@graph-workbench/core';

function runtime(): GraphRuntime {
  const graph = compilePack(researchPack).graphs.get('research.workflow');
  if (!graph) throw new Error('Missing test graph.');
  return new GraphRuntime(graph, { handlers: researchHandlers, pack: researchPack });
}

describe('graph runtime', () => {
  it('runs parallel evidence branches, joins them, and publishes approved work', async () => {
    const result = await runtime().run(
      { goal: 'Evaluate a reusable graph-native workbench.' },
      { decisions: { approval: true } },
    );

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed run.');
    expect(result.state.market_evidence).toHaveLength(2);
    expect(result.state.technology_evidence).toHaveLength(2);
    expect(result.state.deliverable).toContain('Approved research deliverable');
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        artifactType: 'evidence_synthesis',
        deliverableId: 'approved_research',
        evidence: expect.arrayContaining([
          expect.objectContaining({ sourceField: 'market_evidence' }),
          expect.objectContaining({ sourceField: 'technology_evidence' }),
        ]),
        producer: expect.objectContaining({ nodeId: 'publish' }),
      }),
    ]);
    expect(result.artifacts?.[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyPortableArtifact({
      ...result.artifacts![0],
      content: 'altered after publication',
    })).toThrow(/content digest does not match/);
  });

  it('pauses at a human gate and resumes from its checkpoint', async () => {
    const engine = runtime();
    const paused = await engine.run({ goal: 'Test resumable work.' });
    expect(paused.status).toBe('paused');
    if (paused.status !== 'paused') throw new Error('Expected a checkpoint.');
    expect(paused.checkpoint.readyNodeIds).toContain('approval');

    const resumed = await engine.resume(paused.checkpoint, { decisions: { approval: false } });
    expect(resumed.status).toBe('completed');
    expect(resumed.state.rejection_reason).toContain('rejected');
    expect(resumed.state.deliverable).toBeUndefined();
  });

  it('enforces the Human node role and records the resolving actor', async () => {
    const engine = runtime();
    const paused = await engine.run({ goal: 'Bind an accountable reviewer.' });
    expect(paused.status).toBe('paused');
    if (paused.status !== 'paused') throw new Error('Expected a checkpoint.');

    await expect(engine.resume(paused.checkpoint, {
      actor: {
        id: 'actor.researcher',
        kind: 'human',
        displayName: 'Research contributor',
        workspaceRole: 'member',
        roleIds: ['researcher'],
      },
      decisions: { approval: true },
    })).rejects.toThrow(/role "reviewer" is required/);

    const resumed = await engine.resume(paused.checkpoint, {
      actor: {
        id: 'actor.reviewer',
        kind: 'human',
        displayName: 'Accountable reviewer',
        workspaceRole: 'member',
        roleIds: ['reviewer'],
      },
      decisions: { approval: true },
    });
    expect(resumed.status).toBe('completed');
    if (resumed.status !== 'completed') throw new Error('Expected a completed run.');
    expect(resumed.events.find((event) => event.type === 'human.resolved')).toMatchObject({
      detail: {
        requiredRoleId: 'reviewer',
        resolvedByActorId: 'actor.reviewer',
        resolvedByActorName: 'Accountable reviewer',
      },
    });
    expect(resumed.artifacts?.[0]?.approval).toMatchObject({
      stateField: 'approved',
      value: true,
      requiredRoleId: 'reviewer',
      actorId: 'actor.reviewer',
      actorName: 'Accountable reviewer',
    });
  });

  it('does not count time spent paused against the active duration budget', async () => {
    const engine = runtime();
    const paused = await engine.run({ goal: 'Resume after a long human review.' });
    expect(paused.status).toBe('paused');
    if (paused.status !== 'paused') throw new Error('Expected a checkpoint.');

    const resumed = await engine.resume(
      { ...paused.checkpoint, startedAt: '2000-01-01T00:00:00.000Z' },
      { decisions: { approval: true } },
    );

    expect(resumed.status).toBe('completed');
    expect(resumed.state.deliverable).toContain('Approved research deliverable');
  });

  it('enforces declared node write permissions', async () => {
    const graph = compilePack(researchPack).graphs.get('research.workflow')!;
    const engine = new GraphRuntime(graph, {
      handlers: {
        ...researchHandlers,
        'research.normalize_brief': () => ({ unapproved_field: 'blocked' }),
      },
      pack: researchPack,
    });
    const result = await engine.run({ goal: 'Try an illegal state write.' });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.message).toContain('undeclared output');
  });

  it('projects an approved run into a typed organizational context graph', async () => {
    const result = await runtime().run(
      { goal: 'Preserve research as organizational context.' },
      { decisions: { approval: true } },
    );
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed run.');

    const store = new InMemoryContextGraphStore(researchPack);
    await projectResearchRun(store, result);
    expect(await store.listObjects()).toHaveLength(7);
    expect(await store.listRelations()).toHaveLength(9);
    expect((await store.listObjects()).find((item) => item.type === 'deliverable')?.provenance)
      .toMatchObject({ producedByRunId: result.runId, producedByNodeId: 'publish' });
  });

  it('persists the same typed context graph through the SQLite adapter', async () => {
    const result = await runtime().run(
      { goal: 'Persist organizational context.' },
      { decisions: { approval: true } },
    );
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed run.');

    const store = new SQLiteContextGraphStore(':memory:', researchPack);
    try {
      await projectResearchRun(store, result);
      expect(await store.listObjects()).toHaveLength(7);
      expect(await store.listRelations()).toHaveLength(9);
      expect((await store.getObject(`${result.runId}.deliverable`))?.data.approved).toBe(true);
    } finally {
      store.close();
    }
  });

  it('queries and traverses context through the storage-neutral API', async () => {
    const result = await runtime().run(
      { goal: 'Query reusable organizational context.' },
      { decisions: { approval: true } },
    );
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed run.');

    const store = new SQLiteContextGraphStore(':memory:', researchPack);
    try {
      await projectResearchRun(store, result);
      const deliverables = await queryContextObjects(store, {
        types: ['deliverable'],
        statuses: ['confirmed'],
        producedByRunIds: [result.runId],
      });
      expect(deliverables).toHaveLength(1);

      const neighborhood = await traverseContext(store, deliverables[0]!.id, {
        direction: 'incoming',
        maxDepth: 1,
      });
      expect(neighborhood.root).toEqual(deliverables[0]);
      expect(neighborhood.objects.length).toBeGreaterThan(1);
      expect(neighborhood.relations.length).toBeGreaterThan(0);
      expect(neighborhood.relations.every((relation) => relation.targetId === deliverables[0]!.id)).toBe(true);
    } finally {
      store.close();
    }
  });
});
