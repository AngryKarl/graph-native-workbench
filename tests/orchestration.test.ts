import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GraphDefinition, IndustryPackManifest } from '@graph-workbench/contracts';
import { architectureHandlers, architecturePack } from '@graph-workbench/pack-architecture';
import { customerSuccessHandlers, customerSuccessPack } from '@graph-workbench/pack-customer-success';
import {
  compileGraph,
  compilePack,
  createRunAuditBundle,
  GraphRuntime,
  GraphTriggerDispatcher,
  SQLiteRunStore,
  verifyRunAuditBundle,
} from '@graph-workbench/core';

const budget = { maxSteps: 50, maxDurationMs: 10_000, maxConcurrency: 4 };

function pack(graphs: GraphDefinition[]): IndustryPackManifest {
  return {
    id: 'orchestration_test',
    version: '0.5.0',
    name: 'Orchestration test Pack',
    description: 'Exercises durable orchestration contracts.',
    license: 'MIT',
    ontology: { objectTypes: [], relationTypes: [] },
    roles: [],
    tools: [],
    graphs,
    evaluations: [],
    deliverables: [],
    fixtures: [],
  };
}

function waitGraph(mode: 'timer' | 'event'): GraphDefinition {
  return {
    id: `wait.${mode}`,
    version: 1,
    name: `${mode} wait`,
    description: 'Durably waits before completion.',
    state: { fields: {
      case_id: { type: 'string', required: true, description: 'Correlation key.' },
      payload: { type: 'object', required: false, description: 'Received payload.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
      mode === 'timer'
        ? { id: 'wait', kind: 'wait', label: 'Wait', description: 'Waits for time.', reads: [], writes: [], config: { mode: 'timer', durationMs: 1_000 } }
        : { id: 'wait', kind: 'wait', label: 'Wait', description: 'Waits for event.', reads: ['case_id'], writes: ['payload'], config: { mode: 'event', eventType: 'case.updated', correlationField: 'case_id', payloadField: 'payload' } },
    ],
    edges: [{ id: 'start.wait', source: 'start', target: 'wait', on: 'success' }],
    budget,
  };
}

describe('durable orchestration', () => {
  it('persists a timer suspension and resumes it only after its due time', async () => {
    let now = new Date('2026-08-11T00:00:00.000Z');
    const runtime = new GraphRuntime(compileGraph(waitGraph('timer')), { clock: () => now });
    const paused = await runtime.run({ case_id: 'case-1' });
    expect(paused.status).toBe('paused');
    if (paused.status !== 'paused') return;
    expect(paused.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'wait.scheduled', detail: { durationMs: 1_000, resumeAt: '2026-08-11T00:00:01.000Z' } }),
    ]));

    const stillPaused = await runtime.resume(paused.checkpoint);
    expect(stillPaused.status).toBe('paused');
    now = new Date('2026-08-11T00:00:01.000Z');
    const completed = await runtime.resume(paused.checkpoint);
    expect(completed.status).toBe('completed');
    expect(completed.events.some((event) => event.type === 'wait.resumed')).toBe(true);
  });

  it('correlates a typed external event through a stored SQLite checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-wait-'));
    const store = new SQLiteRunStore(join(directory, 'runs.sqlite'));
    const graph = compileGraph(waitGraph('event'));
    try {
      const paused = await new GraphRuntime(graph).run({ case_id: 'case-42' }, { store });
      expect(paused.status).toBe('paused');
      const completed = await new GraphRuntime(graph).resumeStored(paused.runId, store, {
        externalEvents: [{
          id: 'event-42',
          type: 'case.updated',
          correlationKey: 'case-42',
          payload: { status: 'resolved' },
          occurredAt: '2026-08-11T00:01:00.000Z',
        }],
      });
      expect(completed).toMatchObject({ status: 'completed', state: { payload: { status: 'resolved' } } });
      expect(completed.events.some((event) => event.type === 'event.received')).toBe(true);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('executes reusable subgraphs, bounded loops and dynamic maps with explicit state boundaries', async () => {
    const child: GraphDefinition = {
      id: 'child.transform', version: 1, name: 'Child transform', description: 'Transforms one value.',
      state: { fields: {
        value: { type: 'number', required: true, description: 'Input value.' },
        result: { type: 'number', required: false, description: 'Output value.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'transform', kind: 'function', label: 'Transform', description: 'Doubles.', handler: 'double', reads: ['value'], writes: ['result'], config: {} },
      ],
      edges: [{ id: 'start.transform', source: 'start', target: 'transform', on: 'success' }], budget,
    };
    const subgraph: GraphDefinition = {
      id: 'parent.subgraph', version: 1, name: 'Parent subgraph', description: 'Calls a child.',
      state: { fields: {
        input: { type: 'number', required: true, description: 'Input.' },
        output: { type: 'number', required: false, description: 'Output.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'call', kind: 'subgraph', label: 'Call child', description: 'Calls child.', reads: ['input'], writes: ['output'], config: { graphId: 'child.transform', inputMapping: { value: 'input' }, outputMapping: { output: 'result' } } },
      ],
      edges: [{ id: 'start.call', source: 'start', target: 'call', on: 'success' }], budget,
    };
    const mapper: GraphDefinition = {
      id: 'parent.map', version: 1, name: 'Parent map', description: 'Maps child calls.',
      state: { fields: {
        items: { type: 'array', required: true, description: 'Items.' },
        results: { type: 'array', required: false, description: 'Results.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'map', kind: 'map', label: 'Map child', description: 'Maps child.', reads: ['items'], writes: ['results'], config: { graphId: 'child.transform', itemsField: 'items', itemField: 'value', resultField: 'result', outputField: 'results', inputMapping: {}, maxItems: 10, maxConcurrency: 2 } },
      ],
      edges: [{ id: 'start.map', source: 'start', target: 'map', on: 'success' }], budget,
    };
    const loopChild: GraphDefinition = {
      id: 'child.increment', version: 1, name: 'Increment', description: 'Advances loop state.',
      state: { fields: {
        count: { type: 'number', required: true, description: 'Count.' },
        continue_loop: { type: 'boolean', required: true, description: 'Continue.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'increment', kind: 'function', label: 'Increment', description: 'Increments.', handler: 'increment', reads: ['count'], writes: ['count', 'continue_loop'], config: {} },
      ],
      edges: [{ id: 'start.increment', source: 'start', target: 'increment', on: 'success' }], budget,
    };
    const looper: GraphDefinition = {
      id: 'parent.loop', version: 1, name: 'Parent loop', description: 'Loops child calls.',
      state: { fields: {
        count: { type: 'number', required: true, description: 'Count.' },
        continue_loop: { type: 'boolean', required: true, description: 'Continue.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'loop', kind: 'loop', label: 'Loop child', description: 'Loops child.', reads: ['count', 'continue_loop'], writes: ['count', 'continue_loop'], config: { graphId: 'child.increment', inputMapping: { count: 'count', continue_loop: 'continue_loop' }, outputMapping: { count: 'count', continue_loop: 'continue_loop' }, conditionField: 'continue_loop', conditionValue: true, maxIterations: 3 } },
      ],
      edges: [{ id: 'start.loop', source: 'start', target: 'loop', on: 'success' }], budget,
    };
    const compiled = compilePack(pack([subgraph, mapper, looper, child, loopChild]));
    const bindings = {
      pack: compiled.manifest,
      handlers: {
        double: ({ state }: { state: Readonly<Record<string, unknown>> }) => ({ result: Number(state.value) * 2 }),
        increment: ({ state }: { state: Readonly<Record<string, unknown>> }) => {
          const count = Number(state.count) + 1;
          return { count, continue_loop: count < 3 };
        },
      },
    };

    const subgraphResult = await new GraphRuntime(compiled.graphs.get('parent.subgraph')!, bindings).run({ input: 4 });
    expect(subgraphResult).toMatchObject({ status: 'completed', state: { output: 8 } });
    expect(subgraphResult.events.some((event) => event.type === 'subgraph.completed')).toBe(true);
    const mapResult = await new GraphRuntime(compiled.graphs.get('parent.map')!, bindings).run({ items: [1, 2, 3] });
    expect(mapResult).toMatchObject({ status: 'completed', state: { results: [2, 4, 6] } });
    const loopResult = await new GraphRuntime(compiled.graphs.get('parent.loop')!, bindings).run({ count: 0, continue_loop: true });
    expect(loopResult).toMatchObject({ status: 'completed', state: { count: 3, continue_loop: false } });
    expect(loopResult.events.filter((event) => event.type === 'loop.iteration')).toHaveLength(3);
  });

  it('dispatches schema-validated webhook, schedule and typed-event triggers', async () => {
    const triggerGraph = (id: string, trigger: GraphDefinition['trigger'], fields: GraphDefinition['state']['fields']): GraphDefinition => ({
      id, version: 1, name: id, description: `Triggered graph ${id}.`, state: { fields },
      nodes: [{ id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} }],
      edges: [], budget, ...(trigger ? { trigger } : {}),
    });
    const compiled = compilePack(pack([
      triggerGraph('trigger.webhook', { type: 'webhook', method: 'POST', path: '/cases', inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'], additionalProperties: false } }, { case_id: { type: 'string', required: true, description: 'Case.' } }),
      triggerGraph('trigger.schedule', { type: 'schedule', cron: '0 * * * *', timezone: 'UTC', input: { period: 'hourly' } }, { period: { type: 'string', required: true, description: 'Period.' } }),
      triggerGraph('trigger.event', { type: 'event', eventType: 'case.created', correlationField: 'case_id' }, { case_id: { type: 'string', required: true, description: 'Case.' } }),
    ]));
    const dispatcher = new GraphTriggerDispatcher(compiled);
    expect((await dispatcher.dispatchWebhook({ method: 'POST', path: '/cases', body: { case_id: 'case-1' } })).result.status).toBe('completed');
    await expect(dispatcher.dispatchWebhook({ method: 'POST', path: '/cases', body: {} })).rejects.toThrow();
    expect((await dispatcher.dispatchSchedule('trigger.schedule', { id: 'hourly-20260811-00', scheduledFor: '2026-08-11T00:00:00.000Z' })).result).toMatchObject({ status: 'completed', state: { period: 'hourly' } });
    const eventRuns = await dispatcher.dispatchEvent({ id: 'case-created-1', type: 'case.created', correlationKey: 'case-9', payload: {}, occurredAt: '2026-08-11T00:00:00.000Z' });
    expect(eventRuns).toHaveLength(1);
    expect(eventRuns[0]?.result).toMatchObject({ status: 'completed', state: { case_id: 'case-9' } });
    expect(eventRuns[0]?.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'trigger.accepted', detail: expect.objectContaining({ eventId: 'case-created-1', eventType: 'case.created' }) }),
    ]));
  });

  it('records explicit escalation and compensation paths in a portable audit', async () => {
    const graph: GraphDefinition = {
      id: 'governed.failure', version: 1, name: 'Governed failure', description: 'Escalates and compensates.',
      state: { fields: {
        action: { type: 'string', required: true, description: 'Action.' },
        recovered: { type: 'boolean', required: false, description: 'Recovery state.' },
      } },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', description: 'Starts.', reads: [], writes: [], config: {} },
        { id: 'unsafe', kind: 'function', label: 'Unsafe action', description: 'Fails.', handler: 'fail', reads: ['action'], writes: [], config: {} },
        { id: 'escalate', kind: 'escalation', label: 'Escalate', description: 'Raises incident.', reads: [], writes: [], config: { reason: 'External action failed', severity: 'high' } },
        { id: 'compensate', kind: 'compensation', label: 'Compensate', description: 'Restores state.', handler: 'recover', reads: [], writes: ['recovered'], config: { compensates: ['unsafe'] } },
      ],
      edges: [
        { id: 'start.unsafe', source: 'start', target: 'unsafe', on: 'success' },
        { id: 'unsafe.escalate', source: 'unsafe', target: 'escalate', on: 'failure' },
        { id: 'unsafe.compensate', source: 'unsafe', target: 'compensate', on: 'failure' },
      ],
      budget,
    };
    const result = await new GraphRuntime(compileGraph(graph), {
      handlers: {
        fail: () => { throw new Error('external failure'); },
        recover: () => ({ recovered: true }),
      },
    }).run({ action: 'publish' });
    expect(result).toMatchObject({ status: 'completed', state: { recovered: true } });
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'node.failed', 'escalation.raised', 'compensation.started', 'compensation.completed',
    ]));
    const bundle = createRunAuditBundle({
      run: { runId: result.runId, packId: 'orchestration_test', graphId: graph.id, graphVersion: graph.version, status: result.status, state: result.state },
      events: result.events,
    });
    expect(verifyRunAuditBundle(bundle).events.some((event) => event.type === 'compensation.completed')).toBe(true);
  });

  it('demonstrates durable orchestration across the Architecture and Customer Success Packs', async () => {
    const architecture = compilePack(architecturePack);
    const architectureDispatcher = new GraphTriggerDispatcher(architecture, { handlers: architectureHandlers });
    const followup = await architectureDispatcher.dispatchWebhook({
      method: 'POST',
      path: '/architecture/feedback-followup',
      body: { project_name: 'Civic hub', feedback_case_id: 'feedback-7' },
    });
    expect(followup.result.status).toBe('paused');
    if (followup.result.status !== 'paused') return;
    expect(followup.result.events.some((event) => event.type === 'event.waiting')).toBe(true);
    const resumed = await new GraphRuntime(architecture.graphs.get('architecture.feedback_followup')!, {
      pack: architecturePack,
      handlers: architectureHandlers,
    }).resume(followup.result.checkpoint, {
      externalEvents: [{ id: 'feedback-7-event', type: 'design.feedback.received', correlationKey: 'feedback-7', payload: { decision: 'revise entrance' }, occurredAt: '2026-08-11T01:00:00.000Z' }],
    });
    expect(resumed).toMatchObject({ status: 'completed', state: { summary: expect.stringContaining('revise entrance') } });
    expect(resumed.events.some((event) => event.type === 'subgraph.completed')).toBe(true);

    const customerSuccess = compilePack(customerSuccessPack);
    const customerDispatcher = new GraphTriggerDispatcher(customerSuccess, { handlers: customerSuccessHandlers });
    const scheduled = await customerDispatcher.dispatchSchedule('customer_success.scheduled_health_scan', { id: 'health-scan-20260811', scheduledFor: '2026-08-11T08:00:00.000Z' });
    expect(scheduled.result).toMatchObject({ status: 'completed', state: { scan_attempt: 2 } });
    expect(scheduled.result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['loop.iteration', 'map.completed']));
    const alerts = await customerDispatcher.dispatchEvent({
      id: 'critical-health-1',
      type: 'customer.health_critical',
      correlationKey: 'account-9',
      payload: { severity: 'critical', simulate_failure: true },
      occurredAt: '2026-08-11T01:05:00.000Z',
    });
    expect(alerts[0]?.result).toMatchObject({ status: 'completed', state: { account_id: 'account-9', recovered: true } });
    expect(alerts[0]?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['escalation.raised', 'compensation.completed']));
  });
});
