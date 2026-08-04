export interface EvidenceInput {
  source: string;
  locator: string;
  claim: string;
}

export interface ProjectInput {
  project_name: string;
  project_type: string;
  output_language: string;
  site_context: string;
  client_goals: string[];
  constraints: string[];
  evidence: EvidenceInput[];
}

export interface PackNode {
  id: string;
  kind: string;
  label: string;
  description: string;
}

export interface PackDescription {
  id: string;
  name: string;
  version: string;
  graph: {
    id: string;
    nodes: PackNode[];
    edges: Array<{ id: string; source: string; target: string }>;
  };
  input: ProjectInput;
}

export interface GraphEventView {
  runId: string;
  seq: number;
  timestamp: string;
  type: string;
  nodeId?: string;
  detail: Record<string, unknown>;
}

export interface ContextObjectView {
  id: string;
  type: string;
  data: Record<string, unknown>;
  provenance: {
    sourceIds: string[];
    producedByRunId?: string;
    producedByNodeId?: string;
    actorId: string;
  };
}

export interface ContextRelationView {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
}

export interface RunSnapshot {
  runId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  state: Record<string, unknown>;
  events: GraphEventView[];
  error?: string;
  context?: {
    objects: ContextObjectView[];
    relations: ContextRelationView[];
  };
}

export type StageId = 'input' | 'evidence' | 'analysis' | 'directions' | 'review';
