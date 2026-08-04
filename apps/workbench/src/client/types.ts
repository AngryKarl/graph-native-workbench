import type {
  GraphDefinition,
  GraphEdge,
  GraphEvent,
  GraphNode,
  IndustryPackManifest,
  PackFixtureDefinition,
  StateField,
} from '@graph-native/contracts';

export type {
  GraphDefinition,
  GraphEdge,
  GraphEvent,
  GraphNode,
  IndustryPackManifest,
  PackFixtureDefinition,
  StateField,
};

export interface GraphPosition {
  x: number;
  y: number;
}

export interface PackDescription {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  manifest: IndustryPackManifest;
  graph: GraphDefinition;
  positions: Record<string, GraphPosition>;
  input: Record<string, unknown>;
  fixtures: PackFixtureDefinition[];
  handlers: string[];
}

export interface PackCatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  installed: boolean;
  executable: boolean;
  graphCount: number;
  objectTypeCount: number;
  roleCount: number;
  toolCount: number;
  executionMode: 'in-process' | 'isolated-worker';
  trustSource: 'bundled' | 'local-explicit' | 'signed-registry';
  publisherKeyId?: string;
}

export interface PackArtifactPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  bytes: number;
  checksum: string;
  compatible: boolean;
  engineRange: string;
  permissions: Array<'handlers.execute' | 'context.write' | 'network' | 'filesystem'>;
}

export interface ContextObjectView {
  id: string;
  type: string;
  status: string;
  data: Record<string, unknown>;
  provenance: {
    sourceIds: string[];
    producedByRunId?: string;
    producedByNodeId?: string;
    actorId: string;
    recordedAt: string;
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
  packId: string;
  graphId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  state: Record<string, unknown>;
  events: GraphEvent[];
  error?: string;
  context?: {
    objects: ContextObjectView[];
    relations: ContextRelationView[];
  };
}

export interface WorkbenchBootstrap {
  activePackId: string;
  installedPackIds: string[];
  catalog: PackCatalogItem[];
  activePack: PackDescription;
  runs: RunSnapshot[];
}

export interface GraphValidation {
  valid: true;
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  entryNodeIds: string[];
}

export type PrimaryView = 'editor' | 'runs' | 'context' | 'packs';
export type InspectorTab = 'node' | 'input' | 'policy';
