import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  contextObjectSchema,
  contextRelationSchema,
  type ContextObject,
  type ContextRelation,
  type IndustryPackManifest,
} from '@graph-native/contracts';
import type { ContextGraphStore } from './context-store.js';
import { assertPackObject, assertPackRelation } from './context-validation.js';

interface ObjectRow {
  id: string;
  type: string;
  version: number;
  status: string;
  data: string;
  valid_from: string;
  valid_to: string | null;
  provenance: string;
}

interface RelationRow {
  id: string;
  type: string;
  source_id: string;
  target_id: string;
  version: number;
  attributes: string;
  valid_from: string;
  valid_to: string | null;
  provenance: string;
}

function objectFromRow(row: ObjectRow): ContextObject {
  return contextObjectSchema.parse({
    id: row.id,
    type: row.type,
    version: row.version,
    status: row.status,
    data: JSON.parse(row.data),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    provenance: JSON.parse(row.provenance),
  });
}

function relationFromRow(row: RelationRow): ContextRelation {
  return contextRelationSchema.parse({
    id: row.id,
    type: row.type,
    sourceId: row.source_id,
    targetId: row.target_id,
    version: row.version,
    attributes: JSON.parse(row.attributes),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    provenance: JSON.parse(row.provenance),
  });
}

function nextVersion(statement: StatementSync, id: string): number {
  const row = statement.get(id) as { version: number | null } | undefined;
  return (row?.version ?? 0) + 1;
}

export class SQLiteContextGraphStore implements ContextGraphStore {
  private readonly database: DatabaseSync;

  constructor(
    filePath: string,
    private readonly pack?: IndustryPackManifest,
  ) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS context_objects (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        provenance TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE INDEX IF NOT EXISTS context_objects_type_idx ON context_objects(type);
      CREATE TABLE IF NOT EXISTS context_relations (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        attributes TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        provenance TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE INDEX IF NOT EXISTS context_relations_source_idx ON context_relations(source_id);
      CREATE INDEX IF NOT EXISTS context_relations_target_idx ON context_relations(target_id);
    `);
  }

  async appendObject(input: ContextObject): Promise<void> {
    const object = contextObjectSchema.parse(input);
    const expected = nextVersion(
      this.database.prepare('SELECT MAX(version) AS version FROM context_objects WHERE id = ?'),
      object.id,
    );
    if (object.version !== expected) {
      throw new Error(`Context object "${object.id}" must append version ${expected}.`);
    }
    assertPackObject(this.pack, object);
    this.database
      .prepare(`INSERT INTO context_objects
        (id, version, type, status, data, valid_from, valid_to, provenance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        object.id,
        object.version,
        object.type,
        object.status,
        JSON.stringify(object.data),
        object.validFrom,
        object.validTo,
        JSON.stringify(object.provenance),
      );
  }

  async appendRelation(input: ContextRelation): Promise<void> {
    const relation = contextRelationSchema.parse(input);
    const expected = nextVersion(
      this.database.prepare('SELECT MAX(version) AS version FROM context_relations WHERE id = ?'),
      relation.id,
    );
    if (relation.version !== expected) {
      throw new Error(`Context relation "${relation.id}" must append version ${expected}.`);
    }
    const source = await this.getObject(relation.sourceId);
    const target = await this.getObject(relation.targetId);
    if (!source) throw new Error(`Relation "${relation.id}" has unknown source object "${relation.sourceId}".`);
    if (!target) throw new Error(`Relation "${relation.id}" has unknown target object "${relation.targetId}".`);
    assertPackRelation(this.pack, relation, source, target);
    this.database
      .prepare(`INSERT INTO context_relations
        (id, version, type, source_id, target_id, attributes, valid_from, valid_to, provenance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        relation.id,
        relation.version,
        relation.type,
        relation.sourceId,
        relation.targetId,
        JSON.stringify(relation.attributes),
        relation.validFrom,
        relation.validTo,
        JSON.stringify(relation.provenance),
      );
  }

  async getObject(id: string, version?: number): Promise<ContextObject | undefined> {
    const row = version === undefined
      ? this.database
          .prepare('SELECT * FROM context_objects WHERE id = ? ORDER BY version DESC LIMIT 1')
          .get(id)
      : this.database
          .prepare('SELECT * FROM context_objects WHERE id = ? AND version = ?')
          .get(id, version);
    return row ? objectFromRow(row as unknown as ObjectRow) : undefined;
  }

  async listObjects(): Promise<readonly ContextObject[]> {
    const rows = this.database.prepare('SELECT * FROM context_objects ORDER BY id, version').all();
    return (rows as unknown as ObjectRow[]).map(objectFromRow);
  }

  async listRelations(): Promise<readonly ContextRelation[]> {
    const rows = this.database.prepare('SELECT * FROM context_relations ORDER BY id, version').all();
    return (rows as unknown as RelationRow[]).map(relationFromRow);
  }

  close(): void {
    this.database.close();
  }
}
