import type {
  GraphDefinition,
  GraphEdge,
  GraphEvent,
  GraphNode,
  IndustryPackManifest,
  PackFixtureDefinition,
  StateField,
} from '@graph-workbench/contracts';

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
  executionMode: 'in-process' | 'isolated-container' | 'unsafe-process';
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
  compatibilityCode: 'compatible' | 'requires-newer-engine' | 'requires-older-engine' | 'unsupported-engine-range';
  compatibilityMessage: string;
  engineRange: string;
  permissions: Array<'handlers.execute' | 'context.write' | 'network' | 'filesystem'>;
}

export interface RegistryPackItem {
  id: string;
  name: string;
  description: string;
  license?: string;
  version: string;
  engineRange: string;
  compatible: boolean;
  compatibilityMessage: string;
  permissions: string[];
  installed: boolean;
  active: boolean;
}

export type RegistrySource = {
  id: string;
  name: string;
  url: string;
  status: 'verified';
  publisherKeyId: string;
  generatedAt: string;
  expiresAt: string;
  packs: RegistryPackItem[];
} | {
  id: string;
  name: string;
  url: string;
  status: 'error';
  error: string;
  packs: [];
};

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
  pendingApproval?: {
    kind: 'human' | 'tool';
    id: string;
    nodeId: string;
    toolId?: string;
    risk?: string;
    inputDigest?: string;
  };
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
  models: ModelProviderState;
}

export interface ModelProviderSelection {
  providerId: string;
  model: string;
  baseUrl?: string;
}

export interface ModelProviderItem {
  id: string;
  label: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv?: string;
  configured: boolean;
  selected: boolean;
  local: boolean;
  modelHint?: string;
}

export interface ModelProviderState {
  mode: 'deterministic' | 'model';
  selection: ModelProviderSelection;
  providers: ModelProviderItem[];
}

export interface ModelConnectionResult {
  ok: true;
  providerId: string;
  model: string;
  latencyMs: number;
  response: string;
}

export interface GraphValidation {
  valid: true;
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  entryNodeIds: string[];
}

export type PrimaryView = 'editor' | 'runs' | 'context' | 'models' | 'packs';
export type InspectorTab = 'node' | 'input' | 'policy';
