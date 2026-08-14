import type {
  ContextObject,
  ContextObjectStatus,
  ContextRelation,
} from '@graph-workbench/contracts';
import type { ContextGraphStore } from './context-store.js';

export interface ContextObjectQuery {
  readonly ids?: readonly string[];
  readonly types?: readonly string[];
  readonly statuses?: readonly ContextObjectStatus[];
  readonly producedByRunIds?: readonly string[];
  readonly currentOnly?: boolean;
  readonly versions?: 'latest' | 'all';
  readonly limit?: number;
}

export interface ContextRelationQuery {
  readonly ids?: readonly string[];
  readonly types?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly targetIds?: readonly string[];
  readonly producedByRunIds?: readonly string[];
  readonly currentOnly?: boolean;
  readonly versions?: 'latest' | 'all';
  readonly limit?: number;
}

export interface ContextTraversalOptions {
  readonly direction?: 'incoming' | 'outgoing' | 'both';
  readonly relationTypes?: readonly string[];
  readonly maxDepth?: number;
}

export interface ContextNeighborhood {
  readonly root: ContextObject;
  readonly objects: readonly ContextObject[];
  readonly relations: readonly ContextRelation[];
}

export interface ContextQueryReader {
  queryObjects(query?: ContextObjectQuery): Promise<readonly ContextObject[]>;
  queryRelations(query?: ContextRelationQuery): Promise<readonly ContextRelation[]>;
  traverse(rootId: string, options?: ContextTraversalOptions): Promise<ContextNeighborhood>;
}

function latestVersions<T extends { readonly id: string; readonly version: number }>(items: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const current = latest.get(item.id);
    if (!current || item.version > current.version) latest.set(item.id, item);
  }
  return [...latest.values()];
}

function limit(items: number | undefined): number | undefined {
  if (items === undefined) return undefined;
  if (!Number.isInteger(items) || items < 1 || items > 10_000) {
    throw new Error('Context query limit must be an integer between 1 and 10000.');
  }
  return items;
}

function selected(value: string, values: ReadonlySet<string> | undefined): boolean {
  return !values || values.has(value);
}

export async function queryContextObjects(
  store: ContextGraphStore,
  query: ContextObjectQuery = {},
): Promise<readonly ContextObject[]> {
  const ids = query.ids ? new Set(query.ids) : undefined;
  const types = query.types ? new Set(query.types) : undefined;
  const statuses = query.statuses ? new Set(query.statuses) : undefined;
  const runIds = query.producedByRunIds ? new Set(query.producedByRunIds) : undefined;
  const maximum = limit(query.limit);
  const source = query.versions === 'all'
    ? [...await store.listObjects()]
    : latestVersions(await store.listObjects());
  const matches = source
    .filter((object) => selected(object.id, ids))
    .filter((object) => selected(object.type, types))
    .filter((object) => !statuses || statuses.has(object.status))
    .filter((object) => !runIds || (
      object.provenance.producedByRunId !== undefined
      && runIds.has(object.provenance.producedByRunId)
    ))
    .filter((object) => query.currentOnly !== true || object.validTo === null)
    .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
  return maximum === undefined ? matches : matches.slice(0, maximum);
}

export async function queryContextRelations(
  store: ContextGraphStore,
  query: ContextRelationQuery = {},
): Promise<readonly ContextRelation[]> {
  const ids = query.ids ? new Set(query.ids) : undefined;
  const types = query.types ? new Set(query.types) : undefined;
  const sourceIds = query.sourceIds ? new Set(query.sourceIds) : undefined;
  const targetIds = query.targetIds ? new Set(query.targetIds) : undefined;
  const runIds = query.producedByRunIds ? new Set(query.producedByRunIds) : undefined;
  const maximum = limit(query.limit);
  const source = query.versions === 'all'
    ? [...await store.listRelations()]
    : latestVersions(await store.listRelations());
  const matches = source
    .filter((relation) => selected(relation.id, ids))
    .filter((relation) => selected(relation.type, types))
    .filter((relation) => selected(relation.sourceId, sourceIds))
    .filter((relation) => selected(relation.targetId, targetIds))
    .filter((relation) => !runIds || (
      relation.provenance.producedByRunId !== undefined
      && runIds.has(relation.provenance.producedByRunId)
    ))
    .filter((relation) => query.currentOnly !== true || relation.validTo === null)
    .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
  return maximum === undefined ? matches : matches.slice(0, maximum);
}

export async function traverseContext(
  store: ContextGraphStore,
  rootId: string,
  options: ContextTraversalOptions = {},
): Promise<ContextNeighborhood> {
  const maxDepth = options.maxDepth ?? 1;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10) {
    throw new Error('Context traversal maxDepth must be an integer between 1 and 10.');
  }
  const root = await store.getObject(rootId);
  if (!root) throw new Error(`Context object "${rootId}" does not exist.`);

  const direction = options.direction ?? 'both';
  const candidates = await queryContextRelations(store, {
    ...(options.relationTypes ? { types: options.relationTypes } : {}),
    currentOnly: true,
  });
  const objects = new Map([[root.id, root]]);
  const relations = new Map<string, ContextRelation>();
  let frontier = new Set([root.id]);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth += 1) {
    const nextIds = new Set<string>();
    for (const relation of candidates) {
      const followsOutgoing = direction !== 'incoming' && frontier.has(relation.sourceId);
      const followsIncoming = direction !== 'outgoing' && frontier.has(relation.targetId);
      if (!followsOutgoing && !followsIncoming) continue;
      relations.set(`${relation.id}\u0000${relation.version}`, relation);
      if (followsOutgoing && !objects.has(relation.targetId)) nextIds.add(relation.targetId);
      if (followsIncoming && !objects.has(relation.sourceId)) nextIds.add(relation.sourceId);
    }
    const nextObjects = await Promise.all([...nextIds].map((id) => store.getObject(id)));
    frontier = new Set();
    for (const object of nextObjects) {
      if (!object) continue;
      objects.set(object.id, object);
      frontier.add(object.id);
    }
  }

  return {
    root,
    objects: [...objects.values()].sort((left, right) => left.id.localeCompare(right.id)),
    relations: [...relations.values()].sort((left, right) =>
      left.id.localeCompare(right.id) || left.version - right.version),
  };
}

export function createContextQueryReader(store: ContextGraphStore): ContextQueryReader {
  return {
    queryObjects: (query) => queryContextObjects(store, query),
    queryRelations: (query) => queryContextRelations(store, query),
    traverse: (rootId, options) => traverseContext(store, rootId, options),
  };
}
