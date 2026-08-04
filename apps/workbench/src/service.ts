import type {
  ContextObject,
  ContextRelation,
  GraphDefinition,
  GraphEvent,
} from '@graph-native/contracts';
import { graphDefinitionSchema } from '@graph-native/contracts';
import {
  compilePack,
  GraphRuntime,
  InMemoryContextGraphStore,
  type GraphState,
} from '@graph-native/core';
import { bundledPackCatalog, requirePackRuntime } from './catalog.js';
import {
  WorkbenchWorkspaceStore,
  type StoredGraphDraft,
  type StoredRunSession,
} from './workspace-store.js';

export interface WorkbenchContextSnapshot {
  readonly objects: readonly ContextObject[];
  readonly relations: readonly ContextRelation[];
}

export interface WorkbenchRunSnapshot {
  readonly runId: string;
  readonly packId: string;
  readonly graphId: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly state: GraphState;
  readonly events: readonly GraphEvent[];
  readonly error?: string;
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

function publicRun(session: StoredRunSession): WorkbenchRunSnapshot {
  return {
    runId: session.runId,
    packId: session.packId,
    graphId: session.graph.id,
    status: session.status,
    state: session.state,
    events: session.events,
    ...(session.error ? { error: session.error } : {}),
    ...(session.context ? { context: session.context } : {}),
  };
}

export class WorkbenchService {
  private readonly store: WorkbenchWorkspaceStore;

  constructor(options: { readonly dataFile?: string } = {}) {
    this.store = new WorkbenchWorkspaceStore(options.dataFile);
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

  describeWorkbench() {
    const workspace = this.store.snapshot();
    const catalog = [...bundledPackCatalog.values()].map(({ manifest }) => ({
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
    }));
    const runs = Object.values(workspace.runs)
      .map(publicRun)
      .sort((left, right) => right.events[0]!.timestamp.localeCompare(left.events[0]!.timestamp));
    return {
      activePackId: workspace.activePackId,
      installedPackIds: workspace.installedPackIds,
      catalog,
      activePack: this.describePack(workspace.activePackId),
      runs,
    };
  }

  install(packId: string) {
    requirePackRuntime(packId);
    this.store.update((state) => ({
      ...state,
      installedPackIds: [...new Set([...state.installedPackIds, packId])],
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
      pack: manifest,
    }).run(input);
    const session = await this.toSession(packId, graph, result, []);
    this.saveSession(session);
    return publicRun(session);
  }

  async decide(runId: string, approved: boolean): Promise<WorkbenchRunSnapshot> {
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
    const result = await new GraphRuntime(workflow, {
      handlers: runtime.handlers,
      pack: manifest,
    }).resume(existing.checkpoint, { decisions: { approval: approved } });
    const session = await this.toSession(existing.packId, existing.graph, result, existing.events);
    this.saveSession(session);
    return publicRun(session);
  }

  get(runId: string): WorkbenchRunSnapshot | undefined {
    const session = this.store.snapshot().runs[runId];
    return session ? publicRun(session) : undefined;
  }

  listRuns(): readonly WorkbenchRunSnapshot[] {
    return Object.values(this.store.snapshot().runs).map(publicRun);
  }

  private async toSession(
    packId: string,
    graph: GraphDefinition,
    result: Awaited<ReturnType<GraphRuntime['run']>>,
    previousEvents: readonly GraphEvent[],
  ): Promise<StoredRunSession> {
    const runtime = requirePackRuntime(packId);
    let context: WorkbenchContextSnapshot | undefined;
    const hasDeliverable = runtime.manifest.deliverables.some(
      (deliverable) => result.state[deliverable.stateField] !== undefined,
    );
    if (result.status === 'completed' && hasDeliverable && runtime.projector) {
      const store = new InMemoryContextGraphStore(runtime.manifest);
      await runtime.projector(store, result);
      context = {
        objects: await store.listObjects(),
        relations: await store.listRelations(),
      };
    }
    return {
      runId: result.runId,
      packId,
      graph,
      status: result.status,
      state: result.state,
      events: [...previousEvents, ...result.events],
      ...(result.status === 'failed' ? { error: result.error.message } : {}),
      ...('checkpoint' in result ? { checkpoint: result.checkpoint } : {}),
      ...(context ? { context } : {}),
    };
  }

  private saveSession(session: StoredRunSession): void {
    this.store.update((state) => ({
      ...state,
      runs: { ...state.runs, [session.runId]: session },
    }));
  }
}
