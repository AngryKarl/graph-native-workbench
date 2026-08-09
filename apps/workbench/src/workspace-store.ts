import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type {
  ContextObject,
  ContextRelation,
  GraphCheckpoint,
  GraphDefinition,
  GraphEvent,
} from '@graphwork/contracts';
import type { GraphState } from '@graphwork/core';

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

export interface StoredModelProvider {
  readonly providerId: string;
  readonly model: string;
  readonly baseUrl?: string;
}

export interface WorkbenchWorkspaceState {
  readonly formatVersion: 2;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly installedPackIds: readonly string[];
  readonly activePackId: string;
  readonly drafts: Readonly<Record<string, StoredGraphDraft>>;
  readonly runs: Readonly<Record<string, StoredRunSession>>;
  readonly modelProvider?: StoredModelProvider;
}

export interface WorkspaceMigrationResult {
  readonly state: WorkbenchWorkspaceState;
  readonly migratedFrom?: 1;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function workspaceFields(root: Record<string, unknown>) {
  if (!Array.isArray(root.installedPackIds) || root.installedPackIds.some((id) => typeof id !== 'string')) {
    throw new Error('Workspace installedPackIds must be an array of Pack ids.');
  }
  if (typeof root.activePackId !== 'string') throw new Error('Workspace activePackId must be a Pack id.');
  const drafts = object(root.drafts, 'Workspace drafts') as WorkbenchWorkspaceState['drafts'];
  const runs = object(root.runs, 'Workspace runs') as WorkbenchWorkspaceState['runs'];
  const modelProvider = root.modelProvider === undefined
    ? undefined
    : object(root.modelProvider, 'Workspace modelProvider') as unknown as StoredModelProvider;
  return {
    installedPackIds: root.installedPackIds as string[],
    activePackId: root.activePackId,
    drafts,
    runs,
    ...(modelProvider ? { modelProvider } : {}),
  };
}

export function migrateWorkbenchWorkspace(
  input: unknown,
  options: { readonly now?: Date; readonly workspaceId?: string } = {},
): WorkspaceMigrationResult {
  const root = object(input, 'Workspace data');
  if (root.formatVersion === 2) {
    if (typeof root.workspaceId !== 'string' || !root.workspaceId) throw new Error('Workspace id is missing.');
    if (typeof root.createdAt !== 'string' || !Number.isFinite(Date.parse(root.createdAt))) {
      throw new Error('Workspace createdAt must be an ISO timestamp.');
    }
    if (typeof root.updatedAt !== 'string' || !Number.isFinite(Date.parse(root.updatedAt))) {
      throw new Error('Workspace updatedAt must be an ISO timestamp.');
    }
    return {
      state: {
        formatVersion: 2,
        workspaceId: root.workspaceId,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        ...workspaceFields(root),
      },
    };
  }
  if (root.version !== 1) {
    throw new Error('Unsupported workspace data format. This Graphwork release can migrate version 1 or open formatVersion 2.');
  }
  const now = (options.now ?? new Date()).toISOString();
  return {
    migratedFrom: 1,
    state: {
      formatVersion: 2,
      workspaceId: options.workspaceId ?? `workspace-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      ...workspaceFields(root),
    },
  };
}

function initialState(): WorkbenchWorkspaceState {
  const now = new Date().toISOString();
  return {
    formatVersion: 2,
    workspaceId: `workspace-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    installedPackIds: ['architecture'],
    activePackId: 'architecture',
    drafts: {},
    runs: {},
  };
}

export class WorkbenchWorkspaceStore {
  private state: WorkbenchWorkspaceState;

  constructor(private readonly dataFile?: string) {
    const loaded = this.load();
    this.state = loaded.state;
    if (loaded.migratedFrom) {
      if (!this.dataFile) throw new Error('Persistent workspace migration requires a data file.');
      const backup = `${this.dataFile}.v${loaded.migratedFrom}.backup`;
      if (!existsSync(backup)) copyFileSync(this.dataFile, backup);
      this.persist();
    }
  }

  snapshot(): WorkbenchWorkspaceState {
    return structuredClone(this.state);
  }

  update(mutator: (state: WorkbenchWorkspaceState) => WorkbenchWorkspaceState): WorkbenchWorkspaceState {
    this.state = {
      ...mutator(this.snapshot()),
      formatVersion: 2,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.snapshot();
  }

  private load(): WorkspaceMigrationResult {
    if (!this.dataFile) return { state: initialState() };
    try {
      return migrateWorkbenchWorkspace(JSON.parse(readFileSync(this.dataFile, 'utf8')) as unknown);
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      if (missing) return { state: initialState() };
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
