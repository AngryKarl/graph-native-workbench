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
  ActorIdentity,
  ContextObject,
  ContextRelation,
  GraphCheckpoint,
  GraphDefinition,
  GraphEvent,
  PortableArtifact,
} from '@graph-workbench/contracts';
import { actorIdentitySchema } from '@graph-workbench/contracts';
import type { GraphState } from '@graph-workbench/core';

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
  readonly artifacts?: readonly PortableArtifact[];
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

/**
 * Workspace metadata only. Run sessions moved to their own store in
 * formatVersion 4 so recording a run no longer rewrites the whole document.
 */
export interface WorkbenchWorkspaceState {
  readonly formatVersion: 4;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly installedPackIds: readonly string[];
  readonly activePackId: string;
  readonly drafts: Readonly<Record<string, StoredGraphDraft>>;
  readonly actors: Readonly<Record<string, ActorIdentity>>;
  readonly currentActorId: string;
  readonly modelProvider?: StoredModelProvider;
}

export interface WorkspaceMigrationResult {
  readonly state: WorkbenchWorkspaceState;
  readonly migratedFrom?: 1 | 2 | 3;
  /** Sessions found in a pre-v4 document, to be handed to the run store once. */
  readonly legacyRuns?: Readonly<Record<string, StoredRunSession>>;
}

const localOwner = actorIdentitySchema.parse({
  id: 'local.user',
  kind: 'human',
  displayName: 'Local user',
  workspaceRole: 'owner',
  roleIds: [],
});

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
  const modelProvider = root.modelProvider === undefined
    ? undefined
    : object(root.modelProvider, 'Workspace modelProvider') as unknown as StoredModelProvider;
  return {
    installedPackIds: root.installedPackIds as string[],
    activePackId: root.activePackId,
    drafts,
    ...(modelProvider ? { modelProvider } : {}),
  };
}

/** Sessions carried by a pre-v4 document; absent once the move has happened. */
function legacyRuns(root: Record<string, unknown>): Readonly<Record<string, StoredRunSession>> {
  return object(root.runs, 'Workspace runs') as Readonly<Record<string, StoredRunSession>>;
}

function identityFields(root: Record<string, unknown>) {
  const actorRoot = object(root.actors, 'Workspace actors');
  const actors = Object.fromEntries(Object.entries(actorRoot).map(([id, value]) => {
    const actor = actorIdentitySchema.parse(value);
    if (actor.id !== id) throw new Error(`Workspace actor key "${id}" must match actor id "${actor.id}".`);
    return [id, actor];
  }));
  if (Object.keys(actors).length === 0) throw new Error('Workspace must contain at least one actor.');
  if (typeof root.currentActorId !== 'string' || !actors[root.currentActorId]) {
    throw new Error('Workspace currentActorId must reference a declared actor.');
  }
  return { actors, currentActorId: root.currentActorId };
}

export function migrateWorkbenchWorkspace(
  input: unknown,
  options: { readonly now?: Date; readonly workspaceId?: string } = {},
): WorkspaceMigrationResult {
  const root = object(input, 'Workspace data');
  if (root.formatVersion === 4) {
    if (typeof root.workspaceId !== 'string' || !root.workspaceId) throw new Error('Workspace id is missing.');
    if (typeof root.createdAt !== 'string' || !Number.isFinite(Date.parse(root.createdAt))) {
      throw new Error('Workspace createdAt must be an ISO timestamp.');
    }
    if (typeof root.updatedAt !== 'string' || !Number.isFinite(Date.parse(root.updatedAt))) {
      throw new Error('Workspace updatedAt must be an ISO timestamp.');
    }
    return {
      state: {
        formatVersion: 4,
        workspaceId: root.workspaceId,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        ...workspaceFields(root),
        ...identityFields(root),
      },
    };
  }
  if (root.formatVersion === 3) {
    if (typeof root.workspaceId !== 'string' || !root.workspaceId) throw new Error('Workspace id is missing.');
    if (typeof root.createdAt !== 'string' || !Number.isFinite(Date.parse(root.createdAt))) {
      throw new Error('Workspace createdAt must be an ISO timestamp.');
    }
    if (typeof root.updatedAt !== 'string' || !Number.isFinite(Date.parse(root.updatedAt))) {
      throw new Error('Workspace updatedAt must be an ISO timestamp.');
    }
    return {
      migratedFrom: 3,
      legacyRuns: legacyRuns(root),
      state: {
        formatVersion: 4,
        workspaceId: root.workspaceId,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        ...workspaceFields(root),
        ...identityFields(root),
      },
    };
  }
  if (root.formatVersion === 2) {
    if (typeof root.workspaceId !== 'string' || !root.workspaceId) throw new Error('Workspace id is missing.');
    if (typeof root.createdAt !== 'string' || !Number.isFinite(Date.parse(root.createdAt))) {
      throw new Error('Workspace createdAt must be an ISO timestamp.');
    }
    if (typeof root.updatedAt !== 'string' || !Number.isFinite(Date.parse(root.updatedAt))) {
      throw new Error('Workspace updatedAt must be an ISO timestamp.');
    }
    return {
      migratedFrom: 2,
      legacyRuns: legacyRuns(root),
      state: {
        formatVersion: 4,
        workspaceId: root.workspaceId,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        ...workspaceFields(root),
        actors: { [localOwner.id]: localOwner },
        currentActorId: localOwner.id,
      },
    };
  }
  if (root.version !== 1) {
    throw new Error('Unsupported workspace data format. This Graph Workbench release can migrate version 1/2/3 or open formatVersion 4.');
  }
  const now = (options.now ?? new Date()).toISOString();
  return {
    migratedFrom: 1,
    legacyRuns: legacyRuns(root),
    state: {
      formatVersion: 4,
      workspaceId: options.workspaceId ?? `workspace-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      ...workspaceFields(root),
      actors: { [localOwner.id]: localOwner },
      currentActorId: localOwner.id,
    },
  };
}

function initialState(): WorkbenchWorkspaceState {
  const now = new Date().toISOString();
  return {
    formatVersion: 4,
    workspaceId: `workspace-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    installedPackIds: ['software_delivery', 'architecture'],
    activePackId: 'software_delivery',
    drafts: {},
    actors: { [localOwner.id]: localOwner },
    currentActorId: localOwner.id,
  };
}

export class WorkbenchWorkspaceStore {
  private state: WorkbenchWorkspaceState;
  private pendingLegacyRuns: Readonly<Record<string, StoredRunSession>>;

  constructor(private readonly dataFile?: string) {
    const loaded = this.load();
    this.state = loaded.state;
    this.pendingLegacyRuns = loaded.legacyRuns ?? {};
    if (loaded.migratedFrom) {
      if (!this.dataFile) throw new Error('Persistent workspace migration requires a data file.');
      const backup = `${this.dataFile}.v${loaded.migratedFrom}.backup`;
      if (!existsSync(backup)) copyFileSync(this.dataFile, backup);
      this.persist();
    }
  }

  /**
   * Sessions read out of a pre-v4 document, returned once so the caller can
   * move them into the run store. The backup written during migration is the
   * recovery path if that move fails.
   */
  takeLegacyRuns(): Readonly<Record<string, StoredRunSession>> {
    const runs = this.pendingLegacyRuns;
    this.pendingLegacyRuns = {};
    return runs;
  }

  snapshot(): WorkbenchWorkspaceState {
    return structuredClone(this.state);
  }

  update(mutator: (state: WorkbenchWorkspaceState) => WorkbenchWorkspaceState): WorkbenchWorkspaceState {
    this.state = {
      ...mutator(this.snapshot()),
      formatVersion: 4,
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
