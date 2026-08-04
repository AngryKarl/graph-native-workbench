import { useMemo, useState } from 'react';
import { ArrowRight, Network } from 'lucide-react';
import type { ContextObjectView, RunSnapshot } from './types.js';

export function ContextExplorer({ runs }: { runs: RunSnapshot[] }) {
  const sourceRun = useMemo(() => runs.find((run) => run.context && run.context.objects.length > 0), [runs]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const objects = sourceRun?.context?.objects ?? [];
  const relations = sourceRun?.context?.relations ?? [];
  const selected = objects.find((object) => object.id === selectedId) ?? objects[0];
  return (
    <main className="library-view context-view">
      <div className="view-heading"><div><h1>Context graph</h1><p>Confirmed organizational objects, relations and provenance produced by approved work.</p></div>{sourceRun ? <code>{sourceRun.runId}</code> : null}</div>
      {!sourceRun ? <div className="view-empty"><Network size={26} /><strong>No confirmed context yet</strong><p>Approve a Pack run to project its output into the context graph.</p></div> : (
        <div className="context-grid">
          <section className="context-object-list"><header><strong>Objects</strong><span>{objects.length}</span></header>{objects.map((object) => <button key={object.id} className={selected?.id === object.id ? 'selected' : ''} onClick={() => setSelectedId(object.id)}><span className="object-type">{object.type.slice(0, 2).toUpperCase()}</span><span><strong>{String(object.data.name ?? object.data.title ?? object.data.claim ?? object.type)}</strong><code>{object.id}</code></span></button>)}</section>
          <section className="context-detail">{selected ? <><div className="context-detail-title"><span>{selected.type}</span><h2>{String(selected.data.name ?? selected.data.title ?? selected.type)}</h2><code>{selected.id}</code></div><h3>Data</h3><pre>{JSON.stringify(selected.data, null, 2)}</pre><h3>Provenance</h3><dl><div><dt>Actor</dt><dd>{selected.provenance.actorId}</dd></div><div><dt>Node</dt><dd>{selected.provenance.producedByNodeId ?? '—'}</dd></div><div><dt>Recorded</dt><dd>{new Date(selected.provenance.recordedAt).toLocaleString()}</dd></div></dl></> : null}</section>
          <section className="relation-list"><header><strong>Relations</strong><span>{relations.length}</span></header>{relations.map((relation) => <article key={relation.id}><code>{relation.sourceId.split('.').at(-1)}</code><span><ArrowRight size={13} />{relation.type}</span><code>{relation.targetId.split('.').at(-1)}</code></article>)}</section>
        </div>
      )}
    </main>
  );
}
