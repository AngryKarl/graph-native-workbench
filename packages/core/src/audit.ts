import {
  contextObjectSchema,
  contextRelationSchema,
  graphCheckpointSchema,
  graphEventSchema,
  graphRunStatusSchema,
  type ContextObject,
  type ContextRelation,
  type GraphCheckpoint,
  type GraphEvent,
  type GraphRunStatus,
} from '@graph-native/contracts';
import type { GraphState } from './state.js';
import { sha256Json } from './integrity.js';

export interface AuditRunSnapshot {
  readonly runId: string;
  readonly packId?: string;
  readonly graphId: string;
  readonly graphVersion: number;
  readonly status: GraphRunStatus;
  readonly state: GraphState;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly error?: string | null;
}

export interface RunAuditSource {
  readonly run: AuditRunSnapshot;
  readonly events: readonly GraphEvent[];
  readonly checkpoint?: GraphCheckpoint;
  readonly context?: {
    readonly objects: readonly ContextObject[];
    readonly relations: readonly ContextRelation[];
  };
}

export interface RunAuditBundle extends RunAuditSource {
  readonly formatVersion: 1;
  readonly exportedAt: string;
  readonly integrity: {
    readonly algorithm: 'sha256';
    readonly digest: string;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function validateSource(source: RunAuditSource): RunAuditSource {
  const run = source.run;
  if (!run.runId || !run.graphId || !Number.isInteger(run.graphVersion) || run.graphVersion < 1) {
    throw new Error('Audit run identity is invalid.');
  }
  graphRunStatusSchema.parse(run.status);
  if (!run.state || typeof run.state !== 'object' || Array.isArray(run.state)) {
    throw new Error('Audit run state must be an object.');
  }
  const events = source.events.map((event) => graphEventSchema.parse(event));
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.runId !== run.runId) throw new Error('Audit event run identity does not match the run.');
    if (index > 0 && event.seq <= events[index - 1]!.seq) {
      throw new Error('Audit events must be ordered by strictly increasing sequence.');
    }
  }
  const checkpoint = source.checkpoint ? graphCheckpointSchema.parse(source.checkpoint) : undefined;
  if (checkpoint && checkpoint.runId !== run.runId) throw new Error('Audit checkpoint run identity does not match the run.');
  const context = source.context ? {
    objects: source.context.objects.map((item) => contextObjectSchema.parse(item)),
    relations: source.context.relations.map((item) => contextRelationSchema.parse(item)),
  } : undefined;
  return {
    run: structuredClone(run),
    events,
    ...(checkpoint ? { checkpoint } : {}),
    ...(context ? { context } : {}),
  };
}

export function createRunAuditBundle(
  source: RunAuditSource,
  exportedAt = new Date(),
): RunAuditBundle {
  const validated = validateSource(source);
  const payload = {
    formatVersion: 1 as const,
    exportedAt: exportedAt.toISOString(),
    ...validated,
  };
  return {
    ...payload,
    integrity: { algorithm: 'sha256', digest: sha256Json(payload) },
  };
}

export function verifyRunAuditBundle(input: unknown): RunAuditBundle {
  const root = record(input, 'Audit bundle');
  if (root.formatVersion !== 1) throw new Error('Audit bundle formatVersion must be 1.');
  if (typeof root.exportedAt !== 'string' || !Number.isFinite(Date.parse(root.exportedAt))) {
    throw new Error('Audit bundle exportedAt must be an ISO timestamp.');
  }
  const integrity = record(root.integrity, 'Audit bundle integrity');
  if (integrity.algorithm !== 'sha256' || typeof integrity.digest !== 'string' || !/^[a-f0-9]{64}$/.test(integrity.digest)) {
    throw new Error('Audit bundle integrity metadata is invalid.');
  }
  const run = record(root.run, 'Audit bundle run') as unknown as AuditRunSnapshot;
  if (!Array.isArray(root.events)) throw new Error('Audit bundle events must be an array.');
  const contextRoot = root.context === undefined
    ? undefined
    : record(root.context, 'Audit bundle context');
  if (contextRoot && (!Array.isArray(contextRoot.objects) || !Array.isArray(contextRoot.relations))) {
    throw new Error('Audit bundle context objects and relations must be arrays.');
  }
  const source = validateSource({
    run,
    events: root.events as GraphEvent[],
    ...(root.checkpoint ? { checkpoint: root.checkpoint as GraphCheckpoint } : {}),
    ...(contextRoot ? {
      context: {
        objects: contextRoot.objects as ContextObject[],
        relations: contextRoot.relations as ContextRelation[],
      },
    } : {}),
  });
  const payload = {
    formatVersion: 1 as const,
    exportedAt: root.exportedAt,
    ...source,
  };
  if (sha256Json(payload) !== integrity.digest) {
    throw new Error('Audit bundle integrity verification failed.');
  }
  return {
    ...payload,
    integrity: { algorithm: 'sha256', digest: integrity.digest },
  };
}
