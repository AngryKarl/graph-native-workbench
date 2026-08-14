import { describe, expect, it } from 'vitest';
import type { ContextObject, ContextRelation, GraphDefinition } from '@graph-workbench/contracts';
import {
  compileGraph,
  GraphRuntime,
  InMemoryContextGraphStore,
  type HandlerRegistry,
} from '@graph-workbench/core';

function graph(id: string, outputField: string, handler: string): GraphDefinition {
  return {
    id,
    version: 1,
    name: id,
    description: `Exercises ${id}.`,
    state: {
      fields: {
        [outputField]: { type: 'string', required: false, description: `${outputField} output.` },
      },
    },
    nodes: [{
      id: 'start',
      kind: 'trigger',
      label: 'Start',
      description: `Start ${id}.`,
      reads: [],
      writes: [],
      config: {},
    }, {
      id: 'run',
      kind: 'function',
      label: 'Run',
      description: `Execute ${id}.`,
      handler,
      reads: [],
      writes: [outputField],
      config: {},
    }],
    edges: [{ id: 'start_to_run', source: 'start', target: 'run', on: 'success' }],
    budget: { maxSteps: 4, maxDurationMs: 10_000, maxConcurrency: 1 },
  };
}

describe('runtime context queries', () => {
  it('lets Run B reuse objects and relations projected by Run A', async () => {
    const store = new InMemoryContextGraphStore();
    const runA = await new GraphRuntime(compileGraph(graph(
      'context_closure.produce',
      'recommendation',
      'produce',
    )), {
      handlers: { produce: () => ({ recommendation: 'Ship the governed release.' }) },
    }).run({});
    expect(runA.status).toBe('completed');
    if (runA.status !== 'completed') throw new Error('Run A should complete.');

    const recordedAt = '2026-08-13T00:00:00.000Z';
    const source = {
      id: 'release.source',
      type: 'release_evidence',
      version: 1,
      status: 'confirmed',
      data: { name: 'Verified release evidence' },
      validFrom: recordedAt,
      validTo: null,
      provenance: {
        sourceIds: [],
        producedByRunId: runA.runId,
        producedByNodeId: 'run',
        actorId: 'system.runtime',
        recordedAt,
      },
    } satisfies ContextObject;
    const decision = {
      id: 'release.decision',
      type: 'release_decision',
      version: 1,
      status: 'confirmed',
      data: { recommendation: runA.state.recommendation },
      validFrom: recordedAt,
      validTo: null,
      provenance: {
        sourceIds: [source.id],
        producedByRunId: runA.runId,
        producedByNodeId: 'run',
        actorId: 'system.runtime',
        recordedAt,
      },
    } satisfies ContextObject;
    const support = {
      id: 'release.source_supports_decision',
      type: 'evidence_supports',
      sourceId: source.id,
      targetId: decision.id,
      version: 1,
      attributes: {},
      validFrom: recordedAt,
      validTo: null,
      provenance: {
        sourceIds: [source.id, decision.id],
        producedByRunId: runA.runId,
        producedByNodeId: 'run',
        actorId: 'system.runtime',
        recordedAt,
      },
    } satisfies ContextRelation;
    await store.appendObject(source);
    await store.appendObject(decision);

    const handlers = {
      reuse: async ({ context }) => {
        if (!context) return { outcome: 'No organizational context available.' };
        const decisions = await context.queryObjects({
          types: ['release_decision'],
          statuses: ['confirmed'],
          currentOnly: true,
        });
        const current = decisions[0];
        if (!current) return { outcome: 'No confirmed decision.' };
        const neighborhood = await context.traverse(current.id, {
          direction: 'incoming',
          relationTypes: ['evidence_supports'],
          maxDepth: 1,
        });
        const supported = neighborhood.relations.some((relation) => relation.type === 'evidence_supports');
        return {
          outcome: supported
            ? `Reused: ${String(current.data.recommendation)}`
            : 'Decision lacks confirmed supporting context.',
        };
      },
    } satisfies HandlerRegistry;
    const consumer = new GraphRuntime(compileGraph(graph(
      'context_closure.consume',
      'outcome',
      'reuse',
    )), { handlers, contextStore: store });
    const unsupportedRun = await consumer.run({});
    expect(unsupportedRun.status).toBe('completed');
    if (unsupportedRun.status !== 'completed') throw new Error('Unsupported Run B should complete.');
    expect(unsupportedRun.state.outcome).toBe('Decision lacks confirmed supporting context.');

    await store.appendRelation(support);
    const runB = await consumer.run({});

    expect(runB.status).toBe('completed');
    if (runB.status !== 'completed') throw new Error('Run B should complete.');
    expect(runB.state.outcome).toBe('Reused: Ship the governed release.');
  });
});
