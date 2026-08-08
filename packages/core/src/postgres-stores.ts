import { Pool } from 'pg';
import {
  contextObjectSchema,
  contextRelationSchema,
  graphCheckpointSchema,
  graphEventSchema,
  graphRunRecordSchema,
  type ContextObject,
  type ContextRelation,
  type GraphCheckpoint,
  type GraphEvent,
  type GraphRunRecord,
  type IndustryPackManifest,
} from '@graph-native/contracts';
import type { ContextGraphStore } from './context-store.js';
import { assertPackObject, assertPackRelation } from './context-validation.js';
import type { RunStore, RunUpdate } from './run-store.js';

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: Row[];
  readonly rowCount?: number | null;
}

export interface PostgresQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  end?(): Promise<void>;
}

type JsonValue = string | Record<string, unknown> | unknown[];

interface RunRow extends Record<string, unknown> {
  run_id: string;
  graph_id: string;
  graph_version: number;
  status: string;
  state: JsonValue;
  started_at: string | Date;
  updated_at: string | Date;
  error: string | null;
}

interface EventRow extends Record<string, unknown> {
  run_id: string;
  seq: number;
  timestamp: string | Date;
  type: string;
  node_id: string | null;
  detail: JsonValue;
}

interface ObjectRow extends Record<string, unknown> {
  id: string;
  type: string;
  version: number;
  status: string;
  data: JsonValue;
  valid_from: string | Date;
  valid_to: string | Date | null;
  provenance: JsonValue;
}

interface RelationRow extends Record<string, unknown> {
  id: string;
  type: string;
  source_id: string;
  target_id: string;
  version: number;
  attributes: JsonValue;
  valid_from: string | Date;
  valid_to: string | Date | null;
  provenance: JsonValue;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS graphwork_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS graph_runs (
    run_id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    graph_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    state JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS graph_events (
    run_id TEXT NOT NULL REFERENCES graph_runs(run_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    node_id TEXT,
    detail JSONB NOT NULL,
    PRIMARY KEY (run_id, seq)
  )`,
  'CREATE INDEX IF NOT EXISTS graph_events_run_idx ON graph_events(run_id, seq)',
  `CREATE TABLE IF NOT EXISTS graph_checkpoints (
    run_id TEXT PRIMARY KEY REFERENCES graph_runs(run_id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_objects (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    data JSONB NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    provenance JSONB NOT NULL,
    PRIMARY KEY (id, version)
  )`,
  'CREATE INDEX IF NOT EXISTS context_objects_type_idx ON context_objects(type)',
  `CREATE TABLE IF NOT EXISTS context_relations (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    attributes JSONB NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    provenance JSONB NOT NULL,
    PRIMARY KEY (id, version)
  )`,
  'CREATE INDEX IF NOT EXISTS context_relations_source_idx ON context_relations(source_id)',
  'CREATE INDEX IF NOT EXISTS context_relations_target_idx ON context_relations(target_id)',
] as const;

function json(value: JsonValue): unknown {
  return typeof value === 'string' ? JSON.parse(value) as unknown : value;
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function ownedPool(connectionString: string): PostgresQueryable {
  const pool = new Pool({ connectionString });
  pool.on('error', (error) => process.emitWarning(error, { code: 'GRAPHWORK_POSTGRES_IDLE_CLIENT' }));
  return pool as unknown as PostgresQueryable;
}

async function initializeSchema(database: PostgresQueryable): Promise<void> {
  for (const statement of schemaStatements) await database.query(statement);
  await database.query(
    `INSERT INTO graphwork_schema_migrations (version, applied_at)
     VALUES (1, NOW()) ON CONFLICT (version) DO NOTHING`,
  );
}

function runFromRow(row: RunRow): GraphRunRecord {
  return graphRunRecordSchema.parse({
    runId: row.run_id,
    graphId: row.graph_id,
    graphVersion: row.graph_version,
    status: row.status,
    state: json(row.state),
    startedAt: timestamp(row.started_at),
    updatedAt: timestamp(row.updated_at),
    error: row.error,
  });
}

function eventFromRow(row: EventRow): GraphEvent {
  return graphEventSchema.parse({
    runId: row.run_id,
    seq: row.seq,
    timestamp: timestamp(row.timestamp),
    type: row.type,
    detail: json(row.detail),
    ...(row.node_id ? { nodeId: row.node_id } : {}),
  });
}

function objectFromRow(row: ObjectRow): ContextObject {
  return contextObjectSchema.parse({
    id: row.id,
    type: row.type,
    version: row.version,
    status: row.status,
    data: json(row.data),
    validFrom: timestamp(row.valid_from),
    validTo: nullableTimestamp(row.valid_to),
    provenance: json(row.provenance),
  });
}

function relationFromRow(row: RelationRow): ContextRelation {
  return contextRelationSchema.parse({
    id: row.id,
    type: row.type,
    sourceId: row.source_id,
    targetId: row.target_id,
    version: row.version,
    attributes: json(row.attributes),
    validFrom: timestamp(row.valid_from),
    validTo: nullableTimestamp(row.valid_to),
    provenance: json(row.provenance),
  });
}

abstract class PostgresStore {
  protected readonly database: PostgresQueryable;
  protected readonly ready: Promise<void>;
  private readonly owned: boolean;

  constructor(connection: string | PostgresQueryable) {
    this.owned = typeof connection === 'string';
    this.database = typeof connection === 'string' ? ownedPool(connection) : connection;
    this.ready = initializeSchema(this.database);
  }

  async close(): Promise<void> {
    await this.ready;
    if (this.owned) await this.database.end?.();
  }
}

export class PostgresRunStore extends PostgresStore implements RunStore {
  async createRun(input: GraphRunRecord): Promise<void> {
    await this.ready;
    const run = graphRunRecordSchema.parse(input);
    await this.database.query(
      `INSERT INTO graph_runs
       (run_id, graph_id, graph_version, status, state, started_at, updated_at, error)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [run.runId, run.graphId, run.graphVersion, run.status, JSON.stringify(run.state),
        run.startedAt, run.updatedAt, run.error],
    );
  }

  async updateRun(runId: string, update: RunUpdate): Promise<void> {
    await this.ready;
    const result = await this.database.query<{ run_id: string }>(
      `UPDATE graph_runs SET status = $1, state = $2::jsonb, updated_at = NOW(), error = $3
       WHERE run_id = $4 RETURNING run_id`,
      [update.status, JSON.stringify(update.state), update.error ?? null, runId],
    );
    if (result.rows.length !== 1) throw new Error(`Run "${runId}" does not exist.`);
  }

  async getRun(runId: string): Promise<GraphRunRecord | undefined> {
    await this.ready;
    const result = await this.database.query<RunRow>('SELECT * FROM graph_runs WHERE run_id = $1', [runId]);
    return result.rows[0] ? runFromRow(result.rows[0]) : undefined;
  }

  async appendEvent(input: GraphEvent): Promise<void> {
    await this.ready;
    const event = graphEventSchema.parse(input);
    await this.database.query(
      `INSERT INTO graph_events (run_id, seq, timestamp, type, node_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [event.runId, event.seq, event.timestamp, event.type, event.nodeId ?? null, JSON.stringify(event.detail)],
    );
  }

  async listEvents(runId: string): Promise<readonly GraphEvent[]> {
    await this.ready;
    const result = await this.database.query<EventRow>(
      'SELECT * FROM graph_events WHERE run_id = $1 ORDER BY seq',
      [runId],
    );
    return result.rows.map(eventFromRow);
  }

  async saveCheckpoint(input: GraphCheckpoint): Promise<void> {
    await this.ready;
    const checkpoint = graphCheckpointSchema.parse(input);
    await this.database.query(
      `INSERT INTO graph_checkpoints (run_id, payload, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (run_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      [checkpoint.runId, JSON.stringify(checkpoint)],
    );
  }

  async getCheckpoint(runId: string): Promise<GraphCheckpoint | undefined> {
    await this.ready;
    const result = await this.database.query<{ payload: JsonValue }>(
      'SELECT payload FROM graph_checkpoints WHERE run_id = $1',
      [runId],
    );
    return result.rows[0] ? graphCheckpointSchema.parse(json(result.rows[0].payload)) : undefined;
  }

  async clearCheckpoint(runId: string): Promise<void> {
    await this.ready;
    await this.database.query('DELETE FROM graph_checkpoints WHERE run_id = $1', [runId]);
  }
}

export class PostgresContextGraphStore extends PostgresStore implements ContextGraphStore {
  constructor(
    connection: string | PostgresQueryable,
    private readonly pack?: IndustryPackManifest,
  ) {
    super(connection);
  }

  async appendObject(input: ContextObject): Promise<void> {
    await this.ready;
    const object = contextObjectSchema.parse(input);
    const expected = await this.nextVersion('context_objects', object.id);
    if (object.version !== expected) {
      throw new Error(`Context object "${object.id}" must append version ${expected}.`);
    }
    assertPackObject(this.pack, object);
    try {
      await this.database.query(
        `INSERT INTO context_objects
         (id, version, type, status, data, valid_from, valid_to, provenance)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)`,
        [object.id, object.version, object.type, object.status, JSON.stringify(object.data),
          object.validFrom, object.validTo, JSON.stringify(object.provenance)],
      );
    } catch (error) {
      await this.rethrowVersionConflict(error, 'object', object.id);
    }
  }

  async appendRelation(input: ContextRelation): Promise<void> {
    await this.ready;
    const relation = contextRelationSchema.parse(input);
    const expected = await this.nextVersion('context_relations', relation.id);
    if (relation.version !== expected) {
      throw new Error(`Context relation "${relation.id}" must append version ${expected}.`);
    }
    const source = await this.getObject(relation.sourceId);
    const target = await this.getObject(relation.targetId);
    if (!source) throw new Error(`Relation "${relation.id}" has unknown source object "${relation.sourceId}".`);
    if (!target) throw new Error(`Relation "${relation.id}" has unknown target object "${relation.targetId}".`);
    assertPackRelation(this.pack, relation, source, target);
    try {
      await this.database.query(
        `INSERT INTO context_relations
         (id, version, type, source_id, target_id, attributes, valid_from, valid_to, provenance)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)`,
        [relation.id, relation.version, relation.type, relation.sourceId, relation.targetId,
          JSON.stringify(relation.attributes), relation.validFrom, relation.validTo,
          JSON.stringify(relation.provenance)],
      );
    } catch (error) {
      await this.rethrowVersionConflict(error, 'relation', relation.id);
    }
  }

  async getObject(id: string, version?: number): Promise<ContextObject | undefined> {
    await this.ready;
    const result = version === undefined
      ? await this.database.query<ObjectRow>(
          'SELECT * FROM context_objects WHERE id = $1 ORDER BY version DESC LIMIT 1', [id],
        )
      : await this.database.query<ObjectRow>(
          'SELECT * FROM context_objects WHERE id = $1 AND version = $2', [id, version],
        );
    return result.rows[0] ? objectFromRow(result.rows[0]) : undefined;
  }

  async listObjects(): Promise<readonly ContextObject[]> {
    await this.ready;
    const result = await this.database.query<ObjectRow>('SELECT * FROM context_objects ORDER BY id, version');
    return result.rows.map(objectFromRow);
  }

  async listRelations(): Promise<readonly ContextRelation[]> {
    await this.ready;
    const result = await this.database.query<RelationRow>('SELECT * FROM context_relations ORDER BY id, version');
    return result.rows.map(relationFromRow);
  }

  private async nextVersion(table: 'context_objects' | 'context_relations', id: string): Promise<number> {
    const result = await this.database.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ${table} WHERE id = $1`, [id],
    );
    return Number(result.rows[0]?.version ?? 1);
  }

  private async rethrowVersionConflict(
    error: unknown,
    kind: 'object' | 'relation',
    id: string,
  ): Promise<never> {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const table = kind === 'object' ? 'context_objects' : 'context_relations';
      const expected = await this.nextVersion(table, id);
      throw new Error(`Context ${kind} "${id}" must append version ${expected}.`);
    }
    throw error;
  }
}
