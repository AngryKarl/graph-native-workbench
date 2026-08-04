import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ContextObject,
  ContextRelation,
  GraphCheckpoint,
  GraphDefinition,
  GraphEvent,
} from '@graph-native/contracts';
import type { GraphState } from '@graph-native/core';

export interface StoredGraphDraft {
  readonly graph: GraphDefinition;
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly updatedAt: string;
}

export interface StoredRunSession {
  readonly runId: string;
  readonly packId: string;
  readonly graph: GraphDefinition;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly state: GraphState;
  readonly events: readonly GraphEvent[];
  readonly checkpoint?: GraphCheckpoint;
  readonly error?: string;
  readonly context?: {
    readonly objects: readonly ContextObject[];
    readonly relations: readonly ContextRelation[];
  };
}

export interface WorkbenchWorkspaceState {
  readonly version: 1;
  readonly installedPackIds: readonly string[];
  readonly activePackId: string;
  readonly drafts: Readonly<Record<string, StoredGraphDraft>>;
  readonly runs: Readonly<Record<string, StoredRunSession>>;
}

function initialState(): WorkbenchWorkspaceState {
  return {
    version: 1,
    installedPackIds: ['architecture'],
    activePackId: 'architecture',
    drafts: {},
    runs: {},
  };
}

export class WorkbenchWorkspaceStore {
  private state: WorkbenchWorkspaceState;

  constructor(private readonly dataFile?: string) {
    this.state = this.load();
  }

  snapshot(): WorkbenchWorkspaceState {
    return structuredClone(this.state);
  }

  update(mutator: (state: WorkbenchWorkspaceState) => WorkbenchWorkspaceState): WorkbenchWorkspaceState {
    this.state = mutator(this.snapshot());
    this.persist();
    return this.snapshot();
  }

  private load(): WorkbenchWorkspaceState {
    if (!this.dataFile) return initialState();
    try {
      const parsed = JSON.parse(readFileSync(this.dataFile, 'utf8')) as WorkbenchWorkspaceState;
      if (parsed.version !== 1) throw new Error('Unsupported workspace data version.');
      return parsed;
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      if (missing) return initialState();
      throw error;
    }
  }

  private persist(): void {
    if (!this.dataFile) return;
    mkdirSync(dirname(this.dataFile), { recursive: true });
    const temporary = `${this.dataFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.dataFile);
  }
}
