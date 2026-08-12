import {
  externalEventSchema,
  parseJsonSchemaValue,
  scheduleOccurrenceSchema,
  type ExternalEvent,
  type ScheduleOccurrence,
} from '@graph-workbench/contracts';
import type { RuntimeBindings } from './adapters.js';
import type { CompiledGraph, CompiledPack } from './compiler.js';
import { GraphRuntime, type RunOptions, type RunResult } from './runtime.js';
import type { GraphState } from './state.js';
import { sha256Json } from './integrity.js';

export interface WebhookInvocation {
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly path: string;
  readonly body: unknown;
}

export interface TriggeredRun {
  readonly packId: string;
  readonly graphId: string;
  readonly triggerType: 'webhook' | 'schedule' | 'event';
  readonly result: RunResult;
}

export function eventTriggeredRunId(packId: string, graphId: string, eventId: string): string {
  return `run-event-${sha256Json({ packId, graphId, eventId }).slice(0, 32)}`;
}

export function webhookTriggeredRunId(packId: string, graphId: string, invocationId: string): string {
  return `run-webhook-${sha256Json({ packId, graphId, invocationId }).slice(0, 32)}`;
}

export function scheduleTriggeredRunId(packId: string, graphId: string, occurrenceId: string): string {
  return `run-schedule-${sha256Json({ packId, graphId, occurrenceId }).slice(0, 32)}`;
}

function objectInput(value: unknown, label: string): GraphState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must resolve to an object graph input.`);
  }
  return value as GraphState;
}

export class GraphTriggerDispatcher {
  constructor(
    private readonly pack: CompiledPack,
    private readonly bindings: RuntimeBindings = {},
  ) {}

  async dispatchWebhook(invocation: WebhookInvocation, options: RunOptions = {}): Promise<TriggeredRun> {
    const candidates = [...this.pack.graphs.values()].filter((graph) => {
      const trigger = graph.definition.trigger;
      return trigger?.type === 'webhook'
        && trigger.method === invocation.method
        && trigger.path === invocation.path;
    });
    if (candidates.length !== 1) {
      throw new Error(candidates.length === 0
        ? `No webhook trigger matches ${invocation.method} ${invocation.path}.`
        : `Webhook trigger ${invocation.method} ${invocation.path} is ambiguous.`);
    }
    const graph = candidates[0]!;
    const trigger = graph.definition.trigger;
    if (!trigger || trigger.type !== 'webhook') throw new Error('Webhook trigger resolution failed.');
    const input = objectInput(
      trigger.inputSchema ? parseJsonSchemaValue(trigger.inputSchema, invocation.body) : invocation.body,
      'Webhook body',
    );
    return this.run(graph, 'webhook', input, {
      ...options,
      triggerContext: { type: 'webhook', method: invocation.method, path: invocation.path },
    });
  }

  async dispatchSchedule(
    graphId: string,
    input: ScheduleOccurrence,
    options: RunOptions = {},
  ): Promise<TriggeredRun> {
    const graph = this.requireGraph(graphId);
    const trigger = graph.definition.trigger;
    if (!trigger || trigger.type !== 'schedule') {
      throw new Error(`Graph "${graphId}" does not declare a schedule trigger.`);
    }
    const occurrence = scheduleOccurrenceSchema.parse(input);
    return this.run(graph, 'schedule', structuredClone(trigger.input), {
      ...options,
      runId: options.runId ?? scheduleTriggeredRunId(this.pack.manifest.id, graphId, occurrence.id),
      triggerContext: {
        type: 'schedule',
        occurrenceId: occurrence.id,
        scheduledFor: occurrence.scheduledFor,
      },
    });
  }

  async dispatchEvent(input: ExternalEvent, options: RunOptions = {}): Promise<readonly TriggeredRun[]> {
    const event = externalEventSchema.parse(input);
    const matches = [...this.pack.graphs.values()].filter((graph) => {
      const trigger = graph.definition.trigger;
      return trigger?.type === 'event' && trigger.eventType === event.type;
    });
    if (options.runId && matches.length > 1) {
      throw new Error('A caller-supplied event runId requires exactly one matching graph.');
    }
    return Promise.all(matches.map((graph) => {
      const trigger = graph.definition.trigger;
      if (!trigger || trigger.type !== 'event') throw new Error('Event trigger resolution failed.');
      const parsed = trigger.inputSchema
        ? parseJsonSchemaValue(trigger.inputSchema, event.payload)
        : event.payload;
      const input = objectInput(parsed, `Event "${event.type}" payload`);
      if (trigger.correlationField) {
        if (!event.correlationKey) {
          throw new Error(`Event "${event.type}" requires a correlationKey for field "${trigger.correlationField}".`);
        }
        input[trigger.correlationField] = event.correlationKey;
      }
      return this.run(graph, 'event', input, {
        ...options,
        runId: options.runId ?? eventTriggeredRunId(this.pack.manifest.id, graph.definition.id, event.id),
        triggerContext: {
          type: 'event',
          eventId: event.id,
          eventType: event.type,
          ...(event.correlationKey ? { correlationKey: event.correlationKey } : {}),
        },
      });
    }));
  }

  private requireGraph(graphId: string): CompiledGraph {
    const graph = this.pack.graphs.get(graphId);
    if (!graph) throw new Error(`Graph "${graphId}" does not exist in Pack "${this.pack.manifest.id}".`);
    return graph;
  }

  private async run(
    graph: CompiledGraph,
    triggerType: TriggeredRun['triggerType'],
    input: GraphState,
    options: RunOptions,
  ): Promise<TriggeredRun> {
    const result = await new GraphRuntime(graph, {
      ...this.bindings,
      pack: this.pack.manifest,
      subgraphs: Object.fromEntries(this.pack.graphs),
    }).run(input, options);
    return { packId: this.pack.manifest.id, graphId: graph.definition.id, triggerType, result };
  }
}
