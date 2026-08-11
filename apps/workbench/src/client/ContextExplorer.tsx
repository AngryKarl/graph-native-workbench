import { useState } from 'react';
import { ArrowRight, Network } from 'lucide-react';
import type { ContextGraphView, ContextObjectView } from './types.js';

function objectKey(object: ContextObjectView): string {
  return `${object.id}:${object.version}`;
}

export function ContextExplorer({ context }: { context: ContextGraphView }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = context.objects.find((object) => objectKey(object) === selectedKey)
    ?? context.objects[0]!;

  return (
    <main className="library-view context-view">
      <div className="view-heading">
        <div>
          <h1>Context graph</h1>
          <p>Confirmed organizational objects, relations and provenance across approved work.</p>
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
          <section className="context-object-list">
            <header><strong>Objects</strong><span>{context.objects.length}</span></header>
            {context.objects.map((object) => (
              <button
                key={objectKey(object)}
                className={objectKey(selected) === objectKey(object) ? 'selected' : ''}
                onClick={() => setSelectedKey(objectKey(object))}
              >
                <span className="object-type">{object.type.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{String(object.data.name ?? object.data.title ?? object.data.claim ?? object.type)}</strong>
                  <code>{object.id} · v{object.version}</code>
                </span>
              </button>
            ))}
          </section>
          <section className="context-detail">
            <div className="context-detail-title">
              <span>{selected.type} · {selected.status}</span>
              <h2>{String(selected.data.name ?? selected.data.title ?? selected.type)}</h2>
              <code>{selected.id} · version {selected.version}</code>
            </div>
            <h3>Data</h3>
            <pre>{JSON.stringify(selected.data, null, 2)}</pre>
            <h3>Provenance</h3>
            <dl>
              <div><dt>Actor</dt><dd>{selected.provenance.actorId}</dd></div>
              <div><dt>Run</dt><dd>{selected.provenance.producedByRunId ?? '—'}</dd></div>
              <div><dt>Node</dt><dd>{selected.provenance.producedByNodeId ?? '—'}</dd></div>
              <div><dt>Recorded</dt><dd>{new Date(selected.provenance.recordedAt).toLocaleString()}</dd></div>
            </dl>
          </section>
          <section className="relation-list">
            <header><strong>Relations</strong><span>{context.relations.length}</span></header>
            {context.relations.map((relation) => (
              <article key={`${relation.id}:${relation.version}`}>
                <code>{relation.sourceId.split('.').at(-1)}</code>
                <span><ArrowRight size={13} />{relation.type}</span>
                <code>{relation.targetId.split('.').at(-1)}</code>
              </article>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
