import type {
  GraphDefinition,
  GraphPosition,
  GraphValidation,
  ModelConnectionResult,
  ModelProviderSelection,
  PackArtifactPreview,
  PackDescription,
  RegistrySource,
  RunSnapshot,
  WorkbenchBootstrap,
} from './types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

async function artifactRequest<T>(path: string, file: File, trust = false): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/vnd.graphwork.gpack',
      ...(trust ? { 'x-graphwork-trust': 'true' } : {}),
    },
    body: file,
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

export function loadWorkbench(): Promise<WorkbenchBootstrap> {
  return request('/api/workbench');
}

export function configureModelProvider(selection: ModelProviderSelection): Promise<WorkbenchBootstrap> {
  return request('/api/model-provider', {
    method: 'PUT',
    body: JSON.stringify(selection),
  });
}

export function testModelProvider(): Promise<ModelConnectionResult> {
  return request('/api/model-provider/test', { method: 'POST' });
}

export function loadRegistries(): Promise<RegistrySource[]> {
  return request('/api/registries');
}

export function installRegistryPack(registryId: string, packId: string, version: string): Promise<WorkbenchBootstrap> {
  return request(`/api/registries/${encodeURIComponent(registryId)}/packs/${encodeURIComponent(packId)}/${encodeURIComponent(version)}/install`, {
    method: 'POST',
  });
}

export function loadPack(packId: string): Promise<PackDescription> {
  return request(`/api/packs/${encodeURIComponent(packId)}`);
}

export function installPack(packId: string): Promise<WorkbenchBootstrap> {
  return request(`/api/packs/${encodeURIComponent(packId)}/install`, { method: 'POST' });
}

export function uninstallPack(packId: string): Promise<WorkbenchBootstrap> {
  return request(`/api/packs/${encodeURIComponent(packId)}/install`, { method: 'DELETE' });
}

export function activatePack(packId: string): Promise<WorkbenchBootstrap> {
  return request(`/api/packs/${encodeURIComponent(packId)}/activate`, { method: 'POST' });
}

export function inspectPackArtifact(file: File): Promise<PackArtifactPreview> {
  return artifactRequest('/api/packs/artifact/inspect', file);
}

export function installPackArtifact(file: File): Promise<WorkbenchBootstrap> {
  return artifactRequest('/api/packs/artifact/install', file, true);
}

export function validateGraph(packId: string, graph: GraphDefinition): Promise<GraphValidation> {
  return request('/api/graphs/validate', {
    method: 'POST',
    body: JSON.stringify({ packId, graph }),
  });
}

export function saveGraphDraft(
  packId: string,
  graph: GraphDefinition,
  positions: Record<string, GraphPosition>,
): Promise<PackDescription> {
  return request(`/api/packs/${encodeURIComponent(packId)}/graphs/${encodeURIComponent(graph.id)}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ graph, positions }),
  });
}

export function resetGraphDraft(packId: string, graphId: string): Promise<PackDescription> {
  return request(`/api/packs/${encodeURIComponent(packId)}/graphs/${encodeURIComponent(graphId)}/draft`, {
    method: 'DELETE',
  });
}

export function startRun(
  packId: string,
  graphId: string,
  input: Record<string, unknown>,
): Promise<RunSnapshot> {
  return request('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ packId, graphId, input }),
  });
}

export function decideRun(runId: string, approved: boolean): Promise<RunSnapshot> {
  return request(`/api/runs/${encodeURIComponent(runId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });
}

export async function downloadRunAudit(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/audit`);
  if (!response.ok) {
    const value = await response.json() as { error?: string };
    throw new Error(value.error ?? `Audit export failed (${response.status}).`);
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${runId}.audit.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
