import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Circle, Clock3, Download, FileText, Network, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { GraphEvent, RunSnapshot } from './types.js';

type ConsoleTab = 'events' | 'state' | 'output' | 'context';

function eventLabel(type: string): string {
  return type.replaceAll('.', ' · ');
}

function eventTone(type: string): string {
  if (type.includes('failed') || type.includes('denied')) return 'failed';
  if (type.startsWith('tool.')) return 'tool';
  if (type.includes('completed') || type.includes('resolved')) return 'complete';
  if (type.includes('human')) return 'human';
  return 'default';
}

function eventSummary(event: GraphEvent): string {
  const toolId = typeof event.detail.toolId === 'string' ? event.detail.toolId : '';
  if (event.type === 'tool.requested') return `Model requested ${toolId}`;
  if (event.type === 'tool.approval_requested') return `${toolId} requires approval · ${String(event.detail.risk ?? 'unknown')} risk`;
  if (event.type === 'tool.approval_resolved') return `${toolId} approval ${event.detail.approved ? 'granted' : 'rejected'}`;
  if (event.type === 'tool.started') return `Running ${toolId} · ${String(event.detail.risk ?? 'unknown')} risk`;
  if (event.type === 'tool.completed') return `${toolId} returned successfully`;
  if (event.type === 'tool.denied') return `${toolId} denied · ${String(event.detail.reason ?? 'policy')}`;
  if (event.type === 'tool.failed') return `${toolId} failed · ${String(event.detail.message ?? 'unknown error')}`;
  if (event.type === 'human.requested') {
    return event.detail.requiredRoleId
      ? `Assigned to role ${String(event.detail.requiredRoleId)}`
      : 'Human decision requested';
  }
  if (event.type === 'human.resolved') {
    return event.detail.resolvedByActorName
      ? `Resolved by ${String(event.detail.resolvedByActorName)}`
      : 'Human decision resolved';
  }
  const usage = event.detail.usage;
  if (event.type === 'node.completed' && usage && typeof usage === 'object') {
    const record = usage as Record<string, unknown>;
    if (typeof record.providerId === 'string') {
      const tokens = typeof record.totalTokens === 'number' ? ` · ${record.totalTokens} tokens` : '';
      return `${record.providerId} · ${String(record.model ?? 'model')}${tokens}`;
    }
  }
  return Object.keys(event.detail).length ? JSON.stringify(event.detail) : '—';
}

export function RunConsole({ run, busy, onDecision, onResume, onExport }: {
  run: RunSnapshot | null;
  busy: boolean;
  onDecision: (approved: boolean) => void;
  onResume: () => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(run?.status === 'paused');
  const [tab, setTab] = useState<ConsoleTab>('events');
  const previousRunId = useRef(run?.runId);
  const deliverable = typeof run?.state.deliverable === 'string' ? run.state.deliverable : '';
  const artifacts = run?.artifacts ?? [];
  const artifactEvidenceCount = artifacts.reduce((total, artifact) => total + artifact.evidence.length, 0);
  const events = useMemo(() => [...(run?.events ?? [])].reverse(), [run?.events]);
  const approval = run?.pendingApproval;
  const wait = run?.pendingWait;
  const requiredRole = approval?.requiredRoleLabel ?? approval?.requiredRoleId;
  useEffect(() => {
    const hasNewRun = Boolean(run?.runId && run.runId !== previousRunId.current);
    if (busy || run?.status === 'paused' || hasNewRun) setOpen(true);
    previousRunId.current = run?.runId;
  }, [busy, run?.runId, run?.status]);
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
        <button className="icon-control" disabled={!run} onClick={onExport} aria-label="Export audit"><Download size={15} /></button>
        <button className="icon-control" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse console' : 'Expand console'}>{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
      </header>
      {open ? (
        <div className="console-body">
          {run?.status === 'paused' ? (
            <div className="human-gate-bar">
              <div>
                <Clock3 size={17} />
                <span>
                  <strong>{wait ? wait.mode === 'timer' ? 'Timer wait' : wait.mode === 'event' ? 'Waiting for event' : 'Subgraph paused' : approval?.kind === 'tool' ? 'Tool approval required' : 'Human decision required'}{requiredRole ? ` · ${requiredRole}` : ''}</strong>
                  <small>{wait?.mode === 'timer'
                    ? `Durable until ${new Date(wait.resumeAt ?? '').toLocaleString()}.`
                    : wait?.mode === 'event'
                      ? `${wait.eventType} / correlation ${wait.correlationKey}`
                      : wait?.mode === 'subgraph'
                        ? 'The reusable subgraph has preserved its nested checkpoint.'
                        : approval?.actorAuthorized
                          ? `Assigned to ${requiredRole ?? 'a workspace reviewer'}. Approving as ${approval.actingActorName}.`
                          : `${approval?.actingActorName ?? 'Current actor'} is not assigned the required ${requiredRole ?? 'reviewer'} role.`}</small>
                </span>
              </div>
              {wait?.mode === 'timer' ? <div><button className="button primary" disabled={busy} onClick={onResume}><Clock3 size={14} />Resume if due</button></div> : wait ? null : <div>
                <button className="button secondary danger" disabled={busy || !approval?.actorAuthorized} onClick={() => onDecision(false)}><X size={14} />{approval?.kind === 'tool' ? 'Deny' : 'Reject'}</button>
                <button className="button primary" disabled={busy || !approval?.actorAuthorized} onClick={() => onDecision(true)}><Check size={14} />{approval?.kind === 'tool' ? 'Approve tool & resume' : 'Approve & resume'}</button>
              </div>}
            </div>
          ) : null}
          {tab === 'events' ? (
            <div className="event-stream">
              {events.length ? events.map((event) => {
                const summary = eventSummary(event);
                return (
                  <article key={`${event.runId}-${event.seq}`} className={event.type.startsWith('tool.') ? 'tool-event' : ''}>
                    <span className={`event-dot event-${eventTone(event.type)}`}><Circle size={8} /></span>
                    <time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time>
                    <strong>{eventLabel(event.type)}</strong>
                    <code>{event.nodeId ?? 'run'}</code>
                    <span title={summary}>{summary}</span>
                  </article>
                );
              }) : <ConsoleEmpty icon={<Circle size={18} />} title="Run the graph to stream events here." />}
            </div>
          ) : null}
          {tab === 'state' ? <pre className="json-output">{JSON.stringify(run?.state ?? {}, null, 2)}</pre> : null}
          {tab === 'output' ? (deliverable ? <div className="markdown-output">{artifacts.length > 0 ? <div className="portable-artifact-summary"><FileText size={15} /><span><strong>{artifacts.length} portable {artifacts.length === 1 ? 'artifact' : 'artifacts'}</strong><small>{artifactEvidenceCount} evidence records · SHA-256 bound</small></span></div> : null}<ReactMarkdown>{deliverable}</ReactMarkdown></div> : <ConsoleEmpty icon={<FileText size={19} />} title="No deliverable has been published yet." />) : null}
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
