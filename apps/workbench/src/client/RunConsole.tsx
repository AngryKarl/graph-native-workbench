import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Circle, Clock3, Download, FileText, Network, ShieldCheck, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { GraphEvent, RunSnapshot } from './types.js';

type ConsoleTab = 'review' | 'outcome' | 'context' | 'advanced';

interface ReviewPacket {
  recommendation?: string;
  checks: string[];
  risks: string[];
  evidence: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' · ');
}

function shortValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
    return value.map(String).join(', ');
  }
  return undefined;
}

function collectNamedStrings(value: unknown, names: RegExp, output: string[], depth = 0): void {
  if (depth > 3 || output.length >= 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedStrings(item, names, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (names.test(key)) {
      if (typeof item === 'string') output.push(item);
      else if (Array.isArray(item)) {
        for (const entry of item) {
          if (typeof entry === 'string') output.push(entry);
          else if (isRecord(entry)) {
            const text = shortValue(entry.name ?? entry.title ?? entry.statement ?? entry.claim ?? entry.message);
            if (text) output.push(text);
          }
        }
      }
    }
    collectNamedStrings(item, names, output, depth + 1);
    if (output.length >= 8) return;
  }
}

function resolveRecommendation(state: Record<string, unknown>): string | undefined {
  let recommendation: unknown;
  for (const [key, value] of Object.entries(state)) {
    if (/recommended|recommendation|selected_direction|preferred/i.test(key)) recommendation = value;
    if (isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (/recommended|recommendation|selected_direction|preferred/i.test(nestedKey)) recommendation = nestedValue;
      }
    }
  }
  const id = shortValue(recommendation);
  if (!id) return undefined;
  for (const value of Object.values(state)) {
    if (!Array.isArray(value)) continue;
    const match = value.find((item) => isRecord(item) && String(item.id ?? item.key ?? '') === id);
    if (isRecord(match)) {
      const label = shortValue(match.name ?? match.title ?? match.label);
      if (label && label !== id) return `${label} (${humanize(id)})`;
    }
  }
  return humanize(id);
}

function buildReviewPacket(run: RunSnapshot | null): ReviewPacket {
  if (!run) return { checks: [], risks: [], evidence: [] };
  const checks: string[] = [];
  for (const [key, value] of Object.entries(run.state)) {
    if (!/(review|quality|audit|validation|check|evaluation|score|status)/i.test(key)) continue;
    const direct = shortValue(value);
    if (direct) checks.push(`${humanize(key)}: ${direct}`);
    else if (isRecord(value)) {
      const summary = Object.entries(value)
        .filter(([nestedKey]) => /(passed|status|score|count|total|gaps)/i.test(nestedKey))
        .map(([nestedKey, nestedValue]) => {
          const display = shortValue(nestedValue);
          return display ? `${humanize(nestedKey)} ${display}` : undefined;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 4)
        .join(' · ');
      if (summary) checks.push(`${humanize(key)}: ${summary}`);
    }
  }

  const risks: string[] = [];
  const riskAssessment = run.state.risk_assessment;
  if (isRecord(riskAssessment)) {
    const level = shortValue(riskAssessment.level ?? riskAssessment.status);
    const score = shortValue(riskAssessment.score);
    const reasons = shortValue(riskAssessment.reasons);
    if (level || score || reasons) risks.push(`Risk ${level ?? 'assessed'}${score ? ` (${score}/100)` : ''}${reasons ? ` · ${reasons}` : ''}`);
  }
  collectNamedStrings(run.state, /(risk|constraint|warning|gap)(?:_|s?$)/i, risks);

  const evidence: string[] = [];
  const stateEvidence = run.state.evidence;
  if (Array.isArray(stateEvidence)) {
    evidence.push(`${stateEvidence.length} attributable source ${stateEvidence.length === 1 ? 'record' : 'records'}`);
    for (const item of stateEvidence.slice(0, 3)) {
      if (!isRecord(item)) continue;
      const claim = shortValue(item.claim ?? item.statement ?? item.title);
      const source = shortValue(item.source ?? item.locator);
      if (claim) evidence.push(source ? `${source}: ${claim}` : claim);
    }
  }
  for (const [key, value] of Object.entries(run.state)) {
    if (!/(evidence|verification|test|check)/i.test(key) || !Array.isArray(value)) continue;
    for (const item of value) {
      if (!isRecord(item)) continue;
      const label = shortValue(item.type ?? item.name ?? item.check_id ?? item.title);
      const summary = shortValue(item.summary ?? item.claim ?? item.statement ?? item.status);
      const locator = shortValue(item.evidence_uri ?? item.source ?? item.locator ?? item.url);
      if (summary) evidence.push(`${label ? `${humanize(label)}: ` : ''}${summary}${locator ? ` · ${locator}` : ''}`);
    }
  }
  const artifactEvidence = (run.artifacts ?? []).reduce((count, artifact) => count + artifact.evidence.length, 0);
  if (artifactEvidence) evidence.unshift(`${artifactEvidence} evidence records are bound to portable artifacts`);

  const recommendation = resolveRecommendation(run.state);
  return {
    ...(recommendation ? { recommendation } : {}),
    checks: [...new Set(checks)].slice(0, 6),
    risks: [...new Set(risks)].slice(0, 6),
    evidence: [...new Set(evidence)].slice(0, 5),
  };
}

function eventLabel(type: string): string {
  return humanize(type);
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
    return event.detail.requiredRoleId ? `Assigned to role ${String(event.detail.requiredRoleId)}` : 'Human decision requested';
  }
  if (event.type === 'human.resolved') {
    return event.detail.resolvedByActorName ? `Resolved by ${String(event.detail.resolvedByActorName)}` : 'Human decision resolved';
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

function defaultTab(run: RunSnapshot | null): ConsoleTab {
  if (run?.status === 'paused' && !run.pendingWait) return 'review';
  if (run?.status === 'completed') return 'outcome';
  return 'advanced';
}

export function RunConsole({ run, deliverable, busy, onDecision, onResume, onExport, onViewContext }: {
  run: RunSnapshot | null;
  deliverable: string;
  busy: boolean;
  onDecision: (approved: boolean) => void;
  onResume: () => void;
  onExport: () => void;
  onViewContext?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(run && (run.status === 'paused' || run.status === 'completed')));
  const [tab, setTab] = useState<ConsoleTab>(() => defaultTab(run));
  const previousRunId = useRef(run?.runId);
  const artifacts = run?.artifacts ?? [];
  const artifactEvidenceCount = artifacts.reduce((total, artifact) => total + artifact.evidence.length, 0);
  const events = useMemo(() => [...(run?.events ?? [])].reverse(), [run?.events]);
  const reviewPacket = useMemo(() => buildReviewPacket(run), [run]);
  const approval = run?.pendingApproval;
  const wait = run?.pendingWait;
  const requiredRole = approval?.requiredRoleLabel ?? approval?.requiredRoleId;

  useEffect(() => {
    const hasNewRun = Boolean(run?.runId && run.runId !== previousRunId.current);
    if (run?.status === 'paused' && !wait) setTab('review');
    else if (run?.status === 'completed') setTab('outcome');
    else if (hasNewRun) setTab('advanced');
    if (busy || run?.status === 'paused' || run?.status === 'completed' || hasNewRun) setOpen(true);
    previousRunId.current = run?.runId;
  }, [busy, run?.runId, run?.status, wait]);

  const tabs: Array<{ id: ConsoleTab; label: string }> = [
    ...(run?.status === 'paused' && !wait ? [{ id: 'review' as const, label: 'Review' }] : []),
    ...((deliverable || run?.status === 'completed') ? [{ id: 'outcome' as const, label: 'Outcome' }] : []),
    { id: 'context', label: 'Context' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return (
    <section className={`run-console ${open ? 'is-open' : ''}`}>
      <header>
        <div className="console-title">
          <span className={`run-light status-${run?.status ?? 'idle'}`} />
          <strong>{run?.status === 'paused' && !wait ? 'Review required' : run?.status === 'completed' ? 'Run outcome' : 'Execution console'}</strong>
          <span>{run ? `${run.status} · ${run.events.length} events` : 'No active run'}</span>
        </div>
        <div className="console-tabs" role="tablist" aria-label="Run details">
          {tabs.map(({ id, label }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setOpen(true); }}>{label}</button>
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
                          ? `Assigned to ${requiredRole ?? 'a workspace reviewer'}. Reviewing as ${approval.actingActorName}.`
                          : `${approval?.actingActorName ?? 'Current actor'} is not assigned the required ${requiredRole ?? 'reviewer'} role.`}</small>
                </span>
              </div>
              {wait?.mode === 'timer' ? <div><button className="button primary" disabled={busy} onClick={onResume}><Clock3 size={14} />Resume if due</button></div> : wait ? null : <div>
                <button className="button secondary danger" disabled={busy || !approval?.actorAuthorized} onClick={() => onDecision(false)}><X size={14} />{approval?.kind === 'tool' ? 'Deny' : 'Reject'}</button>
                <button className="button primary" disabled={busy || !approval?.actorAuthorized} onClick={() => onDecision(true)}><Check size={14} />{approval?.kind === 'tool' ? 'Approve tool & resume' : 'Approve & resume'}</button>
              </div>}
            </div>
          ) : null}

          {tab === 'review' ? (
            <div className="review-packet" role="tabpanel">
              <div className="portable-artifact-summary"><ShieldCheck size={15} /><span><strong>Review packet</strong><small>Decision, checks, risks and evidence prepared from this checkpoint</small></span></div>
              <div className="review-packet-grid">
                <section><span>Decision</span><strong>{approval?.toolId ? humanize(approval.toolId) : humanize(approval?.nodeId ?? 'pending work')}</strong><p>{requiredRole ?? 'Assigned reviewer'} must approve this checkpoint.</p></section>
                <section><span>Recommendation</span><strong>{reviewPacket.recommendation ?? 'Decide from the governed checks'}</strong><p>{approval?.risk ? `Declared risk: ${humanize(approval.risk)}` : 'No separate model recommendation overrides the accountable reviewer.'}</p></section>
                <section><span>Checks</span><strong>{reviewPacket.checks[0] ?? 'No explicit check summary'}</strong>{reviewPacket.checks.length > 1 ? <details><summary>{reviewPacket.checks.length - 1} more checks</summary><ul>{reviewPacket.checks.slice(1).map((item) => <li key={item}>{item}</li>)}</ul></details> : null}</section>
                <section><span>Risks</span><strong>{reviewPacket.risks[0] ?? 'No unresolved risk declared'}</strong>{reviewPacket.risks.length > 1 ? <details><summary>{reviewPacket.risks.length - 1} more risks</summary><ul>{reviewPacket.risks.slice(1).map((item) => <li key={item}>{item}</li>)}</ul></details> : null}</section>
                <section className="review-evidence"><span>Evidence</span><strong>{reviewPacket.evidence[0] ?? 'No attributable evidence summary'}</strong>{reviewPacket.evidence.length > 1 ? <details><summary>{reviewPacket.evidence.length - 1} more evidence records</summary><ul>{reviewPacket.evidence.slice(1).map((item) => <li key={item}>{item}</li>)}</ul></details> : null}</section>
              </div>
            </div>
          ) : null}

          {tab === 'outcome' ? (deliverable ? (
            <div className="markdown-output" role="tabpanel">
              <div className="portable-artifact-summary"><FileText size={15} /><span><strong>{artifacts.length || 1} completed {artifacts.length === 1 ? 'artifact' : 'artifacts'}</strong><small>{artifactEvidenceCount} evidence records · SHA-256 bound</small></span></div>
              {run?.context && onViewContext ? <button className="button secondary" onClick={onViewContext}><Network size={14} />View context</button> : null}
              <ReactMarkdown>{deliverable}</ReactMarkdown>
            </div>
          ) : <ConsoleEmpty icon={<FileText size={19} />} title="The run completed without a published deliverable." />) : null}

          {tab === 'context' ? (run?.context ? (
            <div className="context-summary" role="tabpanel"><Network size={22} /><strong>{run.context.objects.length} confirmed objects</strong><span>{run.context.relations.length} relations were projected by this run.</span>{onViewContext ? <button className="button secondary" onClick={onViewContext}>Explore context</button> : null}</div>
          ) : <ConsoleEmpty icon={<Network size={19} />} title="Approve a completed run to project its context graph." />) : null}

          {tab === 'advanced' ? (
            <div className="markdown-output" role="tabpanel">
              <details open>
                <summary><strong>Execution events ({events.length})</strong></summary>
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
              </details>
              <details>
                <summary><strong>Raw state</strong></summary>
                <pre className="json-output">{JSON.stringify(run?.state ?? {}, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConsoleEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="console-empty">{icon}<span>{title}</span></div>;
}
