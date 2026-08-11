import { mkdirSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type {
  ActorIdentity,
  ContextObject,
  ContextRelation,
  ExternalEvent,
  ScheduleOccurrence,
  GraphDefinition,
  GraphEvent,
  PortableArtifact,
} from '@graph-workbench/contracts';
import { actorIdentitySchema, externalEventSchema, graphDefinitionSchema } from '@graph-workbench/contracts';
import {
  compilePack,
  createRunAuditBundle,
  createPolicyToolAuthorizer,
  defaultToolPolicy,
  GraphRuntime,
  GraphTriggerDispatcher,
  eventTriggeredRunId,
  scheduleTriggeredRunId,
  webhookTriggeredRunId,
  InMemoryContextGraphStore,
  SQLiteContextGraphStore,
  sha256Json,
  type ContextGraphStore,
  type GraphState,
  type ToolAuthorizer,
  type ToolPolicy,
} from '@graph-workbench/core';
import { bundledPackCatalog, requirePackRuntime } from './catalog.js';
import { WorkbenchModelService } from './model-service.js';
import {
  WorkbenchWorkspaceStore,
  type StoredModelProvider,
  type StoredGraphDraft,
  type StoredRunSession,
} from './workspace-store.js';

export interface WorkbenchContextSnapshot {
  readonly objects: readonly ContextObject[];
  readonly relations: readonly ContextRelation[];
}

export interface WorkbenchContextView extends WorkbenchContextSnapshot {
  readonly sourceRunIds: readonly string[];
}

export interface WorkbenchRunSnapshot {
  readonly runId: string;
  readonly packId: string;
  readonly graphId: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly state: GraphState;
  readonly events: readonly GraphEvent[];
  readonly error?: string;
  readonly artifacts?: readonly PortableArtifact[];
  readonly pendingApproval?: {
    readonly kind: 'human' | 'tool';
    readonly id: string;
    readonly nodeId: string;
    readonly toolId?: string;
    readonly risk?: string;
    readonly inputDigest?: string;
    readonly requiredRoleId?: string;
    readonly requiredRoleLabel?: string;
    readonly actingActorId: string;
    readonly actingActorName: string;
    readonly actorAuthorized: boolean;
  };
  readonly pendingWait?: {
    readonly nodeId: string;
    readonly mode: 'timer' | 'event' | 'subgraph';
    readonly resumeAt?: string;
    readonly eventType?: string;
    readonly correlationKey?: string;
  };
  readonly context?: WorkbenchContextSnapshot;
}

export interface GraphPosition {
  readonly x: number;
  readonly y: number;
}

export interface StartRunOptions {
  readonly packId?: string;
  readonly graphId?: string;
  readonly graph?: GraphDefinition;
}

function draftKey(packId: string, graphId: string): string {
  return `${packId}:${graphId}`;
}

function pendingToolApproval(events: readonly GraphEvent[]) {
  const resolved = new Set(events
    .filter((event) => event.type === 'tool.approval_resolved')
    .map((event) => String(event.detail.approvalId ?? '')));
  const requested = [...events].reverse().find((event) =>
    event.type === 'tool.approval_requested'
    && typeof event.detail.approvalId === 'string'
    && !resolved.has(event.detail.approvalId));
  if (!requested || typeof requested.detail.approvalId !== 'string' || !requested.nodeId) return undefined;
  return {
    kind: 'tool' as const,
    id: requested.detail.approvalId,
    nodeId: requested.nodeId,
    ...(typeof requested.detail.toolId === 'string' ? { toolId: requested.detail.toolId } : {}),
    ...(typeof requested.detail.risk === 'string' ? { risk: requested.detail.risk } : {}),
    ...(typeof requested.detail.inputDigest === 'string' ? { inputDigest: requested.detail.inputDigest } : {}),
    ...(typeof requested.detail.roleId === 'string' ? { requiredRoleId: requested.detail.roleId } : {}),
  };
}

function defaultContextFile(dataFile: string): string {
  const stem = basename(dataFile, extname(dataFile));
  return resolve(dirname(dataFile), stem === 'workbench' ? 'context.sqlite' : `${stem}.context.sqlite`);
}

function actorCanResolve(actor: ActorIdentity, requiredRoleId?: string): boolean {
  return !requiredRoleId
    || actor.workspaceRole === 'owner'
    || actor.roleIds.includes(requiredRoleId);
}

function pendingApproval(
  session: StoredRunSession,
  actor: ActorIdentity,
): WorkbenchRunSnapshot['pendingApproval'] {
  if (session.status !== 'paused' || !session.checkpoint) return undefined;
  const tool = pendingToolApproval(session.events);
  const human = tool ? undefined : session.graph.nodes.find((node) =>
    node.kind === 'human' && session.checkpoint?.readyNodeIds.includes(node.id));
  const approval = tool ?? (human ? {
    kind: 'human' as const,
    id: human.id,
    nodeId: human.id,
    ...(typeof human.config.roleId === 'string' ? { requiredRoleId: human.config.roleId } : {}),
  } : undefined);
  if (!approval) return undefined;
  const role = approval.requiredRoleId
    ? requirePackRuntime(session.packId).manifest.roles.find((item) => item.id === approval.requiredRoleId)
    : undefined;
  return {
    ...approval,
    ...(role ? { requiredRoleLabel: role.label } : {}),
    actingActorId: actor.id,
    actingActorName: actor.displayName,
    actorAuthorized: actorCanResolve(actor, approval.requiredRoleId),
  };
}

function publicRun(session: StoredRunSession, actor: ActorIdentity): WorkbenchRunSnapshot {
  const approval = pendingApproval(session, actor);
  const wait = pendingWait(session);
  return {
    runId: session.runId,
    packId: session.packId,
    graphId: session.graph.id,
    status: session.status,
    state: session.state,
    events: session.events,
    ...(approval ? { pendingApproval: approval } : {}),
    ...(wait ? { pendingWait: wait } : {}),
    ...(session.error ? { error: session.error } : {}),
    ...(session.artifacts ? { artifacts: session.artifacts } : {}),
    ...(session.context ? { context: session.context } : {}),
  };
}

function pendingWait(session: StoredRunSession): WorkbenchRunSnapshot['pendingWait'] {
  if (session.status !== 'paused' || !session.checkpoint) return undefined;
  for (const nodeId of session.checkpoint.readyNodeIds) {
    const value = session.checkpoint.suspensions[nodeId];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const suspension = value as Record<string, unknown>;
    if (suspension.type === 'timer' && typeof suspension.resumeAt === 'string') {
      return { nodeId, mode: 'timer', resumeAt: suspension.resumeAt };
    }
    if (suspension.type === 'event' && typeof suspension.eventType === 'string' && typeof suspension.correlationKey === 'string') {
      return { nodeId, mode: 'event', eventType: suspension.eventType, correlationKey: suspension.correlationKey };
    }
    if (suspension.type === 'subgraph') return { nodeId, mode: 'subgraph' };
  }
  return undefined;
}

function contextView(
  objects: readonly ContextObject[],
  relations: readonly ContextRelation[],
): WorkbenchContextView {
  const sourceRunIds = new Set<string>();
  for (const record of [...objects, ...relations]) {
    if (record.provenance.producedByRunId) sourceRunIds.add(record.provenance.producedByRunId);
  }
  return {
    sourceRunIds: [...sourceRunIds].sort(),
    objects: [...objects].sort((left, right) =>
      right.validFrom.localeCompare(left.validFrom)
      || left.id.localeCompare(right.id)
      || right.version - left.version),
    relations: [...relations].sort((left, right) =>
      right.validFrom.localeCompare(left.validFrom)
      || left.id.localeCompare(right.id)
      || right.version - left.version),
  };
}

export class WorkbenchService {
  private readonly store: WorkbenchWorkspaceStore;
  private readonly models: WorkbenchModelService;
  private readonly authorizeTool: ToolAuthorizer;
  private readonly actorOverride: ActorIdentity | undefined;
  private readonly contextStore: ContextGraphStore;
  private contextHydration: Promise<void> | undefined;

  constructor(options: {
    readonly dataFile?: string;
    readonly modelEnvironment?: NodeJS.ProcessEnv;
    readonly modelFetch?: typeof fetch;
    readonly toolPolicy?: ToolPolicy;
    readonly actor?: ActorIdentity;
    readonly contextStore?: ContextGraphStore;
  } = {}) {
    this.store = new WorkbenchWorkspaceStore(options.dataFile);
    if (options.dataFile) mkdirSync(dirname(options.dataFile), { recursive: true });
    this.contextStore = options.contextStore
      ?? (options.dataFile
        ? new SQLiteContextGraphStore(defaultContextFile(options.dataFile))
        : new InMemoryContextGraphStore());
    this.models = new WorkbenchModelService(options.modelEnvironment, options.modelFetch);
    this.authorizeTool = createPolicyToolAuthorizer(options.toolPolicy ?? defaultToolPolicy);
    this.actorOverride = options.actor ? actorIdentitySchema.parse(options.actor) : undefined;
    const workspace = this.store.snapshot();
    const installedPackIds = workspace.installedPackIds.filter((id) => bundledPackCatalog.has(id));
    const fallback = bundledPackCatalog.keys().next().value as string | undefined;
    if (installedPackIds.length === 0 && fallback) installedPackIds.push(fallback);
    const activePackId = installedPackIds.includes(workspace.activePackId)
      ? workspace.activePackId
      : installedPackIds[0];
    if (!activePackId) throw new Error('Workbench has no available Pack runtime.');
    if (
      activePackId !== workspace.activePackId
      || installedPackIds.length !== workspace.installedPackIds.length
    ) {
      this.store.update((state) => ({ ...state, installedPackIds, activePackId }));
    }
  }

  describePack(packId = this.store.snapshot().activePackId) {
    const runtime = requirePackRuntime(packId);
    const graph = runtime.manifest.graphs[0]!;
    const draft = this.store.snapshot().drafts[draftKey(packId, graph.id)];
    const selected = draft?.graph ?? graph;
    const fixture = runtime.manifest.fixtures.find((item) => item.graphId === selected.id)
      ?? runtime.manifest.fixtures[0];
    return {
      id: runtime.manifest.id,
      name: runtime.manifest.name,
      version: runtime.manifest.version,
      description: runtime.manifest.description,
      license: runtime.manifest.license,
      manifest: runtime.manifest,
      graph: selected,
      positions: draft?.positions ?? {},
      input: structuredClone(fixture?.input ?? {}),
      fixtures: runtime.manifest.fixtures,
      handlers: Object.keys(runtime.handlers).sort(),
    };
  }

  async describeWorkbench() {
    await this.ensureContextHydrated();
    const workspace = this.store.snapshot();
    const actor = this.currentActor(workspace);
    const catalog = [...bundledPackCatalog.values()].map((runtime) => {
      const { manifest } = runtime;
      return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        license: manifest.license,
        installed: workspace.installedPackIds.includes(manifest.id),
        executable: true,
        graphCount: manifest.graphs.length,
        objectTypeCount: manifest.ontology.objectTypes.length,
        roleCount: manifest.roles.length,
        toolCount: manifest.tools.length,
        executionMode: runtime.executionMode,
        trustSource: runtime.trustSource,
        ...(runtime.publisherKeyId ? { publisherKeyId: runtime.publisherKeyId } : {}),
      };
    });
    const runs = Object.values(workspace.runs)
      .map((session) => publicRun(session, actor))
      .sort((left, right) => right.events[0]!.timestamp.localeCompare(left.events[0]!.timestamp));
    return {
      activePackId: workspace.activePackId,
      installedPackIds: workspace.installedPackIds,
      catalog,
      activePack: this.describePack(workspace.activePackId),
      runs,
      context: contextView(
        await this.contextStore.listObjects(),
        await this.contextStore.listRelations(),
      ),
      actors: Object.values(workspace.actors).sort((left, right) => left.displayName.localeCompare(right.displayName)),
      actor,
      models: this.models.describe(workspace.modelProvider),
    };
  }

  configureModelProvider(selection: StoredModelProvider) {
    const validated = this.models.validate(selection);
    this.store.update((state) => ({ ...state, modelProvider: validated }));
    return this.describeWorkbench();
  }

  upsertActor(input: ActorIdentity) {
    this.requireWorkspaceOwner();
    const actor = actorIdentitySchema.parse(input);
    this.store.update((state) => {
      const actors = { ...state.actors, [actor.id]: actor };
      if (!Object.values(actors).some((item) => item.workspaceRole === 'owner')) {
        throw new Error('A workspace must retain at least one owner.');
      }
      return { ...state, actors };
    });
    return this.describeWorkbench();
  }

  activateActor(actorId: string) {
    const state = this.store.snapshot();
    if (!state.actors[actorId]) throw new Error(`Workspace actor "${actorId}" does not exist.`);
    this.store.update((current) => ({ ...current, currentActorId: actorId }));
    return this.describeWorkbench();
  }

  removeActor(actorId: string) {
    this.requireWorkspaceOwner();
    const state = this.store.snapshot();
    if (!state.actors[actorId]) return this.describeWorkbench();
    if (state.currentActorId === actorId) throw new Error('The current workspace actor cannot be removed.');
    const actors = { ...state.actors };
    delete actors[actorId];
    if (!Object.values(actors).some((actor) => actor.workspaceRole === 'owner')) {
      throw new Error('A workspace must retain at least one owner.');
    }
    this.store.update((current) => ({ ...current, actors }));
    return this.describeWorkbench();
  }

  testModelProvider() {
    return this.models.test(this.store.snapshot().modelProvider);
  }

  install(packId: string) {
    requirePackRuntime(packId);
    this.store.update((state) => ({
      ...state,
      installedPackIds: [...new Set([...state.installedPackIds, packId])],
      activePackId: packId,
    }));
    return this.describeWorkbench();
  }

  uninstall(packId: string) {
    const state = this.store.snapshot();
    if (!state.installedPackIds.includes(packId)) return this.describeWorkbench();
    if (state.installedPackIds.length === 1) throw new Error('At least one Pack must remain installed.');
    const installedPackIds = state.installedPackIds.filter((id) => id !== packId);
    this.store.update((current) => ({
      ...current,
      installedPackIds,
      activePackId: current.activePackId === packId ? installedPackIds[0]! : current.activePackId,
    }));
    return this.describeWorkbench();
  }

  activate(packId: string) {
    const state = this.store.snapshot();
    if (!state.installedPackIds.includes(packId)) throw new Error(`Install Pack "${packId}" before activating it.`);
    this.store.update((current) => ({ ...current, activePackId: packId }));
    return this.describeWorkbench();
  }

  validateGraph(packId: string, graph: GraphDefinition) {
    const parsed = graphDefinitionSchema.parse(graph);
    const runtime = requirePackRuntime(packId);
    const manifest = {
      ...runtime.manifest,
      graphs: runtime.manifest.graphs.some((item) => item.id === parsed.id)
        ? runtime.manifest.graphs.map((item) => item.id === parsed.id ? parsed : item)
        : [...runtime.manifest.graphs, parsed],
    };
    const compiled = compilePack(manifest).graphs.get(parsed.id);
    if (!compiled) throw new Error(`Graph "${parsed.id}" could not be compiled.`);
    const missingHandlers = parsed.nodes
      .filter((node) => node.handler && !runtime.handlers[node.handler])
      .map((node) => node.handler!);
    if (missingHandlers.length > 0) {
      throw new Error(`Unregistered handlers: ${[...new Set(missingHandlers)].join(', ')}.`);
    }
    return {
      valid: true,
      graphId: parsed.id,
      nodeCount: parsed.nodes.length,
      edgeCount: parsed.edges.length,
      entryNodeIds: [compiled.triggerNodeId],
    };
  }

  saveDraft(
    packId: string,
    graph: GraphDefinition,
    positions: Readonly<Record<string, GraphPosition>>,
  ) {
    this.validateGraph(packId, graph);
    const draft: StoredGraphDraft = { graph, positions, updatedAt: new Date().toISOString() };
    this.store.update((state) => ({
      ...state,
      drafts: { ...state.drafts, [draftKey(packId, graph.id)]: draft },
    }));
    return this.describePack(packId);
  }

  resetDraft(packId: string, graphId: string) {
    requirePackRuntime(packId);
    this.store.update((state) => {
      const drafts = { ...state.drafts };
      delete drafts[draftKey(packId, graphId)];
      return { ...state, drafts };
    });
    return this.describePack(packId);
  }

  async start(input: GraphState, options: StartRunOptions = {}): Promise<WorkbenchRunSnapshot> {
    const workspace = this.store.snapshot();
    const actor = this.currentActor(workspace);
    const packId = options.packId ?? workspace.activePackId;
    const runtime = requirePackRuntime(packId);
    const graphId = options.graphId ?? runtime.manifest.graphs[0]!.id;
    const draft = workspace.drafts[draftKey(packId, graphId)];
    const graph = options.graph ?? draft?.graph ?? runtime.manifest.graphs.find((item) => item.id === graphId);
    if (!graph) throw new Error(`Graph "${graphId}" does not exist in Pack "${packId}".`);
    this.validateGraph(packId, graph);
    const manifest = {
      ...runtime.manifest,
      graphs: runtime.manifest.graphs.map((item) => item.id === graph.id ? graph : item),
    };
    const workflow = compilePack(manifest).graphs.get(graph.id)!;
    const result = await new GraphRuntime(workflow, {
      handlers: runtime.handlers,
      agents: this.models.agents(workspace.modelProvider, graph),
      ...(runtime.tools ? { tools: runtime.tools } : {}),
      pack: manifest,
      authorizeTool: this.authorizeTool,
    }).run(input, { actor });
    const session = await this.toSession(packId, graph, result, []);
    this.saveSession(session);
    return publicRun(session, actor);
  }

  async decide(runId: string, approved: boolean): Promise<WorkbenchRunSnapshot> {
    const actor = this.currentActor();
    const existing = this.store.snapshot().runs[runId];
    if (!existing) throw new Error(`Run "${runId}" does not exist.`);
    if (!existing.checkpoint || existing.status !== 'paused') {
      throw new Error(`Run "${runId}" is not waiting for a decision.`);
    }
    const runtime = requirePackRuntime(existing.packId);
    const manifest = {
      ...runtime.manifest,
      graphs: runtime.manifest.graphs.map((item) => item.id === existing.graph.id ? existing.graph : item),
    };
    const workflow = compilePack(manifest).graphs.get(existing.graph.id)!;
    const approval = pendingApproval(existing, actor);
    if (!approval) throw new Error(`Run "${runId}" does not have a pending approval.`);
    if (!approval.actorAuthorized) {
      throw new Error(
        `Actor "${actor.id}" cannot resolve this approval; role "${approval.requiredRoleId}" is required.`,
      );
    }
    const result = await new GraphRuntime(workflow, {
      handlers: runtime.handlers,
      agents: this.models.agents(this.store.snapshot().modelProvider, existing.graph),
      ...(runtime.tools ? { tools: runtime.tools } : {}),
      pack: manifest,
      authorizeTool: this.authorizeTool,
    }).resume(existing.checkpoint, approval.kind === 'tool'
      ? {
          actor,
          historyEvents: existing.events,
          toolApprovals: { [approval.id]: approved },
        }
      : {
          actor,
          historyEvents: existing.events,
          decisions: { [approval.nodeId]: approved },
        });
    const session = await this.toSession(existing.packId, existing.graph, result, existing.events);
    this.saveSession(session);
    return publicRun(session, actor);
  }

  async resumeWaiting(runId: string, event?: ExternalEvent): Promise<WorkbenchRunSnapshot> {
    const actor = this.currentActor();
    const existing = this.store.snapshot().runs[runId];
    if (!existing) throw new Error(`Run "${runId}" does not exist.`);
    if (!existing.checkpoint || existing.status !== 'paused' || !pendingWait(existing)) {
      throw new Error(`Run "${runId}" is not waiting for a timer, event or subgraph.`);
    }
    const runtime = requirePackRuntime(existing.packId);
    const manifest = {
      ...runtime.manifest,
      graphs: runtime.manifest.graphs.map((item) => item.id === existing.graph.id ? existing.graph : item),
    };
    const workflow = compilePack(manifest).graphs.get(existing.graph.id)!;
    const result = await new GraphRuntime(workflow, {
      handlers: runtime.handlers,
      agents: this.models.agents(this.store.snapshot().modelProvider, existing.graph),
      ...(runtime.tools ? { tools: runtime.tools } : {}),
      pack: manifest,
      authorizeTool: this.authorizeTool,
    }).resume(existing.checkpoint, {
      actor,
      historyEvents: existing.events,
      ...(event ? { externalEvents: [externalEventSchema.parse(event)] } : {}),
    });
    const session = await this.toSession(existing.packId, existing.graph, result, existing.events);
    this.saveSession(session);
    return publicRun(session, actor);
  }

  async triggerWebhook(
    packId: string,
    graphId: string,
    method: 'POST' | 'PUT' | 'PATCH',
    input: unknown,
    invocationId?: string,
  ): Promise<WorkbenchRunSnapshot> {
    const runtime = requirePackRuntime(packId);
    const compiled = compilePack(runtime.manifest);
    const graph = compiled.graphs.get(graphId);
    const trigger = graph?.definition.trigger;
    if (!graph || !trigger || trigger.type !== 'webhook') {
      throw new Error(`Graph "${graphId}" does not declare a webhook trigger.`);
    }
    const runId = invocationId ? webhookTriggeredRunId(packId, graphId, invocationId) : undefined;
    const existing = runId ? this.store.snapshot().runs[runId] : undefined;
    if (existing) return publicRun(existing, this.currentActor());
    const triggered = await new GraphTriggerDispatcher(compiled, {
      handlers: runtime.handlers,
      agents: this.models.agents(this.store.snapshot().modelProvider, graph.definition),
      ...(runtime.tools ? { tools: runtime.tools } : {}),
      authorizeTool: this.authorizeTool,
    }).dispatchWebhook({ method, path: trigger.path, body: input }, {
      actor: this.currentActor(),
      ...(runId ? { runId } : {}),
    });
    const session = await this.toSession(packId, graph.definition, triggered.result, []);
    this.saveSession(session);
    return publicRun(session, this.currentActor());
  }

  async triggerWebhookPath(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    input: unknown,
    invocationId?: string,
  ): Promise<WorkbenchRunSnapshot> {
    const matches = this.store.snapshot().installedPackIds.flatMap((packId) => {
      const runtime = requirePackRuntime(packId);
      return runtime.manifest.graphs.flatMap((graph) =>
        graph.trigger?.type === 'webhook'
        && graph.trigger.method === method
        && graph.trigger.path === path
          ? [{ packId, graphId: graph.id }]
          : []);
    });
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `No installed webhook trigger matches ${method} ${path}.`
        : `Installed webhook trigger ${method} ${path} is ambiguous.`);
    }
    return this.triggerWebhook(matches[0]!.packId, matches[0]!.graphId, method, input, invocationId);
  }

  async triggerSchedule(packId: string, graphId: string, occurrence: ScheduleOccurrence): Promise<WorkbenchRunSnapshot> {
    const runtime = requirePackRuntime(packId);
    const compiled = compilePack(runtime.manifest);
    const graph = compiled.graphs.get(graphId);
    if (!graph) throw new Error(`Graph "${graphId}" does not exist in Pack "${packId}".`);
    const runId = scheduleTriggeredRunId(packId, graphId, occurrence.id);
    const existing = this.store.snapshot().runs[runId];
    if (existing) return publicRun(existing, this.currentActor());
    const triggered = await new GraphTriggerDispatcher(compiled, {
      handlers: runtime.handlers,
      agents: this.models.agents(this.store.snapshot().modelProvider, graph.definition),
      ...(runtime.tools ? { tools: runtime.tools } : {}),
      authorizeTool: this.authorizeTool,
    }).dispatchSchedule(graphId, occurrence, { actor: this.currentActor(), runId });
    const session = await this.toSession(packId, graph.definition, triggered.result, []);
    this.saveSession(session);
    return publicRun(session, this.currentActor());
  }

  async publishEvent(input: ExternalEvent): Promise<{
    readonly event: ExternalEvent;
    readonly resumed: readonly WorkbenchRunSnapshot[];
    readonly started: readonly WorkbenchRunSnapshot[];
  }> {
    const event = externalEventSchema.parse(input);
    const waitingRunIds = Object.values(this.store.snapshot().runs)
      .filter((session) => {
        const wait = pendingWait(session);
        return wait?.mode === 'event'
          && wait.eventType === event.type
          && wait.correlationKey === event.correlationKey;
      })
      .map((session) => session.runId);
    const resumed: WorkbenchRunSnapshot[] = [];
    for (const runId of waitingRunIds) resumed.push(await this.resumeWaiting(runId, event));

    const started: WorkbenchRunSnapshot[] = [];
    for (const packId of this.store.snapshot().installedPackIds) {
      const runtime = requirePackRuntime(packId);
      const compiled = compilePack(runtime.manifest);
      const matchingGraphs = [...compiled.graphs.values()].filter((graph) =>
        graph.definition.trigger?.type === 'event'
        && graph.definition.trigger.eventType === event.type);
      for (const graph of matchingGraphs) {
        const runId = eventTriggeredRunId(packId, graph.definition.id, event.id);
        if (this.store.snapshot().runs[runId]) continue;
        const triggered = await new GraphTriggerDispatcher({
          manifest: compiled.manifest,
          graphs: new Map([[graph.definition.id, graph]]),
        }, {
          handlers: runtime.handlers,
          agents: this.models.agents(this.store.snapshot().modelProvider, graph.definition),
          ...(runtime.tools ? { tools: runtime.tools } : {}),
          authorizeTool: this.authorizeTool,
        }).dispatchEvent(event, { actor: this.currentActor(), runId });
        const item = triggered[0]!;
        const session = await this.toSession(packId, graph.definition, item.result, []);
        this.saveSession(session);
        started.push(publicRun(session, this.currentActor()));
      }
    }
    return { event, resumed, started };
  }

  get(runId: string): WorkbenchRunSnapshot | undefined {
    const session = this.store.snapshot().runs[runId];
    return session ? publicRun(session, this.currentActor()) : undefined;
  }

  listRuns(): readonly WorkbenchRunSnapshot[] {
    const actor = this.currentActor();
    return Object.values(this.store.snapshot().runs).map((session) => publicRun(session, actor));
  }

  exportAudit(runId: string) {
    const session = this.store.snapshot().runs[runId];
    if (!session) throw new Error(`Run "${runId}" does not exist.`);
    return createRunAuditBundle({
      run: {
        runId: session.runId,
        packId: session.packId,
        graphId: session.graph.id,
        graphVersion: session.graph.version,
        status: session.status,
        state: session.state,
        ...(session.events[0] ? { startedAt: session.events[0].timestamp } : {}),
        ...(session.events.at(-1) ? { updatedAt: session.events.at(-1)!.timestamp } : {}),
        ...(session.error ? { error: session.error } : {}),
      },
      events: session.events,
      ...(session.checkpoint ? { checkpoint: session.checkpoint } : {}),
      ...(session.artifacts ? { artifacts: session.artifacts } : {}),
      ...(session.context ? { context: session.context } : {}),
    });
  }

  private async toSession(
    packId: string,
    graph: GraphDefinition,
    result: Awaited<ReturnType<GraphRuntime['run']>>,
    previousEvents: readonly GraphEvent[],
  ): Promise<StoredRunSession> {
    const runtime = requirePackRuntime(packId);
    const events = [...previousEvents, ...result.events];
    let context: WorkbenchContextSnapshot | undefined;
    const generatedArtifacts = result.status === 'completed' ? result.artifacts ?? [] : [];
    const hasDeliverable = runtime.manifest.deliverables.some(
      (deliverable) => result.state[deliverable.stateField] !== undefined,
    );
    if (result.status === 'completed' && hasDeliverable && runtime.projector) {
      const store = new InMemoryContextGraphStore(runtime.manifest);
      await runtime.projector(store, { ...result, events });
      context = {
        objects: await store.listObjects(),
        relations: await store.listRelations(),
      };
      await this.ensureContextHydrated();
      await this.appendContext(context);
    }
    return {
      runId: result.runId,
      packId,
      graph,
      status: result.status,
      state: result.state,
      events,
      ...(result.status === 'failed' ? { error: result.error.message } : {}),
      ...('checkpoint' in result ? { checkpoint: result.checkpoint } : {}),
      ...(generatedArtifacts.length > 0 ? { artifacts: generatedArtifacts } : {}),
      ...(context ? { context } : {}),
    };
  }

  private saveSession(session: StoredRunSession): void {
    this.store.update((state) => ({
      ...state,
      runs: { ...state.runs, [session.runId]: session },
    }));
  }

  async close(): Promise<void> {
    await this.contextStore.close?.();
  }

  private ensureContextHydrated(): Promise<void> {
    this.contextHydration ??= this.hydrateContext();
    return this.contextHydration;
  }

  private async hydrateContext(): Promise<void> {
    const contexts = Object.values(this.store.snapshot().runs)
      .filter((session): session is StoredRunSession & { context: WorkbenchContextSnapshot } => Boolean(session.context))
      .sort((left, right) => left.runId.localeCompare(right.runId))
      .map((session) => session.context);
    await this.appendContext({
      objects: contexts.flatMap((context) => context.objects),
      relations: contexts.flatMap((context) => context.relations),
    });
  }

  private async appendContext(context: WorkbenchContextSnapshot): Promise<void> {
    const storedObjects = new Map((await this.contextStore.listObjects())
      .map((object) => [`${object.id}\u0000${object.version}`, object]));
    const storedRelations = new Map((await this.contextStore.listRelations())
      .map((relation) => [`${relation.id}\u0000${relation.version}`, relation]));

    for (const object of [...context.objects].sort((left, right) =>
      left.id.localeCompare(right.id) || left.version - right.version)) {
      const key = `${object.id}\u0000${object.version}`;
      const stored = storedObjects.get(key);
      if (stored) {
        if (sha256Json(stored) !== sha256Json(object)) {
          throw new Error(`Context authority conflict for object "${object.id}" version ${object.version}.`);
        }
        continue;
      }
      await this.contextStore.appendObject(object);
      storedObjects.set(key, object);
    }

    for (const relation of [...context.relations].sort((left, right) =>
      left.id.localeCompare(right.id) || left.version - right.version)) {
      const key = `${relation.id}\u0000${relation.version}`;
      const stored = storedRelations.get(key);
      if (stored) {
        if (sha256Json(stored) !== sha256Json(relation)) {
          throw new Error(`Context authority conflict for relation "${relation.id}" version ${relation.version}.`);
        }
        continue;
      }
      await this.contextStore.appendRelation(relation);
      storedRelations.set(key, relation);
    }
  }

  private currentActor(workspace = this.store.snapshot()): ActorIdentity {
    const actor = this.actorOverride ?? workspace.actors[workspace.currentActorId];
    if (!actor) throw new Error('Workspace current actor is unavailable.');
    return actor;
  }

  private requireWorkspaceOwner(): ActorIdentity {
    const actor = this.currentActor();
    if (actor.workspaceRole !== 'owner') throw new Error('Workspace owner permission is required.');
    return actor;
  }
}
