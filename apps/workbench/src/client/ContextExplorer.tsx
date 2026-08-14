import { useMemo, useState } from 'react';
import { ArrowRight, Network, Search } from 'lucide-react';
import type { ContextGraphView, ContextObjectView, ContextRelationView } from './types.js';

function objectKey(object: ContextObjectView): string {
  return `${object.id}:${object.version}`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' · ');
}

function objectLabel(object: ContextObjectView | undefined, fallback: string): string {
  if (!object) return humanize(fallback.split('.').at(-1) ?? fallback);
  return humanize(String(object.data.name ?? object.data.title ?? object.data.claim ?? object.data.statement ?? object.type));
}

function dataValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) return value.map(String).join(', ');
  return JSON.stringify(value, null, 2);
}

const relationExplanations: Record<string, string> = {
  evidence_supports: 'Evidence supports this item',
  decision_governs: 'An approved decision governs this item',
  deliverable_includes: 'The deliverable includes this item',
  brief_contains: 'The project brief contains this item',
  finding_informs: 'This finding informed the connected item',
  constraint_governs: 'This constraint governs the connected item',
};

function relationWhy(relation: ContextRelationView): string {
  const explicit = relation.attributes.why ?? relation.attributes.reason ?? relation.attributes.description;
  if (typeof explicit === 'string' && explicit) return explicit;
  return relationExplanations[relation.type] ?? humanize(relation.type);
}

function provenanceLine(provenance: ContextObjectView['provenance']): string {
  const origin = [
    provenance.producedByRunId ? `run ${provenance.producedByRunId}` : undefined,
    provenance.producedByNodeId ? `node ${humanize(provenance.producedByNodeId)}` : undefined,
  ].filter(Boolean).join(', ');
  return `Recorded by ${humanize(provenance.actorId)}${origin ? ` from ${origin}` : ''} on ${new Date(provenance.recordedAt).toLocaleString()}.`;
}

function titleCase(value: string): string {
  const normalized = humanize(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function provenanceSummary(provenance: ContextObjectView['provenance']): string {
  return [titleCase(provenance.actorId.replaceAll('.', ' ')), provenance.producedByNodeId ? titleCase(provenance.producedByNodeId) : undefined, 'This object'].filter(Boolean).join(' → ');
}

function relationSentence(relation: ContextRelationView, objectById: ReadonlyMap<string, ContextObjectView>): string {
  const source = objectLabel(objectById.get(relation.sourceId), relation.sourceId);
  const target = objectLabel(objectById.get(relation.targetId), relation.targetId);
  return `${source} ${relationWhy(relation).toLowerCase()} ${target}`;
}

function outcomePriority(object: ContextObjectView): number {
  if (object.type === 'release') return 0;
  if (/deliverable|record|plan|artifact|report|brief/.test(object.type)) return 1;
  if (/decision/.test(object.type)) return 2;
  return 3;
}

function defaultContextObject(objects: readonly ContextObjectView[]): ContextObjectView {
  const latestRunId = objects.find((object) => object.provenance.producedByRunId)?.provenance.producedByRunId;
  const latestRunObjects = latestRunId
    ? objects.filter((object) => object.provenance.producedByRunId === latestRunId)
    : objects;
  return [...latestRunObjects].sort((left, right) => outcomePriority(left) - outcomePriority(right))[0]
    ?? [...objects].sort((left, right) => outcomePriority(left) - outcomePriority(right))[0]!;
}

export function ContextExplorer({ context }: { context: ContextGraphView }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const selected = context.objects.find((object) => objectKey(object) === selectedKey)
    ?? defaultContextObject(context.objects);
  const objectById = new Map(context.objects.map((object) => [object.id, object]));
  const neighborhood = context.relations.filter((relation) => relation.sourceId === selected.id || relation.targetId === selected.id);
  const objectTypes = useMemo(() => [...new Set(context.objects.map((object) => object.type))].sort(), [context.objects]);
  const visibleObjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return context.objects.filter((object) => {
      if (typeFilter !== 'all' && object.type !== typeFilter) return false;
      if (!normalizedQuery) return true;
      return `${objectLabel(object, object.id)} ${humanize(object.type)} ${object.id}`.toLowerCase().includes(normalizedQuery);
    });
  }, [context.objects, query, typeFilter]);

  const selectObject = (id: string) => {
    const object = objectById.get(id);
    if (object) setSelectedKey(objectKey(object));
  };

  return (
    <main className="library-view context-view">
      <div className="view-heading">
        <div>
          <h1>Context graph</h1>
          <p>Follow the evidence, decisions and deliverables connected to approved work.</p>
        </div>
        {context.sourceRunIds.length > 0
          ? <code>{context.sourceRunIds.length} approved {context.sourceRunIds.length === 1 ? 'run' : 'runs'}</code>
          : null}
      </div>
      {context.objects.length === 0 ? (
        <div className="view-empty">
          <Network size={26} />
          <strong>No confirmed context yet</strong>
          <p>Approve a Pack run to project its output into the context graph.</p>
        </div>
      ) : (
        <div className="context-grid">
          <section className="context-object-list" aria-label="Context objects">
            <header><strong>Objects</strong><span>{context.objects.length}</span></header>
            <div className="context-filters">
              <label><Search size={13} /><input aria-label="Filter context objects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find object" /></label>
              <select aria-label="Filter context object type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All types</option>
                {objectTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
              </select>
            </div>
            {visibleObjects.map((object) => (
              <button
                key={objectKey(object)}
                className={objectKey(selected) === objectKey(object) ? 'selected' : ''}
                aria-pressed={objectKey(selected) === objectKey(object)}
                onClick={() => setSelectedKey(objectKey(object))}
              >
                <span className="object-type">{object.type.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{objectLabel(object, object.id)}</strong>
                  <code>{humanize(object.type)} · v{object.version}</code>
                </span>
              </button>
            ))}
            {visibleObjects.length === 0 ? <p className="context-filter-empty">No matching objects.</p> : null}
          </section>
          <section className="context-detail" aria-live="polite">
            <div className="context-detail-title">
              <span>{humanize(selected.type)} · {selected.status}</span>
              <h2>{objectLabel(selected, selected.id)}</h2>
              <code>{humanize(selected.type)} · version {selected.version}</code>
            </div>
            <h3>Key facts</h3>
            <dl className="context-data-list">
              {Object.entries(selected.data).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{dataValue(value)}</dd></div>)}
            </dl>
            <details className="context-raw-data"><summary>Raw object data</summary><pre>{JSON.stringify(selected.data, null, 2)}</pre></details>
            <h3>Provenance chain</h3>
            <p className="provenance-summary">{provenanceSummary(selected.provenance)}</p>
            <details className="context-raw-data"><summary>Recorded source and run</summary><p>{provenanceLine(selected.provenance)}</p><code>{selected.id}</code></details>
            <h3>Why it is connected</h3>
            {neighborhood.length ? (
              <dl>
                {neighborhood.map((relation) => {
                  const peerId = relation.sourceId === selected.id ? relation.targetId : relation.sourceId;
                  const peer = objectById.get(peerId);
                  return <div key={`${relation.id}:${relation.version}`}><dd>{relationSentence(relation, objectById)} <button className="button ghost" onClick={() => selectObject(peerId)}>Open {objectLabel(peer, peerId)}</button></dd></div>;
                })}
              </dl>
            ) : <p>No direct relations have been confirmed for this object.</p>}
            {selected.provenance.sourceIds.length ? <p><strong>Sources:</strong> {selected.provenance.sourceIds.map((id) => objectLabel(objectById.get(id), id)).join(', ')}</p> : null}
          </section>
          <section className="relation-list" aria-label="Selected object neighborhood">
            <header><strong>Neighborhood</strong><span>{neighborhood.length}</span></header>
            {neighborhood.map((relation) => {
              const source = objectById.get(relation.sourceId);
              const target = objectById.get(relation.targetId);
              return (
                <article key={`${relation.id}:${relation.version}`} title={provenanceLine(relation.provenance)}>
                  <button className="button ghost" onClick={() => selectObject(relation.sourceId)}>{objectLabel(source, relation.sourceId)}</button>
                  <span title={relation.type}><ArrowRight size={13} />{relationSentence(relation, objectById)}</span>
                  <button className="button ghost" onClick={() => selectObject(relation.targetId)}>{objectLabel(target, relation.targetId)}</button>
                </article>
              );
            })}
            {neighborhood.length === 0 ? <div className="console-empty"><Network size={18} /><span>No direct relations</span></div> : null}
          </section>
        </div>
      )}
    </main>
  );
}
