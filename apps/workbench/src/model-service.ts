import type { GraphDefinition } from '@graphwork/contracts';
import {
  createJsonModelAgent,
  ModelProviderClient,
  modelProviderPresets,
  type AgentAdapterRegistry,
  type ModelProviderPreset,
} from '@graphwork/core';
import type { StoredModelProvider } from './workspace-store.js';

export interface ModelProviderView {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly apiKeyEnv?: string;
  readonly configured: boolean;
  readonly selected: boolean;
  readonly local: boolean;
  readonly modelHint?: string;
}

export interface ModelProviderState {
  readonly mode: 'deterministic' | 'model';
  readonly selection: StoredModelProvider;
  readonly providers: readonly ModelProviderView[];
}

export interface ModelConnectionResult {
  readonly ok: true;
  readonly providerId: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly response: string;
}

const deterministicSelection: StoredModelProvider = {
  providerId: 'deterministic',
  model: '',
};

function findPreset(providerId: string): ModelProviderPreset {
  const preset = modelProviderPresets.find((item) => item.id === providerId);
  if (!preset) throw new Error(`Unknown model provider "${providerId}".`);
  return preset;
}

function resolvedSelection(selection?: StoredModelProvider): StoredModelProvider {
  return selection ?? deterministicSelection;
}

function configured(preset: ModelProviderPreset, environment: NodeJS.ProcessEnv): boolean {
  return !preset.apiKeyEnv || preset.apiKeyOptional === true || Boolean(environment[preset.apiKeyEnv]?.trim());
}

export class WorkbenchModelService {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly request: typeof fetch = fetch,
  ) {}

  describe(selection?: StoredModelProvider): ModelProviderState {
    const current = resolvedSelection(selection);
    return {
      mode: current.providerId === 'deterministic' ? 'deterministic' : 'model',
      selection: current,
      providers: [
        {
          id: 'deterministic',
          label: 'Built-in deterministic runtime',
          protocol: 'local',
          baseUrl: '',
          configured: true,
          selected: current.providerId === 'deterministic',
          local: true,
        },
        ...modelProviderPresets.map((preset) => ({
          id: preset.id,
          label: preset.label,
          protocol: preset.protocol,
          baseUrl: current.providerId === preset.id && current.baseUrl
            ? current.baseUrl
            : preset.baseUrl,
          ...(preset.apiKeyEnv ? { apiKeyEnv: preset.apiKeyEnv } : {}),
          configured: configured(preset, this.environment),
          selected: current.providerId === preset.id,
          local: preset.local === true,
          ...(preset.modelHint ? { modelHint: preset.modelHint } : {}),
        })),
      ],
    };
  }

  validate(selection: StoredModelProvider): StoredModelProvider {
    if (selection.providerId === 'deterministic') return deterministicSelection;
    const preset = findPreset(selection.providerId);
    const model = selection.model.trim();
    if (!model) throw new Error(`${preset.label} requires a model name.`);
    const baseUrl = (selection.baseUrl ?? preset.baseUrl).trim();
    if (!baseUrl) throw new Error(`${preset.label} requires a base URL.`);
    if (preset.apiKeyEnv && preset.id !== 'custom' && baseUrl !== preset.baseUrl) {
      throw new Error(`${preset.label} credentials may only be sent to the built-in endpoint ${preset.baseUrl}.`);
    }
    new ModelProviderClient({
      id: preset.id,
      label: preset.label,
      protocol: preset.protocol,
      baseUrl,
    }, this.request);
    return {
      providerId: preset.id,
      model,
      ...(baseUrl !== preset.baseUrl ? { baseUrl } : {}),
    };
  }

  agents(selection: StoredModelProvider | undefined, graph: GraphDefinition): AgentAdapterRegistry {
    const current = resolvedSelection(selection);
    if (current.providerId === 'deterministic') return {};
    const client = this.client(current);
    const adapter = createJsonModelAgent(client, { model: current.model, maxOutputTokens: 2_048 });
    return Object.fromEntries(
      graph.nodes
        .filter((node) => node.kind === 'agent' && node.handler && typeof node.config.modelInstructions === 'string')
        .map((node) => [node.handler!, adapter]),
    );
  }

  async test(selection?: StoredModelProvider): Promise<ModelConnectionResult> {
    const current = resolvedSelection(selection);
    if (current.providerId === 'deterministic') {
      return { ok: true, providerId: 'deterministic', model: 'built-in', latencyMs: 0, response: 'ready' };
    }
    const result = await this.client(current).generate({
      model: current.model,
      system: 'You are a connection health check.',
      prompt: 'Reply with the single word ready.',
      maxOutputTokens: 16,
    });
    return {
      ok: true,
      providerId: current.providerId,
      model: result.usage.model ?? current.model,
      latencyMs: result.usage.latencyMs ?? 0,
      response: result.text.slice(0, 80),
    };
  }

  private client(selection: StoredModelProvider): ModelProviderClient {
    const validated = this.validate(selection);
    const preset = findPreset(validated.providerId);
    const apiKey = preset.apiKeyEnv ? this.environment[preset.apiKeyEnv]?.trim() : undefined;
    if (preset.apiKeyEnv && !preset.apiKeyOptional && !apiKey) {
      throw new Error(`${preset.label} is not configured. Set ${preset.apiKeyEnv} and restart the Workbench.`);
    }
    return new ModelProviderClient({
      id: preset.id,
      label: preset.label,
      protocol: preset.protocol,
      baseUrl: validated.baseUrl ?? preset.baseUrl,
      ...(apiKey ? { apiKey } : {}),
    }, this.request);
  }
}
