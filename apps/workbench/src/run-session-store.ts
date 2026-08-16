import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StoredRunSession } from './workspace-store.js';

/**
 * Durable storage for Workbench run sessions.
 *
 * Sessions used to live inside the workspace JSON document, which was rewritten
 * in full on every change: recording one event in the hundredth run
 * re-serialized the ninety-nine before it. Each session is now its own row, so
 * the cost of a write is the size of that run rather than the size of the
 * workspace's entire history.
 */
export interface RunSessionStore {
  get(runId: string): StoredRunSession | undefined;
  /** Newest first, matching the order the Runs view expects. */
  list(): readonly StoredRunSession[];
  save(session: StoredRunSession): void;
  close(): void;
}

/** The first event's timestamp is the run's start; it orders the Runs view. */
function startedAt(session: StoredRunSession): string {
  return session.events[0]?.timestamp ?? new Date(0).toISOString();
}

function byNewest(left: StoredRunSession, right: StoredRunSession): number {
  return startedAt(right).localeCompare(startedAt(left));
}

export class InMemoryRunSessionStore implements RunSessionStore {
  private readonly sessions = new Map<string, StoredRunSession>();

  get(runId: string): StoredRunSession | undefined {
    const session = this.sessions.get(runId);
    return session ? structuredClone(session) : undefined;
  }

  list(): readonly StoredRunSession[] {
    return [...this.sessions.values()].map((session) => structuredClone(session)).sort(byNewest);
  }

  save(session: StoredRunSession): void {
    this.sessions.set(session.runId, structuredClone(session));
  }

  close(): void {
    this.sessions.clear();
  }
}

interface SessionRow {
  readonly document: string;
}

export class SQLiteRunSessionStore implements RunSessionStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS run_sessions (
        run_id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_sessions_started_at ON run_sessions (started_at DESC);
    `);
  }

  get(runId: string): StoredRunSession | undefined {
    const row = this.database
      .prepare('SELECT document FROM run_sessions WHERE run_id = ?')
      .get(runId) as SessionRow | undefined;
    return row ? JSON.parse(row.document) as StoredRunSession : undefined;
  }

  list(): readonly StoredRunSession[] {
    const rows = this.database
      .prepare('SELECT document FROM run_sessions ORDER BY started_at DESC, run_id DESC')
      .all() as unknown as SessionRow[];
    return rows.map((row) => JSON.parse(row.document) as StoredRunSession);
  }

  save(session: StoredRunSession): void {
    this.database.prepare(`
      INSERT INTO run_sessions (run_id, pack_id, graph_id, status, started_at, updated_at, document)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        pack_id = excluded.pack_id,
        graph_id = excluded.graph_id,
        status = excluded.status,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        document = excluded.document
    `).run(
      session.runId,
      session.packId,
      session.graph.id,
      session.status,
      startedAt(session),
      new Date().toISOString(),
      JSON.stringify(session),
    );
  }

  close(): void {
    this.database.close();
  }
}
