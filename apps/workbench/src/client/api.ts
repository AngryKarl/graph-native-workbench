import type { PackDescription, ProjectInput, RunSnapshot } from './types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

export function loadPack(): Promise<PackDescription> {
  return request('/api/pack');
}

export function startRun(input: ProjectInput): Promise<RunSnapshot> {
  return request('/api/runs', { method: 'POST', body: JSON.stringify({ input }) });
}

export function decideRun(runId: string, approved: boolean): Promise<RunSnapshot> {
  return request(`/api/runs/${encodeURIComponent(runId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved }),
  });
}
