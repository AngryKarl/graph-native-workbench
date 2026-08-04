import { DatabaseSync } from 'node:sqlite';
import {
  graphCheckpointSchema,
  graphEventSchema,
  graphRunRecordSchema,
  type GraphCheckpoint,
  type GraphEvent,
  type GraphRunRecord,
} from '@graph-native/contracts';
import type { RunStore, RunUpdate } from './run-store.js';

interface RunRow {
  run_id: string;
  graph_id: string;
  graph_version: number;
  status: string;
  state: string;
  started_at: string;
  updated_at: string;
  error: string | null;
}

interface EventRow {
  run_id: string;
  seq: number;
  timestamp: string;
  type: string;
  node_id: string | null;
  detail: string;
}

function runFromRow(row: RunRow): GraphRunRecord {
  return graphRunRecordSchema.parse({
    runId: row.run_id,
    graphId: row.graph_id,
    graphVersion: row.graph_version,
    status: row.status,
    state: JSON.parse(row.state),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    error: row.error,
  });
}

function eventFromRow(row: EventRow): GraphEvent {
  return graphEventSchema.parse({
    runId: row.run_id,
    seq: row.seq,
    timestamp: row.timestamp,
    type: row.type,
    detail: JSON.parse(row.detail),
    ...(row.node_id ? { nodeId: row.node_id } : {}),
  });
}

export class SQLiteRunStore implements RunStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS graph_runs (
        run_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS graph_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        node_id TEXT,
        detail TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS graph_events_run_idx ON graph_events(run_id, seq);
      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        run_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async createRun(input: GraphRunRecord): Promise<void> {
    const run = graphRunRecordSchema.parse(input);
    this.database
      .prepare(`INSERT INTO graph_runs
        (run_id, graph_id, graph_version, status, state, started_at, updated_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        run.runId,
        run.graphId,
        run.graphVersion,
        run.status,
        JSON.stringify(run.state),
        run.startedAt,
        run.updatedAt,
        run.error,
      );
  }

  async updateRun(runId: string, update: RunUpdate): Promise<void> {
    const timestamp = new Date().toISOString();
    const result = this.database
      .prepare(`UPDATE graph_runs
        SET status = ?, state = ?, updated_at = ?, error = ?
        WHERE run_id = ?`)
      .run(update.status, JSON.stringify(update.state), timestamp, update.error ?? null, runId);
    if (result.changes !== 1) throw new Error(`Run "${runId}" does not exist.`);
  }

  async getRun(runId: string): Promise<GraphRunRecord | undefined> {
    const row = this.database
      .prepare('SELECT * FROM graph_runs WHERE run_id = ?')
      .get(runId);
    return row ? runFromRow(row as unknown as RunRow) : undefined;
  }

  async appendEvent(input: GraphEvent): Promise<void> {
    const event = graphEventSchema.parse(input);
    this.database
      .prepare(`INSERT INTO graph_events
        (run_id, seq, timestamp, type, node_id, detail)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        event.runId,
        event.seq,
        event.timestamp,
        event.type,
        event.nodeId ?? null,
        JSON.stringify(event.detail),
      );
  }

  async listEvents(runId: string): Promise<readonly GraphEvent[]> {
    const rows = this.database
      .prepare('SELECT * FROM graph_events WHERE run_id = ? ORDER BY seq')
      .all(runId);
    return (rows as unknown as EventRow[]).map(eventFromRow);
  }

  async saveCheckpoint(input: GraphCheckpoint): Promise<void> {
    const checkpoint = graphCheckpointSchema.parse(input);
    this.database
      .prepare(`INSERT INTO graph_checkpoints (run_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
      .run(checkpoint.runId, JSON.stringify(checkpoint), new Date().toISOString());
  }

  async getCheckpoint(runId: string): Promise<GraphCheckpoint | undefined> {
    const row = this.database
      .prepare('SELECT payload FROM graph_checkpoints WHERE run_id = ?')
      .get(runId) as { payload: string } | undefined;
    return row ? graphCheckpointSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  async clearCheckpoint(runId: string): Promise<void> {
    this.database.prepare('DELETE FROM graph_checkpoints WHERE run_id = ?').run(runId);
  }

  close(): void {
    this.database.close();
  }
}
