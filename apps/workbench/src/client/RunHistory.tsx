import { CheckCircle2, Clock3, PlayCircle, XCircle } from 'lucide-react';
import type { RunSnapshot } from './types.js';

const statusIcon = {
  running: PlayCircle,
  paused: Clock3,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};

export function RunHistory({ runs, selectedRunId, onSelect }: {
  runs: RunSnapshot[];
  selectedRunId: string | undefined;
  onSelect: (run: RunSnapshot) => void;
}) {
  return (
    <main className="library-view">
      <div className="view-heading"><div><h1>Runs</h1><p>Replay execution events, decisions, outputs and projected context.</p></div></div>
      <div className="run-table">
        <div className="run-table-head"><span>Status</span><span>Run</span><span>Pack / graph</span><span>Events</span><span>Started</span></div>
        {runs.length ? runs.map((run) => {
          const Icon = statusIcon[run.status];
          return (
            <button key={run.runId} className={selectedRunId === run.runId ? 'selected' : ''} onClick={() => onSelect(run)}>
              <span className={`run-table-status status-${run.status}`}><Icon size={15} />{run.status}</span>
              <code>{run.runId}</code>
              <span>{run.packId}<small>{run.graphId}</small></span>
              <span>{run.events.length}</span>
              <time>{run.events[0] ? new Date(run.events[0].timestamp).toLocaleString() : '—'}</time>
            </button>
          );
        }) : <div className="view-empty"><PlayCircle size={24} /><strong>No runs yet</strong><p>Open the editor and run an installed Pack.</p></div>}
      </div>
    </main>
  );
}
