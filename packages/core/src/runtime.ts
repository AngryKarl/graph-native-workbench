import { randomUUID } from 'node:crypto';
import type {
  EdgeCondition,
  GraphCheckpoint,
  GraphEvent,
  GraphNode,
} from '@graph-workbench/contracts';
import type { CompiledGraph } from './compiler.js';
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
  readonly decisions?: Readonly<Record<string, unknown>>;
  readonly toolApprovals?: Readonly<Record<string, boolean>>;
  readonly onEvent?: (event: GraphEvent) => void | Promise<void>;
  readonly store?: RunStore;
  readonly signal?: AbortSignal;
}

export type RunResult =
  | {
      readonly status: 'completed';
      readonly runId: string;
      readonly state: GraphState;
      readonly events: readonly GraphEvent[];
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
  constructor(
    private readonly graph: CompiledGraph,
    private readonly bindings: RuntimeBindings = {},
  ) {}

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
    await this.emit(mutable, 'run.started', options);
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
      events: [],
    };
    await options.store?.updateRun(mutable.runId, {
      status: 'running',
      state: structuredClone(mutable.state),
    });
    await this.emit(mutable, 'run.resumed', options);
    return this.execute(mutable, options);
  }

  async resumeStored(
    runId: string,
    store: RunStore,
    options: Omit<RunOptions, 'store'> = {},
  ): Promise<RunResult> {
    const checkpoint = await store.getCheckpoint(runId);
    if (!checkpoint) throw new Error(`Run "${runId}" does not have a stored checkpoint.`);
    return this.resume(checkpoint, { ...options, store });
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
        });
        return { nodeId, status: 'paused' };
      }
      const decisionField = String(node.config.decisionField);
      const patch = { [decisionField]: options.decisions?.[nodeId] };
      try {
        assertValidPatch(this.graph.definition.state, node.writes, patch, nodeId);
        await this.emit(mutable, 'human.resolved', options, nodeId, { decisionField });
        return { nodeId, status: 'completed', patch, detail: {} };
      } catch (error) {
        return { nodeId, status: 'failed', error: asError(error) };
      }
    }

    if (node.kind === 'trigger' || node.kind === 'router' || node.kind === 'join') {
      await this.emit(mutable, 'node.started', options, nodeId, { kind: node.kind, attempt: 1 });
      return { nodeId, status: 'completed', patch: {}, detail: {} };
    }

    const maxAttempts = node.execution?.retry?.maxAttempts ?? 1;
    const backoffMs = node.execution?.retry?.backoffMs ?? 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) return { nodeId, status: 'cancelled' };
      await this.emit(mutable, 'node.started', options, nodeId, {
        kind: node.kind,
        attempt,
        maxAttempts,
      });
      const result = await this.executeNodeAttempt(mutable, node, state, options);
      if (result.status === 'completed' || result.status === 'cancelled' || result.status === 'paused') return result;
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

    const requested = this.bindings.authorizeTool
      ? await this.bindings.authorizeTool({ runId: mutable.runId, node, role, tool, input })
      : tool.risk === 'read' ? 'allow' : 'require-approval';
    const authorization = authorizationDecision(requested);
    if (authorization.effect === 'deny') {
      return deny(authorization.reason ?? `risk level "${tool.risk}" is denied by policy`);
    }
    if (authorization.effect === 'require-approval') {
      const inputDigest = sha256Json(input);
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
      await this.emit(mutable, 'tool.approval_resolved', options, node.id, {
        approvalId,
        toolId,
        approved,
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

    await this.emit(mutable, 'tool.started', options, node.id, { toolId, risk: tool.risk });
    try {
      const output = await adapter.execute(input, {
        runId: mutable.runId,
        nodeId: node.id,
        signal,
        secrets,
      });
      await this.emit(mutable, 'tool.completed', options, node.id, { toolId });
      return output;
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
