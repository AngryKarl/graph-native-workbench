import type {
  ContextObject,
  ContextRelation,
  GraphCheckpoint,
  GraphEvent,
} from '@graph-native/contracts';
import {
  architectureHandlers,
  architecturePack,
  projectArchitectureRun,
} from '@graph-native/pack-architecture';
import {
  compilePack,
  GraphRuntime,
  InMemoryContextGraphStore,
  type GraphState,
} from '@graph-native/core';

export interface WorkbenchContextSnapshot {
  readonly objects: readonly ContextObject[];
  readonly relations: readonly ContextRelation[];
}

export interface WorkbenchRunSnapshot {
  readonly runId: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly state: GraphState;
  readonly events: readonly GraphEvent[];
  readonly error?: string;
  readonly context?: WorkbenchContextSnapshot;
}

interface Session extends WorkbenchRunSnapshot {
  checkpoint?: GraphCheckpoint;
}

const compiledPack = compilePack(architecturePack);
const workflow = compiledPack.graphs.get('architecture.concept_workflow')!;
if (!workflow) throw new Error('Architecture workflow is unavailable.');

export class WorkbenchService {
  private readonly sessions = new Map<string, Session>();

  describePack() {
    const fixture = architecturePack.fixtures[0];
    return {
      id: architecturePack.id,
      name: architecturePack.name,
      version: architecturePack.version,
      graph: {
        id: workflow.definition.id,
        nodes: workflow.definition.nodes.map(({ id, kind, label, description }) => ({
          id,
          kind,
          label,
          description,
        })),
        edges: workflow.definition.edges.map(({ id, source, target }) => ({ id, source, target })),
      },
      input: structuredClone(fixture?.input ?? {}),
    };
  }

  async start(input: GraphState): Promise<WorkbenchRunSnapshot> {
    const result = await new GraphRuntime(workflow, {
      handlers: architectureHandlers,
      pack: architecturePack,
    }).run(input);
    const session = await this.toSession(result, []);
    this.sessions.set(session.runId, session);
    return this.publicSnapshot(session);
  }

  async decide(runId: string, approved: boolean): Promise<WorkbenchRunSnapshot> {
    const existing = this.sessions.get(runId);
    if (!existing) throw new Error(`Run "${runId}" does not exist.`);
    if (!existing.checkpoint || existing.status !== 'paused') {
      throw new Error(`Run "${runId}" is not waiting for a decision.`);
    }
    const result = await new GraphRuntime(workflow, {
      handlers: architectureHandlers,
      pack: architecturePack,
    }).resume(existing.checkpoint, { decisions: { approval: approved } });
    const session = await this.toSession(result, existing.events);
    this.sessions.set(runId, session);
    return this.publicSnapshot(session);
  }

  get(runId: string): WorkbenchRunSnapshot | undefined {
    const session = this.sessions.get(runId);
    return session ? this.publicSnapshot(session) : undefined;
  }

  private async toSession(
    result: Awaited<ReturnType<GraphRuntime['run']>>,
    previousEvents: readonly GraphEvent[],
  ): Promise<Session> {
    let context: WorkbenchContextSnapshot | undefined;
    if (result.status === 'completed' && result.state.approved === true) {
      const store = new InMemoryContextGraphStore(architecturePack);
      await projectArchitectureRun(store, result);
      context = {
        objects: await store.listObjects(),
        relations: await store.listRelations(),
      };
    }
    return {
      runId: result.runId,
      status: result.status,
      state: result.state,
      events: [...previousEvents, ...result.events],
      ...(result.status === 'failed' ? { error: result.error.message } : {}),
      ...('checkpoint' in result ? { checkpoint: result.checkpoint } : {}),
      ...(context ? { context } : {}),
    };
  }

  private publicSnapshot(session: Session): WorkbenchRunSnapshot {
    const { checkpoint: _checkpoint, ...snapshot } = session;
    return structuredClone(snapshot);
  }
}
