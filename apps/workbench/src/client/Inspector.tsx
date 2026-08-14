import { useEffect, useState } from 'react';
import { AlertCircle, Database, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type {
  GraphNode,
  InspectorTab,
  PackDescription,
  StateField,
} from './types.js';

function splitValues(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function JsonEditor({ value, onChange, rows = 5 }: {
  value: unknown;
  onChange: (value: unknown) => void;
  rows?: number;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  useEffect(() => setDraft(JSON.stringify(value, null, 2)), [value]);
  const commit = () => {
    try {
      onChange(JSON.parse(draft) as unknown);
      setError('');
    } catch {
      setError('Enter valid JSON before leaving this field.');
    }
  };
  return (
    <div className="json-editor">
      <textarea rows={rows} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      {error ? <small className="field-error"><AlertCircle size={12} />{error}</small> : null}
    </div>
  );
}

function InputField({ id, definition, value, onChange }: {
  id: string;
  definition: StateField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (definition.type === 'boolean') {
    return (
      <label className="toggle-field">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span><strong>{id}</strong><small>{definition.description}</small></span>
      </label>
    );
  }
  if (definition.type === 'string') {
    return (
      <label className="inspector-field">
        <span>{id}{definition.required ? ' *' : ''}</span>
        <textarea rows={3} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
        <small>{definition.description}</small>
      </label>
    );
  }
  if (definition.type === 'number') {
    return (
      <label className="inspector-field">
        <span>{id}{definition.required ? ' *' : ''}</span>
        <input type="number" value={typeof value === 'number' ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
        <small>{definition.description}</small>
      </label>
    );
  }
  return (
    <label className="inspector-field">
      <span>{id}{definition.required ? ' *' : ''}</span>
      <JsonEditor value={value ?? (definition.type === 'array' ? [] : {})} onChange={onChange} />
      <small>{definition.description}</small>
    </label>
  );
}

function NodeInspector({ node, pack, onUpdate }: {
  node: GraphNode | null;
  pack: PackDescription;
  onUpdate: (node: GraphNode) => void;
}) {
  if (!node) {
    return (
      <div className="inspector-empty">
        <SlidersHorizontal size={22} />
        <strong>Select a node</strong>
        <p>Inspect its contract, handler, state access and execution policy.</p>
      </div>
    );
  }
  const update = (patch: Partial<GraphNode>) => onUpdate({ ...node, ...patch });
  const execution = node.execution ?? {};
  return (
    <div className="inspector-scroll">
      <div className="inspector-title">
        <span>{node.kind}</span>
        <h2>{node.label}</h2>
        <code>{node.id}</code>
      </div>
      <label className="inspector-field"><span>Label</span><input value={node.label} onChange={(event) => update({ label: event.target.value })} /></label>
      <label className="inspector-field"><span>Description</span><textarea rows={4} value={node.description} onChange={(event) => update({ description: event.target.value })} /></label>
      <label className="inspector-field"><span>Kind</span>
        <select value={node.kind} onChange={(event) => update({ kind: event.target.value as GraphNode['kind'] })}>
          {(['trigger', 'function', 'agent', 'join', 'human', 'router', 'wait', 'subgraph', 'loop', 'map', 'escalation', 'compensation'] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </label>
      <label className="inspector-field"><span>Handler</span>
        <select value={node.handler ?? ''} onChange={(event) => update({ handler: event.target.value || undefined })}>
          <option value="">No handler</option>
          {pack.handlers.map((handler) => <option key={handler} value={handler}>{handler}</option>)}
        </select>
      </label>
      <label className="inspector-field"><span>Reads</span><input value={node.reads.join(', ')} onChange={(event) => update({ reads: splitValues(event.target.value) })} /><small>Comma-separated state fields.</small></label>
      <label className="inspector-field"><span>Writes</span><input value={node.writes.join(', ')} onChange={(event) => update({ writes: splitValues(event.target.value) })} /><small>Comma-separated state fields.</small></label>
      <div className="inspector-group">
        <h3>Execution</h3>
        <label className="inspector-field"><span>Timeout (ms)</span><input type="number" value={execution.timeoutMs ?? ''} placeholder="Pack default" onChange={(event) => update({ execution: { ...execution, timeoutMs: event.target.value ? Number(event.target.value) : undefined } })} /></label>
        <label className="inspector-field"><span>Retry attempts</span><input type="number" min="1" max="10" value={execution.retry?.maxAttempts ?? ''} placeholder="1" onChange={(event) => update({ execution: { ...execution, retry: event.target.value ? { maxAttempts: Number(event.target.value), backoffMs: execution.retry?.backoffMs ?? 0 } : undefined } })} /></label>
      </div>
      <div className="inspector-group"><h3>Config</h3><JsonEditor value={node.config} onChange={(config) => update({ config: config as Record<string, unknown> })} rows={7} /></div>
    </div>
  );
}

function InputInspector({ pack, input, onChange, onSelectFixture }: {
  pack: PackDescription;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
  onSelectFixture: (fixtureId: string) => void;
}) {
  const fields = Object.entries(pack.graph.state.fields).filter(([id, definition]) => definition.required || id in input);
  return (
    <div className="inspector-scroll">
      <div className="inspector-title"><span>Run input</span><h2>Graph state</h2><p>Generated from the Pack state contract.</p></div>
      <label className="inspector-field"><span>Fixture</span>
        <select defaultValue="" onChange={(event) => onSelectFixture(event.target.value)}>
          <option value="" disabled>Load a fixture…</option>
          {pack.fixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.label}</option>)}
        </select>
      </label>
      {fields.map(([id, definition]) => (
        <InputField key={id} id={id} definition={definition} value={input[id]} onChange={(value) => onChange({ ...input, [id]: value })} />
      ))}
    </div>
  );
}

function PolicyInspector({ pack }: { pack: PackDescription }) {
  return (
    <div className="inspector-scroll policy-inspector">
      <div className="inspector-title"><span>Pack contract</span><h2>Governance</h2><p>Roles, tools and blocking evaluations travel with the Pack.</p></div>
      <section><h3><ShieldCheck size={15} />Roles</h3>{pack.manifest.roles.map((role) => <article key={role.id}><strong>{role.label}</strong><p>{role.mission}</p><code>{role.id}</code></article>)}</section>
      <section><h3><Database size={15} />Tools</h3>{pack.manifest.tools.map((tool) => <article key={tool.id}><strong>{tool.label}</strong><span className={`risk risk-${tool.risk}`}>{tool.risk}</span><p>{tool.description}</p>{tool.operation ? <code>{tool.operation} · {tool.idempotency} · typed I/O</code> : null}</article>)}</section>
      <section><h3><AlertCircle size={15} />Evaluations</h3>{pack.manifest.evaluations.map((evaluation) => <article key={evaluation.id}><strong>{evaluation.label}</strong>{evaluation.blocking ? <span className="blocking">blocking</span> : null}<p>{evaluation.description}</p></article>)}</section>
    </div>
  );
}

export function Inspector({ tab, onTab, node, pack, input, open, onClose, onInput, onUpdateNode, onSelectFixture }: {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  node: GraphNode | null;
  pack: PackDescription;
  input: Record<string, unknown>;
  open: boolean;
  onClose: () => void;
  onInput: (input: Record<string, unknown>) => void;
  onUpdateNode: (node: GraphNode) => void;
  onSelectFixture: (fixtureId: string) => void;
}) {
  return (
    <aside className={`editor-inspector ${open ? 'is-open mobile-open' : ''}`}>
      <div className="inspector-tabs">
        {(['node', 'input', 'policy'] as const).map((value) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => onTab(value)}>{value}</button>)}
        <button className="inspector-close" onClick={onClose} aria-label="Close inspector"><X size={15} /></button>
      </div>
      {tab === 'node' ? <NodeInspector node={node} pack={pack} onUpdate={onUpdateNode} /> : null}
      {tab === 'input' ? <InputInspector pack={pack} input={input} onChange={onInput} onSelectFixture={onSelectFixture} /> : null}
      {tab === 'policy' ? <PolicyInspector pack={pack} /> : null}
    </aside>
  );
}
