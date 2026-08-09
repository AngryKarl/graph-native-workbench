import { describe, expect, it, vi } from 'vitest';
import type { GraphDefinition } from '@graphwork/contracts';
import { compileGraph, GraphRuntime, SQLiteRunStore } from '@graphwork/core';

function graph(execution?: GraphDefinition['nodes'][number]['execution']): GraphDefinition {
  return {
    id: 'reliability.workflow',
    version: 1,
    name: 'Reliability workflow',
    description: 'Exercise bounded retry, timeout, and cancellation behavior.',
    state: {
      fields: {
        input: { type: 'string', required: true, description: 'Test input.' },
        output: { type: 'string', required: false, description: 'Test output.' },
      },
    },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        description: 'Accept input.',
        reads: ['input'],
        writes: [],
        config: {},
      },
      {
        id: 'work',
        kind: 'function',
        label: 'Work',
        description: 'Perform bounded work.',
        handler: 'test.work',
        reads: ['input'],
        writes: ['output'],
        config: {},
        ...(execution ? { execution } : {}),
      },
    ],
    edges: [{ id: 'e_start_work', source: 'start', target: 'work', on: 'success' }],
    budget: { maxSteps: 8, maxDurationMs: 30_000, maxConcurrency: 2 },
  };
}

describe('runtime reliability policies', () => {
  it('retries a failed node within its declared attempt budget', async () => {
    const work = vi.fn(() => {
      if (work.mock.calls.length < 3) throw new Error('temporary failure');
      return { output: 'recovered' };
    });
    const result = await new GraphRuntime(
      compileGraph(graph({ retry: { maxAttempts: 3, backoffMs: 0 } })),
      { handlers: { 'test.work': work } },
    ).run({ input: 'retry me' });

    expect(result.status).toBe('completed');
    expect(result.state.output).toBe('recovered');
    expect(work).toHaveBeenCalledTimes(3);
    expect(result.events.filter((event) => event.type === 'node.retrying')).toHaveLength(2);
    expect(result.events.findLast((event) => event.type === 'node.started' && event.nodeId === 'work'))
      .toMatchObject({ detail: { attempt: 3, maxAttempts: 3 } });
  });

  it('bounds a node that ignores cancellation with a timeout', async () => {
    const result = await new GraphRuntime(
      compileGraph(graph({ timeoutMs: 10 })),
      { handlers: { 'test.work': () => new Promise(() => undefined) } },
    ).run({ input: 'time out' });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('Expected a failed result.');
    expect(result.error.message).toContain('timed out after 10ms');
    expect(result.events.some((event) => event.type === 'node.timed_out')).toBe(true);
  });

  it('cancels safely even when a handler ignores abort, persists a resumable checkpoint, and does not report failure', async () => {
    const controller = new AbortController();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const store = new SQLiteRunStore(':memory:');
    try {
      const running = new GraphRuntime(compileGraph(graph()), {
        handlers: {
          'test.work': () => new Promise(() => {
            notifyStarted?.();
          }),
        },
      }).run(
        { input: 'cancel me' },
        { runId: 'run-cancel-test', signal: controller.signal, store },
      );

      await started;
      controller.abort();
      const result = await running;

      expect(result.status).toBe('cancelled');
      expect(result.events.at(-1)?.type).toBe('run.cancelled');
      expect(result.events.some((event) => event.type === 'run.failed')).toBe(false);
      expect(await store.getRun('run-cancel-test')).toMatchObject({ status: 'cancelled' });
      expect(await store.getCheckpoint('run-cancel-test')).toMatchObject({ readyNodeIds: ['work'] });
    } finally {
      store.close();
    }
  });
});
