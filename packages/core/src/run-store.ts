import type {
  GraphCheckpoint,
  GraphEvent,
  GraphRunRecord,
  GraphRunStatus,
} from '@graph-native/contracts';
import type { GraphState } from './state.js';

export interface RunUpdate {
  readonly status: GraphRunStatus;
  readonly state: GraphState;
  readonly error?: string | null;
}

export interface RunStore {
  createRun(run: GraphRunRecord): Promise<void>;
  updateRun(runId: string, update: RunUpdate): Promise<void>;
  getRun(runId: string): Promise<GraphRunRecord | undefined>;
  appendEvent(event: GraphEvent): Promise<void>;
  listEvents(runId: string): Promise<readonly GraphEvent[]>;
  saveCheckpoint(checkpoint: GraphCheckpoint): Promise<void>;
  getCheckpoint(runId: string): Promise<GraphCheckpoint | undefined>;
  clearCheckpoint(runId: string): Promise<void>;
}
