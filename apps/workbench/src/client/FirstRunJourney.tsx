import { Check, Circle, FileCheck2, Network, Play, ShieldCheck } from 'lucide-react';
import type { PackDescription, RunSnapshot } from './types.js';

function resolvedHumanDecisions(run: RunSnapshot | null): number {
  return run?.events.filter((event) => event.type === 'human.resolved').length ?? 0;
}

export function FirstRunJourney({ pack, run, deliverable, busy, onRun, onContext }: {
  pack: PackDescription;
  run: RunSnapshot | null;
  deliverable: string;
  busy: boolean;
  onRun: () => void;
  onContext: () => void;
}) {
  const approvalCount = resolvedHumanDecisions(run);
  const expectedApprovals = pack.graph.nodes.filter((node) => node.kind === 'human').length;
  const completed = run?.status === 'completed';
  const reusedPriorContext = (run?.state.release_context as { linked?: boolean } | undefined)?.linked === true;
  const journeyMessage = pack.graph.id === 'software_delivery.observe_deployment'
    ? 'Verify deployment health against the approved release context.'
    : pack.id === 'software_delivery'
      ? 'See exactly why a change is safe to release.'
      : `See ${pack.name} produce a governed outcome.`;
  const steps = [
    { label: 'Sample ready', detail: pack.fixtures[0]?.label ?? 'Bundled fixture', done: true },
    { label: 'Run the workflow', detail: run ? `${run.events.length} traceable events` : 'Zero-key deterministic run', done: Boolean(run) },
    { label: 'Review decisions', detail: expectedApprovals ? `${approvalCount} of ${expectedApprovals} accountable gates` : 'Policy checks', done: completed },
    { label: 'Reuse the outcome', detail: reusedPriorContext ? 'Prior release context reused' : deliverable ? 'Artifact and context are ready' : 'Artifact + context graph', done: Boolean(deliverable) },
  ];

  return (
    <section className="first-run-journey" aria-label="Guided sample journey">
      <div className="journey-intro">
        <span className="journey-kicker">60-second guided run</span>
        <strong>{journeyMessage}</strong>
      </div>
      <ol>
        {steps.map((step, index) => {
          const active = !step.done && (index === 1 ? !run : index === 2 ? run?.status === 'paused' : completed);
          return <li key={step.label} className={step.done ? 'done' : active ? 'active' : ''}>
            <span className="journey-step-icon">{step.done ? <Check size={13} /> : active ? <Circle size={10} fill="currentColor" /> : <Circle size={10} />}</span>
            <span><strong>{step.label}</strong><small>{step.detail}</small></span>
          </li>;
        })}
      </ol>
      {!run || run.status === 'failed' || run.status === 'cancelled' ? (
        <button className="button primary journey-action" disabled={busy} onClick={onRun}><Play size={14} fill="currentColor" />Run sample</button>
      ) : run.status === 'paused' ? (
        <span className="journey-status"><ShieldCheck size={16} />Review packet below</span>
      ) : deliverable ? (
        <button className="button secondary journey-action" onClick={onContext}><Network size={15} />Explore why</button>
      ) : (
        <span className="journey-status"><FileCheck2 size={16} />Preparing outcome</span>
      )}
    </section>
  );
}
