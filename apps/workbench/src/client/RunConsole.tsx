import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Circle, Clock3, FileText, Network, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { RunSnapshot } from './types.js';

type ConsoleTab = 'events' | 'state' | 'output' | 'context';

function eventLabel(type: string): string {
  return type.replaceAll('.', ' · ');
}

export function RunConsole({ run, busy, onDecision }: {
  run: RunSnapshot | null;
  busy: boolean;
  onDecision: (approved: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ConsoleTab>('events');
  const deliverable = typeof run?.state.deliverable === 'string' ? run.state.deliverable : '';
  const events = useMemo(() => [...(run?.events ?? [])].reverse(), [run?.events]);
  useEffect(() => {
    if (run) setOpen(true);
  }, [run?.runId, run?.status]);
  return (
    <section className={`run-console ${open ? 'is-open' : ''}`}>
      <header>
        <div className="console-title">
          <span className={`run-light status-${run?.status ?? 'idle'}`} />
          <strong>Execution console</strong>
          <span>{run ? `${run.status} · ${run.events.length} events` : 'No active run'}</span>
        </div>
        <div className="console-tabs">
          {(['events', 'state', 'output', 'context'] as const).map((value) => (
            <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setOpen(true); }}>{value}</button>
          ))}
        </div>
        <button className="icon-control" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse console' : 'Expand console'}>{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
      </header>
      {open ? (
        <div className="console-body">
          {run?.status === 'paused' ? (
            <div className="human-gate-bar">
              <div><Clock3 size={17} /><span><strong>Human decision required</strong><small>The graph is safely checkpointed at its review node.</small></span></div>
              <div><button className="button secondary danger" disabled={busy} onClick={() => onDecision(false)}><X size={14} />Reject</button><button className="button primary" disabled={busy} onClick={() => onDecision(true)}><Check size={14} />Approve & resume</button></div>
            </div>
          ) : null}
          {tab === 'events' ? (
            <div className="event-stream">
              {events.length ? events.map((event) => (
                <article key={`${event.runId}-${event.seq}`}>
                  <span className={`event-dot event-${event.type.includes('failed') ? 'failed' : event.type.includes('completed') ? 'complete' : event.type.includes('human') ? 'human' : 'default'}`}><Circle size={8} /></span>
                  <time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time>
                  <strong>{eventLabel(event.type)}</strong>
                  <code>{event.nodeId ?? 'run'}</code>
                  <span>{Object.keys(event.detail).length ? JSON.stringify(event.detail) : '—'}</span>
                </article>
              )) : <ConsoleEmpty icon={<Circle size={18} />} title="Run the graph to stream events here." />}
            </div>
          ) : null}
          {tab === 'state' ? <pre className="json-output">{JSON.stringify(run?.state ?? {}, null, 2)}</pre> : null}
          {tab === 'output' ? (deliverable ? <div className="markdown-output"><ReactMarkdown>{deliverable}</ReactMarkdown></div> : <ConsoleEmpty icon={<FileText size={19} />} title="No deliverable has been published yet." />) : null}
          {tab === 'context' ? (run?.context ? (
            <div className="context-summary"><Network size={22} /><strong>{run.context.objects.length} objects</strong><span>{run.context.relations.length} relations confirmed by this run.</span></div>
          ) : <ConsoleEmpty icon={<Network size={19} />} title="Approve a completed run to project its context graph." />) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConsoleEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="console-empty">{icon}<span>{title}</span></div>;
}
