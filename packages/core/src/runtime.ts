import { randomUUID } from 'node:crypto';
import type {
  ActorIdentity,
  EdgeCondition,
  ExternalEvent,
  GraphCheckpoint,
  GraphEvent,
  GraphNode,
  PortableArtifact,
} from '@graph-workbench/contracts';
import {
  externalEventSchema,
  escalationNodeConfigSchema,
  compensationNodeConfigSchema,
  loopNodeConfigSchema,
  mapNodeConfigSchema,
  parseJsonSchemaValue,
  subgraphNodeConfigSchema,
  waitNodeConfigSchema,
} from '@graph-workbench/contracts';
import { compileGraph, type CompiledGraph } from './compiler.js';
import { createRunArtifacts } from './artifact.js';
import {
  AgentSuspensionError,
  ToolApprovalRequiredError,
  type RuntimeBindings,
  type ToolAuthorizationDecision,
  type ToolAuthorizationEffect,
} from './adapters.js';
import type { RunStore } from './run-store.js';
import { sha256Json } from './integrity.js';
import { assertValidPatch, assertValidState, type GraphState } from './state.js';

export interface RunOptions {
  readonly runId?: string;
  readonly actor?: ActorIdentity;
  readonly historyEvents?: readonly GraphEvent[];
  readonly decisions?: Readonly<Record<string, unknown>>;
  readonly toolApprovals?: Readonly<Record<string, boolean>>;
  readonly onEvent?: (event: GraphEvent) => void | Promise<void>;
  readonly store?: RunStore;
  readonly signal?: AbortSignal;
  readonly externalEvents?: readonly ExternalEvent[];
  readonly triggerContext?:
    | { readonly type: 'webhook'; readonly method: string; readonly path: string }
    | { readonly type: 'schedule'; readonly occurrenceId: string; readonly scheduledFor: string }
    | { readonly type: 'event'; readonly eventId: string; readonly eventType: string; readonly correlationKey?: string };
}

export type RunResult =
  | {
      readonly status: 'completed';
      readonly runId: string;
      readonly state: GraphState;
      readonly events: readonly GraphEvent[];
      readonly artifacts?: readonly PortableArtifact[];
    }
  | {
      readonly status: 'paused';
      readonly runId: string;
      readonly state: GraphState;
      readonly events: readonly GraphEvent[];
      readonly checkpoint: GraphCheckpoint;
    }
  | {
      readonly status: 'failed';
      readonly runId: string;
      readonly state: GraphState;
      readonly events: readonly GraphEvent[];
      readonly error: Error;
    }
  | {
      readonly status: 'cancelled';
      readonly runId: string;
      readonly state: GraphState;
      readonly events: readonly GraphEvent[];
      readonly checkpoint: GraphCheckpoint;
    };

interface MutableRun {
  runId: string;
  state: GraphState;
  completed: Set<string>;
  ready: string[];
  arrivals: Map<string, Set<string>>;
  nextSeq: number;
  stepCount: number;
  startedAt: string;
  activeStartedAtMs: number;
  suspensions: Map<string, unknown>;
  consumedEventIds: Set<string>;
  events: GraphEvent[];
}

type NodeResult =
  | { nodeId: string; status: 'completed'; patch: GraphState; detail: Record<string, unknown> }
  | { nodeId: string; status: 'paused' }
  | { nodeId: string; status: 'cancelled' }
  | { nodeId: string; status: 'failed'; error: Error };

class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled.');
    this.name = 'RunCancelledError';
  }
}

class NodeTimeoutError extends Error {
  constructor(nodeId: string, timeoutMs: number) {
    super(`Node "${nodeId}" timed out after ${timeoutMs}ms.`);
    this.name = 'NodeTimeoutError';
  }
}

class NodeSuspensionError extends Error {
  constructor() {
    super('Node is durably suspended.');
    this.name = 'NodeSuspensionError';
  }
}

function authorizationDecision(
  value: boolean | ToolAuthorizationEffect | ToolAuthorizationDecision,
): ToolAuthorizationDecision {
  if (typeof value === 'boolean') return { effect: value ? 'allow' : 'deny' };
  if (typeof value === 'string') return { effect: value };
  return value;
}

function conditionMatches(condition: EdgeCondition | undefined, state: GraphState): boolean {
  if (!condition) return true;
  const actual = state[condition.field];
  switch (condition.operator) {
    case 'equals':
      return Object.is(actual, condition.value);
    case 'not_equals':
      return !Object.is(actual, condition.value);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'includes':
      return typeof actual === 'string'
        ? actual.includes(String(condition.value))
        : Array.isArray(actual) && actual.includes(condition.value);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class GraphRuntime {
  private readonly subgraphs = new Map<string, CompiledGraph>();

  constructor(
    private readonly graph: CompiledGraph,
    private readonly bindings: RuntimeBindings = {},
  ) {
    for (const [id, child] of Object.entries(bindings.subgraphs ?? {})) this.subgraphs.set(id, child);
    for (const definition of bindings.pack?.graphs ?? []) {
      if (definition.id !== graph.definition.id && !this.subgraphs.has(definition.id)) {
        this.subgraphs.set(definition.id, compileGraph(definition));
      }
    }
  }

  async run(initialState: GraphState, options: RunOptions = {}): Promise<RunResult> {
    assertValidState(this.graph.definition.state, initialState, { requireAllRequired: true });
    const mutable: MutableRun = {
      runId: options.runId ?? `run-${randomUUID()}`,
      state: structuredClone(initialState),
      completed: new Set(),
      ready: [this.graph.triggerNodeId],
      arrivals: new Map(),
      nextSeq: 1,
      stepCount: 0,
      startedAt: new Date().toISOString(),
      activeStartedAtMs: Date.now(),
      suspensions: new Map(),
      consumedEventIds: new Set(),
      events: [],
    };
    await options.store?.createRun({
      runId: mutable.runId,
      graphId: this.graph.definition.id,
      graphVersion: this.graph.definition.version,
      status: 'running',
      state: structuredClone(mutable.state),
      startedAt: mutable.startedAt,
      updatedAt: mutable.startedAt,
      error: null,
    });
    await this.emit(mutable, 'run.started', options, undefined, this.actorDetail(options.actor, 'startedBy'));
    if (options.triggerContext) {
      await this.emit(mutable, 'trigger.accepted', options, undefined, { ...options.triggerContext });
    }
    await options.store?.saveCheckpoint(this.checkpoint(mutable));
    return this.execute(mutable, options);
  }

  async resume(checkpoint: GraphCheckpoint, options: RunOptions = {}): Promise<RunResult> {
    if (
      checkpoint.graphId !== this.graph.definition.id ||
      checkpoint.graphVersion !== this.graph.definition.version
    ) {
      throw new Error('Checkpoint graph identity does not match the compiled graph.');
    }
    assertValidState(this.graph.definition.state, checkpoint.state, { requireAllRequired: true });
    this.assertDecisionAuthority(options);
    const mutable: MutableRun = {
      runId: checkpoint.runId,
      state: structuredClone(checkpoint.state),
      completed: new Set(checkpoint.completedNodeIds),
      ready: [...checkpoint.readyNodeIds],
      arrivals: new Map(
        Object.entries(checkpoint.arrivals).map(([nodeId, sources]) => [nodeId, new Set(sources)]),
      ),
      nextSeq: checkpoint.nextSeq,
      stepCount: checkpoint.stepCount,
      startedAt: checkpoint.startedAt,
      activeStartedAtMs: Date.now(),
      suspensions: new Map(Object.entries(checkpoint.suspensions)),
      consumedEventIds: new Set(checkpoint.consumedEventIds),
      events: [],
    };
    await options.store?.updateRun(mutable.runId, {
      status: 'running',
      state: structuredClone(mutable.state),
    });
    await this.emit(mutable, 'run.resumed', options, undefined, this.actorDetail(options.actor, 'resumedBy'));
    return this.execute(mutable, options);
  }

  async resumeStored(
    runId: string,
    store: RunStore,
    options: Omit<RunOptions, 'store'> = {},
  ): Promise<RunResult> {
    const [checkpoint, historyEvents] = await Promise.all([
      store.getCheckpoint(runId),
      store.listEvents(runId),
    ]);
    if (!checkpoint) throw new Error(`Run "${runId}" does not have a stored checkpoint.`);
    return this.resume(checkpoint, { ...options, historyEvents, store });
  }

  private async execute(mutable: MutableRun, options: RunOptions): Promise<RunResult> {
    const budget = this.graph.definition.budget;
    try {
      while (mutable.ready.length > 0) {
        if (options.signal?.aborted) throw new RunCancelledError();
        if (mutable.stepCount >= budget.maxSteps) throw new Error(`Step budget exceeded (${budget.maxSteps}).`);
        if (Date.now() - mutable.activeStartedAtMs > budget.maxDurationMs) {
          throw new Error(`Duration budget exceeded (${budget.maxDurationMs}ms).`);
        }

        const batch = mutable.ready.splice(0, budget.maxConcurrency);
        const snapshot = structuredClone(mutable.state);
        const results = await Promise.all(
          batch.map((nodeId) => this.executeNode(mutable, nodeId, snapshot, options)),
        );
        if (options.signal?.aborted || results.some((result) => result.status === 'cancelled')) {
          for (const nodeId of batch.toReversed()) mutable.ready.unshift(nodeId);
          throw new RunCancelledError();
        }
        const paused = results.filter((result) => result.status === 'paused');

        const writtenInBatch = new Map<string, string>();
        for (const result of results) {
          if (result.status !== 'completed') continue;
          for (const [key, value] of Object.entries(result.patch)) {
            const previousWriter = writtenInBatch.get(key);
            if (previousWriter) {
              throw new Error(`Parallel nodes "${previousWriter}" and "${result.nodeId}" both wrote "${key}".`);
            }
            writtenInBatch.set(key, result.nodeId);
            mutable.state[key] = value;
          }
          mutable.completed.add(result.nodeId);
          mutable.stepCount += 1;
          await this.emit(mutable, 'node.completed', options, result.nodeId, {
            writtenFields: Object.keys(result.patch),
            ...result.detail,
          });
        }

        for (const result of results) {
          if (result.status === 'completed') this.advance(mutable, result.nodeId, 'success');
          if (result.status === 'failed') {
            const advanced = this.advance(mutable, result.nodeId, 'failure');
            if (!advanced) {
              mutable.ready.unshift(result.nodeId);
              throw result.error;
            }
          }
        }

        if (paused.length > 0) {
          for (const item of paused) mutable.ready.unshift(item.nodeId);
          await this.emit(mutable, 'run.paused', options, paused[0]?.nodeId);
          const checkpoint = this.checkpoint(mutable);
          await options.store?.saveCheckpoint(checkpoint);
          await options.store?.updateRun(mutable.runId, {
            status: 'paused',
            state: structuredClone(mutable.state),
          });
          return {
            status: 'paused',
            runId: mutable.runId,
            state: structuredClone(mutable.state),
            events: mutable.events,
            checkpoint,
          };
        }

        await options.store?.saveCheckpoint(this.checkpoint(mutable));
        await options.store?.updateRun(mutable.runId, {
          status: 'running',
          state: structuredClone(mutable.state),
        });
      }

      const artifacts = this.bindings.pack
        ? createRunArtifacts({
            pack: this.bindings.pack,
            graph: this.graph.definition,
            runId: mutable.runId,
            state: mutable.state,
            events: [...(options.historyEvents ?? []), ...mutable.events],
          })
        : [];
      await this.emit(mutable, 'run.completed', options);
      await options.store?.updateRun(mutable.runId, {
        status: 'completed',
        state: structuredClone(mutable.state),
      });
      await options.store?.clearCheckpoint(mutable.runId);
      return {
        status: 'completed',
        runId: mutable.runId,
        state: structuredClone(mutable.state),
        events: mutable.events,
        ...(artifacts.length > 0 ? { artifacts } : {}),
      };
    } catch (error) {
      const resolved = asError(error);
      if (resolved instanceof RunCancelledError) {
        await this.emit(mutable, 'run.cancelled', options);
        const checkpoint = this.checkpoint(mutable);
        await options.store?.saveCheckpoint(checkpoint);
        await options.store?.updateRun(mutable.runId, {
          status: 'cancelled',
          state: structuredClone(mutable.state),
          error: null,
        });
        return {
          status: 'cancelled',
          runId: mutable.runId,
          state: structuredClone(mutable.state),
          events: mutable.events,
          checkpoint,
        };
      }
      await this.emit(mutable, 'run.failed', options, undefined, { message: resolved.message });
      await options.store?.saveCheckpoint(this.checkpoint(mutable));
      await options.store?.updateRun(mutable.runId, {
        status: 'failed',
        state: structuredClone(mutable.state),
        error: resolved.message,
      });
      return {
        status: 'failed',
        runId: mutable.runId,
        state: structuredClone(mutable.state),
        events: mutable.events,
        error: resolved,
      };
    }
  }

  private async executeNode(
    mutable: MutableRun,
    nodeId: string,
    state: GraphState,
    options: RunOptions,
  ): Promise<NodeResult> {
    const node = this.graph.nodeById.get(nodeId);
    if (!node) return { nodeId, status: 'failed', error: new Error(`Unknown node "${nodeId}".`) };
    if (node.kind === 'human') {
      await this.emit(mutable, 'node.started', options, nodeId, { kind: node.kind, attempt: 1 });
      if (!(nodeId in (options.decisions ?? {}))) {
        await this.emit(mutable, 'human.requested', options, nodeId, {
          decisionField: node.config.decisionField,
          ...(typeof node.config.roleId === 'string' ? { requiredRoleId: node.config.roleId } : {}),
        });
        return { nodeId, status: 'paused' };
      }
      const decisionField = String(node.config.decisionField);
      const patch = { [decisionField]: options.decisions?.[nodeId] };
      try {
        this.assertActorRole(node, options.actor);
        assertValidPatch(this.graph.definition.state, node.writes, patch, nodeId);
        await this.emit(mutable, 'human.resolved', options, nodeId, {
          decisionField,
          ...(typeof node.config.roleId === 'string' ? { requiredRoleId: node.config.roleId } : {}),
          ...this.actorDetail(options.actor, 'resolvedBy'),
        });
        return { nodeId, status: 'completed', patch, detail: {} };
      } catch (error) {
        return { nodeId, status: 'failed', error: asError(error) };
      }
    }

    if (node.kind === 'wait') {
      await this.emit(mutable, 'node.started', options, nodeId, { kind: node.kind, attempt: 1 });
      try {
        const patch = await this.executeWait(mutable, node, state, options);
        return { nodeId, status: 'completed', patch, detail: {} };
      } catch (error) {
        if (error instanceof NodeSuspensionError) return { nodeId, status: 'paused' };
        return { nodeId, status: 'failed', error: asError(error) };
      }
    }

    if (node.kind === 'escalation') {
      const config = escalationNodeConfigSchema.parse(node.config);
      await this.emit(mutable, 'node.started', options, nodeId, { kind: node.kind, attempt: 1 });
      await this.emit(mutable, 'escalation.raised', options, nodeId, {
        reason: config.reason,
        severity: config.severity,
        ...(config.roleId ? { roleId: config.roleId } : {}),
      });
      return { nodeId, status: 'completed', patch: {}, detail: { severity: config.severity } };
    }

    if (node.kind === 'trigger' || node.kind === 'router' || node.kind === 'join') {
      await this.emit(mutable, 'node.started', options, nodeId, { kind: node.kind, attempt: 1 });
      return { nodeId, status: 'completed', patch: {}, detail: {} };
    }

    const maxAttempts = node.execution?.retry?.maxAttempts ?? 1;
    const backoffMs = node.execution?.retry?.backoffMs ?? 0;
    if (node.kind === 'compensation') {
      const config = compensationNodeConfigSchema.parse(node.config);
      await this.emit(mutable, 'compensation.started', options, nodeId, { compensates: config.compensates });
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) return { nodeId, status: 'cancelled' };
      await this.emit(mutable, 'node.started', options, nodeId, {
        kind: node.kind,
        attempt,
        maxAttempts,
      });
      const result = await this.executeNodeAttempt(mutable, node, state, options);
      if (result.status === 'completed') {
        if (node.kind === 'compensation') {
          const config = compensationNodeConfigSchema.parse(node.config);
          await this.emit(mutable, 'compensation.completed', options, nodeId, { compensates: config.compensates });
        }
        return result;
      }
      if (result.status === 'cancelled' || result.status === 'paused') return result;
      const timedOut = result.error instanceof NodeTimeoutError;
      if (timedOut) {
        await this.emit(mutable, 'node.timed_out', options, nodeId, {
          attempt,
          timeoutMs: node.execution?.timeoutMs,
        });
      }
      if (attempt === maxAttempts) {
        await this.emit(mutable, 'node.failed', options, nodeId, {
          attempt,
          message: result.error.message,
        });
        return result;
      }
      await this.emit(mutable, 'node.retrying', options, nodeId, {
        attempt,
        nextAttempt: attempt + 1,
        backoffMs,
        message: result.error.message,
      });
      try {
        await this.delay(backoffMs, options.signal);
      } catch {
        return { nodeId, status: 'cancelled' };
      }
    }
    throw new Error('Unreachable retry state.');
  }

  private async executeNodeAttempt(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
  ): Promise<NodeResult> {
    const controller = new AbortController();
    let rejectCancellation: ((error: RunCancelledError) => void) | undefined;
    const cancellationPromise = options.signal
      ? new Promise<never>((_resolve, reject) => { rejectCancellation = reject; })
      : undefined;
    const cancel = () => {
      controller.abort(options.signal?.reason);
      rejectCancellation?.(new RunCancelledError());
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = node.execution?.timeoutMs;
    const timeoutPromise = timeoutMs
      ? new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort(new NodeTimeoutError(node.id, timeoutMs));
            reject(new NodeTimeoutError(node.id, timeoutMs));
          }, timeoutMs);
        })
      : undefined;

    try {
      const execution = this.invokeNode(mutable, node, state, options, controller.signal);
      const result = await Promise.race([
        execution,
        ...(timeoutPromise ? [timeoutPromise] : []),
        ...(cancellationPromise ? [cancellationPromise] : []),
      ]);
      return { nodeId: node.id, status: 'completed', patch: result.patch, detail: result.detail };
    } catch (error) {
      if (options.signal?.aborted) return { nodeId: node.id, status: 'cancelled' };
      if (error instanceof ToolApprovalRequiredError) return { nodeId: node.id, status: 'paused' };
      if (error instanceof NodeSuspensionError) return { nodeId: node.id, status: 'paused' };
      return { nodeId: node.id, status: 'failed', error: asError(error) };
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  private async invokeNode(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
    signal: AbortSignal,
  ): Promise<{ patch: GraphState; detail: Record<string, unknown> }> {

    if (node.kind === 'subgraph') return this.invokeSubgraph(mutable, node, state, options);
    if (node.kind === 'loop') return this.invokeLoop(mutable, node, state, options);
    if (node.kind === 'map') return this.invokeMap(mutable, node, state, options);

    const agent = node.kind === 'agent' && node.handler
      ? this.bindings.agents?.[node.handler]
      : undefined;
    if (agent) {
      try {
        const roleId = typeof node.config.roleId === 'string' ? node.config.roleId : undefined;
        const role = roleId
          ? this.bindings.pack?.roles.find((item) => item.id === roleId)
          : undefined;
        const toolIds = Array.isArray(node.config.toolIds)
          ? node.config.toolIds.filter((item): item is string => typeof item === 'string')
          : [];
        const tools = this.bindings.pack?.tools.filter((item) => toolIds.includes(item.id)) ?? [];
        const result = await agent.run({
          runId: mutable.runId,
          node,
          state,
          signal,
          toolIds,
          tools,
          ...(mutable.suspensions.has(node.id) ? { resumeState: mutable.suspensions.get(node.id) } : {}),
          ...(role ? { role } : {}),
          invokeTool: (toolId, input) =>
            this.invokeTool(mutable, options, node, roleId, toolIds, toolId, input, signal),
        });
        mutable.suspensions.delete(node.id);
        assertValidPatch(this.graph.definition.state, node.writes, result.patch, node.id);
        return { patch: result.patch, detail: result.usage ? { usage: result.usage } : {} };
      } catch (error) {
        if (error instanceof AgentSuspensionError) {
          mutable.suspensions.set(node.id, structuredClone(error.suspensionState));
          throw error.reason;
        }
        throw asError(error);
      }
    }

    const handler = node.handler ? this.bindings.handlers?.[node.handler] : undefined;
    if (!handler) {
      throw new Error(`No handler registered for "${node.handler ?? node.id}".`);
    }

    try {
      const patch = await handler({ runId: mutable.runId, node, state, signal });
      assertValidPatch(this.graph.definition.state, node.writes, patch, node.id);
      return { patch, detail: {} };
    } catch (error) {
      throw asError(error);
    }
  }

  private async executeWait(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
  ): Promise<GraphState> {
    const config = waitNodeConfigSchema.parse(node.config);
    const existing = mutable.suspensions.get(node.id);
    if (config.mode === 'timer') {
      const now = (this.bindings.clock?.() ?? new Date()).getTime();
      if (!existing) {
        const resumeAt = new Date(now + config.durationMs).toISOString();
        mutable.suspensions.set(node.id, { type: 'timer', resumeAt });
        await this.emit(mutable, 'wait.scheduled', options, node.id, { resumeAt, durationMs: config.durationMs });
        throw new NodeSuspensionError();
      }
      const suspension = existing as { type?: unknown; resumeAt?: unknown };
      if (suspension.type !== 'timer' || typeof suspension.resumeAt !== 'string') {
        throw new Error(`Wait node "${node.id}" has an incompatible checkpoint suspension.`);
      }
      if (now < Date.parse(suspension.resumeAt)) throw new NodeSuspensionError();
      mutable.suspensions.delete(node.id);
      await this.emit(mutable, 'wait.resumed', options, node.id, { resumeAt: suspension.resumeAt });
      return {};
    }

    const correlationValue = state[config.correlationField];
    if (typeof correlationValue !== 'string' && typeof correlationValue !== 'number') {
      throw new Error(`Wait node "${node.id}" correlation field "${config.correlationField}" must be a string or number.`);
    }
    const correlationKey = String(correlationValue);
    if (!existing) {
      mutable.suspensions.set(node.id, { type: 'event', eventType: config.eventType, correlationKey });
      await this.emit(mutable, 'event.waiting', options, node.id, { eventType: config.eventType, correlationKey });
      throw new NodeSuspensionError();
    }
    const suspension = existing as { type?: unknown; eventType?: unknown; correlationKey?: unknown };
    if (
      suspension.type !== 'event'
      || suspension.eventType !== config.eventType
      || suspension.correlationKey !== correlationKey
    ) {
      throw new Error(`Wait node "${node.id}" has an incompatible checkpoint suspension.`);
    }
    const event = (options.externalEvents ?? [])
      .map((item) => externalEventSchema.parse(item))
      .find((item) => !mutable.consumedEventIds.has(item.id)
        && item.type === config.eventType && item.correlationKey === correlationKey);
    if (!event) throw new NodeSuspensionError();
    const patch = config.payloadField ? { [config.payloadField]: event.payload } : {};
    assertValidPatch(this.graph.definition.state, node.writes, patch, node.id);
    mutable.suspensions.delete(node.id);
    mutable.consumedEventIds.add(event.id);
    await this.emit(mutable, 'event.received', options, node.id, {
      eventId: event.id,
      eventType: event.type,
      correlationKey,
      occurredAt: event.occurredAt,
    });
    return patch;
  }

  private childGraph(graphId: string): CompiledGraph {
    const child = this.subgraphs.get(graphId);
    if (!child) throw new Error(`Subgraph "${graphId}" is not available to the runtime.`);
    return child;
  }

  private childRuntime(graphId: string): GraphRuntime {
    return new GraphRuntime(this.childGraph(graphId), {
      ...this.bindings,
      subgraphs: Object.fromEntries(this.subgraphs),
    });
  }

  private mappedInput(mapping: Readonly<Record<string, string>>, state: GraphState): GraphState {
    return Object.fromEntries(Object.entries(mapping).map(([childField, parentField]) => [
      childField,
      structuredClone(state[parentField]),
    ]));
  }

  private mappedOutput(mapping: Readonly<Record<string, string>>, state: GraphState): GraphState {
    return Object.fromEntries(Object.entries(mapping).map(([parentField, childField]) => [
      parentField,
      structuredClone(state[childField]),
    ]));
  }

  private async invokeSubgraph(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
  ): Promise<{ patch: GraphState; detail: Record<string, unknown> }> {
    const config = subgraphNodeConfigSchema.parse(node.config);
    const existing = mutable.suspensions.get(node.id) as {
      type?: unknown;
      graphId?: unknown;
      checkpoint?: unknown;
      historyEvents?: unknown;
    } | undefined;
    const runtime = this.childRuntime(config.graphId);
    if (!existing) await this.emit(mutable, 'subgraph.started', options, node.id, { graphId: config.graphId });
    if (existing && (existing.type !== 'subgraph' || existing.graphId !== config.graphId)) {
      throw new Error(`Subgraph node "${node.id}" has an incompatible checkpoint suspension.`);
    }
    const result = existing
      ? await runtime.resume(existing.checkpoint as GraphCheckpoint, {
          ...(options.actor ? { actor: options.actor } : {}),
          ...(existing.historyEvents ? { historyEvents: existing.historyEvents as GraphEvent[] } : {}),
          ...(options.decisions ? { decisions: options.decisions } : {}),
          ...(options.toolApprovals ? { toolApprovals: options.toolApprovals } : {}),
          ...(options.externalEvents ? { externalEvents: options.externalEvents } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : await runtime.run(this.mappedInput(config.inputMapping, state), {
          ...(options.actor ? { actor: options.actor } : {}),
          ...(options.decisions ? { decisions: options.decisions } : {}),
          ...(options.toolApprovals ? { toolApprovals: options.toolApprovals } : {}),
          ...(options.externalEvents ? { externalEvents: options.externalEvents } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
    if (result.status === 'paused' || result.status === 'cancelled') {
      mutable.suspensions.set(node.id, {
        type: 'subgraph',
        graphId: config.graphId,
        checkpoint: result.checkpoint,
        historyEvents: [...((existing?.historyEvents as GraphEvent[] | undefined) ?? []), ...result.events],
      });
      throw new NodeSuspensionError();
    }
    if (result.status === 'failed') throw result.error;
    mutable.suspensions.delete(node.id);
    const patch = this.mappedOutput(config.outputMapping, result.state);
    await this.emit(mutable, 'subgraph.completed', options, node.id, {
      graphId: config.graphId,
      childRunId: result.runId,
    });
    return { patch, detail: { subgraphId: config.graphId, childRunId: result.runId } };
  }

  private async invokeLoop(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
  ): Promise<{ patch: GraphState; detail: Record<string, unknown> }> {
    const config = loopNodeConfigSchema.parse(node.config);
    const working = structuredClone(state);
    let iterations = 0;
    while (Object.is(working[config.conditionField], config.conditionValue)) {
      if (iterations >= config.maxIterations) {
        throw new Error(`Loop node "${node.id}" exceeded its ${config.maxIterations} iteration budget.`);
      }
      iterations += 1;
      await this.emit(mutable, 'loop.iteration', options, node.id, {
        graphId: config.graphId,
        iteration: iterations,
        maxIterations: config.maxIterations,
      });
      const result = await this.childRuntime(config.graphId).run(this.mappedInput(config.inputMapping, working), {
        ...(options.actor ? { actor: options.actor } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (result.status === 'failed') throw result.error;
      if (result.status !== 'completed') {
        throw new Error(`Loop node "${node.id}" child graph must complete without suspension.`);
      }
      Object.assign(working, this.mappedOutput(config.outputMapping, result.state));
    }
    return {
      patch: Object.fromEntries(node.writes.map((field) => [field, structuredClone(working[field])])),
      detail: { iterations, subgraphId: config.graphId },
    };
  }

  private async invokeMap(
    mutable: MutableRun,
    node: GraphNode,
    state: GraphState,
    options: RunOptions,
  ): Promise<{ patch: GraphState; detail: Record<string, unknown> }> {
    const config = mapNodeConfigSchema.parse(node.config);
    const items = state[config.itemsField];
    if (!Array.isArray(items)) throw new Error(`Map node "${node.id}" field "${config.itemsField}" must be an array.`);
    if (items.length > config.maxItems) throw new Error(`Map node "${node.id}" exceeds its ${config.maxItems} item budget.`);
    await this.emit(mutable, 'map.started', options, node.id, {
      graphId: config.graphId,
      itemCount: items.length,
      maxConcurrency: config.maxConcurrency,
    });
    const output: unknown[] = [];
    for (let offset = 0; offset < items.length; offset += config.maxConcurrency) {
      const batch = items.slice(offset, offset + config.maxConcurrency);
      const results = await Promise.all(batch.map(async (item) => {
        const input = this.mappedInput(config.inputMapping, state);
        input[config.itemField] = structuredClone(item);
        const result = await this.childRuntime(config.graphId).run(input, {
          ...(options.actor ? { actor: options.actor } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (result.status === 'failed') throw result.error;
        if (result.status !== 'completed') {
          throw new Error(`Map node "${node.id}" child graph must complete without suspension.`);
        }
        return structuredClone(result.state[config.resultField]);
      }));
      output.push(...results);
    }
    await this.emit(mutable, 'map.completed', options, node.id, {
      graphId: config.graphId,
      itemCount: items.length,
    });
    return { patch: { [config.outputField]: output }, detail: { itemCount: items.length } };
  }

  private delay(durationMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new RunCancelledError());
    if (durationMs === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      }, durationMs);
      const cancel = () => {
        clearTimeout(timeout);
        reject(new RunCancelledError());
      };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  private async invokeTool(
    mutable: MutableRun,
    options: RunOptions,
    node: GraphNode,
    roleId: string | undefined,
    declaredToolIds: readonly string[],
    toolId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    await this.emit(mutable, 'tool.requested', options, node.id, { toolId });
    const deny = async (reason: string): Promise<never> => {
      await this.emit(mutable, 'tool.denied', options, node.id, { toolId, reason });
      throw new Error(`Tool "${toolId}" denied for node "${node.id}": ${reason}`);
    };

    const pack = this.bindings.pack;
    if (!pack) return deny('the runtime has no Pack governance manifest');
    const tool = pack.tools.find((item) => item.id === toolId);
    if (!tool) return deny('the tool is not declared by the Pack');
    if (!declaredToolIds.includes(toolId)) return deny('the node did not declare this tool');
    const role = roleId ? pack.roles.find((item) => item.id === roleId) : undefined;
    if (!role) return deny('the node does not have a declared Pack role');
    if (!role.allowedTools.includes(toolId)) return deny(`role "${role.id}" does not allow it`);
    const adapter = this.bindings.tools?.[toolId];
    if (!adapter) return deny('no runtime adapter is registered');

    let validatedInput = input;
    if (tool.inputSchema) {
      try {
        validatedInput = parseJsonSchemaValue(tool.inputSchema, input);
      } catch {
        return deny('input does not match the declared schema');
      }
    }
    let idempotencyKey: string | undefined;
    if (tool.idempotency === 'keyed') {
      const record = validatedInput && typeof validatedInput === 'object' && !Array.isArray(validatedInput)
        ? validatedInput as Record<string, unknown>
        : undefined;
      const value = tool.idempotencyKeyField ? record?.[tool.idempotencyKeyField] : undefined;
      if (typeof value !== 'string' || !value.trim()) {
        return deny(`idempotency key field "${tool.idempotencyKeyField}" must be a non-empty string`);
      }
      idempotencyKey = value;
    }

    const requested = this.bindings.authorizeTool
      ? await this.bindings.authorizeTool({ runId: mutable.runId, node, role, tool, input: validatedInput })
      : tool.risk === 'read' ? 'allow' : 'require-approval';
    const authorization = authorizationDecision(requested);
    if (authorization.effect === 'deny') {
      return deny(authorization.reason ?? `risk level "${tool.risk}" is denied by policy`);
    }
    if (authorization.effect === 'require-approval') {
      const inputDigest = sha256Json(validatedInput);
      const approvalId = `tool-${sha256Json({
        runId: mutable.runId,
        nodeId: node.id,
        roleId: role.id,
        toolId,
        inputDigest,
      }).slice(0, 24)}`;
      const approved = options.toolApprovals?.[approvalId];
      if (approved === undefined) {
        await this.emit(mutable, 'tool.approval_requested', options, node.id, {
          approvalId,
          toolId,
          roleId: role.id,
          risk: tool.risk,
          inputDigest,
          ...(authorization.ruleId ? { policyRuleId: authorization.ruleId } : {}),
          ...(authorization.reason ? { reason: authorization.reason } : {}),
        });
        throw new ToolApprovalRequiredError(approvalId);
      }
      try {
        this.assertActorRole(node, options.actor);
      } catch (error) {
        await this.emit(mutable, 'tool.denied', options, node.id, {
          toolId,
          reason: asError(error).message,
        });
        throw new ToolApprovalRequiredError(approvalId);
      }
      await this.emit(mutable, 'tool.approval_resolved', options, node.id, {
        approvalId,
        toolId,
        approved,
        ...this.actorDetail(options.actor, 'resolvedBy'),
        ...(authorization.ruleId ? { policyRuleId: authorization.ruleId } : {}),
      });
      if (!approved) return deny('the requested tool approval was rejected');
    }

    const secrets: Record<string, string> = {};
    for (const name of new Set(adapter.requiredSecrets ?? [])) {
      const value = await this.bindings.secrets?.get(name);
      if (value === undefined) return deny(`required secret "${name}" is unavailable`);
      secrets[name] = value;
    }

    await this.emit(mutable, 'tool.started', options, node.id, {
      toolId,
      risk: tool.risk,
      ...(tool.operation ? { operation: tool.operation, idempotency: tool.idempotency } : {}),
    });
    try {
      const output = await adapter.execute(validatedInput, {
        runId: mutable.runId,
        nodeId: node.id,
        signal,
        secrets,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      const validatedOutput = tool.outputSchema
        ? parseJsonSchemaValue(tool.outputSchema, output)
        : output;
      await this.emit(mutable, 'tool.completed', options, node.id, {
        toolId,
        ...(tool.outputSchema ? { outputSchemaValidated: true } : {}),
      });
      return validatedOutput;
    } catch (error) {
      const resolved = asError(error);
      await this.emit(mutable, 'tool.failed', options, node.id, {
        toolId,
        message: resolved.message,
      });
      throw resolved;
    }
  }

  private advance(mutable: MutableRun, sourceNodeId: string, outcome: 'success' | 'failure'): boolean {
    let advanced = false;
    for (const edge of this.graph.outgoingByNode.get(sourceNodeId) ?? []) {
      if (edge.on !== outcome && edge.on !== 'always') continue;
      if (!conditionMatches(edge.condition, mutable.state)) continue;
      advanced = true;
      const arrivals = mutable.arrivals.get(edge.target) ?? new Set<string>();
      arrivals.add(sourceNodeId);
      mutable.arrivals.set(edge.target, arrivals);

      const target = this.graph.nodeById.get(edge.target);
      if (!target || mutable.completed.has(target.id) || mutable.ready.includes(target.id)) continue;
      const required = new Set((this.graph.incomingByNode.get(target.id) ?? []).map((item) => item.source));
      const ready = target.kind !== 'join' || [...required].every((source) => arrivals.has(source));
      if (ready) mutable.ready.push(target.id);
    }
    return advanced;
  }

  private assertDecisionAuthority(options: RunOptions): void {
    if (!options.actor) return;
    for (const nodeId of Object.keys(options.decisions ?? {})) {
      const node = this.graph.nodeById.get(nodeId);
      if (node) this.assertActorRole(node, options.actor);
    }
  }

  private assertActorRole(node: GraphNode, actor: ActorIdentity | undefined): void {
    const requiredRoleId = typeof node.config.roleId === 'string' ? node.config.roleId : undefined;
    if (!actor || !requiredRoleId || actor.workspaceRole === 'owner' || actor.roleIds.includes(requiredRoleId)) return;
    throw new Error(
      `Actor "${actor.id}" cannot resolve node "${node.id}"; role "${requiredRoleId}" is required.`,
    );
  }

  private actorDetail(actor: ActorIdentity | undefined, prefix: string): Record<string, unknown> {
    return actor ? {
      [`${prefix}ActorId`]: actor.id,
      [`${prefix}ActorKind`]: actor.kind,
      [`${prefix}ActorName`]: actor.displayName,
    } : {};
  }

  private checkpoint(mutable: MutableRun): GraphCheckpoint {
    return {
      runId: mutable.runId,
      graphId: this.graph.definition.id,
      graphVersion: this.graph.definition.version,
      state: structuredClone(mutable.state),
      completedNodeIds: [...mutable.completed],
      readyNodeIds: [...mutable.ready],
      arrivals: Object.fromEntries(
        [...mutable.arrivals].map(([nodeId, sources]) => [nodeId, [...sources]]),
      ),
      nextSeq: mutable.nextSeq,
      stepCount: mutable.stepCount,
      startedAt: mutable.startedAt,
      suspensions: Object.fromEntries(mutable.suspensions),
      consumedEventIds: [...mutable.consumedEventIds],
    };
  }

  private async emit(
    mutable: MutableRun,
    type: GraphEvent['type'],
    options: RunOptions,
    nodeId?: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    const event: GraphEvent = {
      runId: mutable.runId,
      seq: mutable.nextSeq++,
      timestamp: new Date().toISOString(),
      type,
      detail,
      ...(nodeId ? { nodeId } : {}),
    };
    mutable.events.push(event);
    await options.store?.appendEvent(event);
    await options.onEvent?.(event);
  }
}
