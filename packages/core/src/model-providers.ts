import type { AgentAdapter, AgentContext, AgentUsage } from './adapters.js';
import type { GraphState } from './state.js';

export type ModelProtocol =
  | 'openai-compatible'
  | 'anthropic-messages'
  | 'gemini-generate-content';

export interface ModelProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly protocol: ModelProtocol;
  readonly baseUrl: string;
  readonly apiKeyEnv?: string;
  readonly apiKeyOptional?: boolean;
  readonly local?: boolean;
  readonly modelHint?: string;
}

export const modelProviderPresets: readonly ModelProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  { id: 'anthropic', label: 'Anthropic Claude', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  { id: 'gemini', label: 'Google Gemini', protocol: 'gemini-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  { id: 'qwen', label: 'Alibaba Qwen', protocol: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'kimi', label: 'Moonshot Kimi', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY' },
  { id: 'xai', label: 'xAI Grok', protocol: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY' },
  { id: 'mistral', label: 'Mistral AI', protocol: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' },
  { id: 'groq', label: 'Groq', protocol: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
  { id: 'ollama', label: 'Ollama', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true, modelHint: 'qwen3:8b' },
  { id: 'custom', label: 'Custom compatible endpoint', protocol: 'openai-compatible', baseUrl: '', apiKeyEnv: 'GRAPHWORK_MODEL_API_KEY', apiKeyOptional: true },
];

export interface ModelProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly protocol: ModelProtocol;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface ModelGenerateRequest {
  readonly model: string;
  readonly prompt: string;
  readonly system?: string;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface ModelGenerateResult {
  readonly text: string;
  readonly usage: AgentUsage;
}

export type ModelProviderErrorCode =
  | 'invalid_configuration'
  | 'authentication'
  | 'rate_limit'
  | 'provider_error'
  | 'invalid_response'
  | 'request_cancelled'
  | 'network_error';

export class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly code: ModelProviderErrorCode,
    readonly providerId: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelProviderError';
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function responseErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === 'object') {
    const message = nonEmpty((nested as Record<string, unknown>).message);
    if (message) return message;
  }
  return nonEmpty(record.message) ?? fallback;
}

function safeProviderMessage(provider: ModelProviderConfig, message: string): string {
  return provider.apiKey ? message.split(provider.apiKey).join('[redacted]') : message;
}

async function readJson(response: Response, provider: ModelProviderConfig): Promise<unknown> {
  const raw = await response.text();
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) {
      throw new ModelProviderError(
        `${provider.label} returned HTTP ${response.status}.`,
        response.status === 401 || response.status === 403 ? 'authentication' : 'provider_error',
        provider.id,
        response.status,
      );
    }
    throw new ModelProviderError(`${provider.label} returned invalid JSON.`, 'invalid_response', provider.id);
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? 'authentication'
      : response.status === 429
        ? 'rate_limit'
        : 'provider_error';
    throw new ModelProviderError(
      `${provider.label}: ${safeProviderMessage(provider, responseErrorMessage(value, `HTTP ${response.status}`))}`,
      code,
      provider.id,
      response.status,
    );
  }
  return value;
}

function requireText(value: unknown, provider: ModelProviderConfig): string {
  const text = nonEmpty(value);
  if (!text) throw new ModelProviderError(`${provider.label} returned no text output.`, 'invalid_response', provider.id);
  return text;
}

export class ModelProviderClient {
  constructor(
    readonly config: ModelProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!config.baseUrl.trim()) {
      throw new ModelProviderError(`${config.label} requires a base URL.`, 'invalid_configuration', config.id);
    }
    let parsed: URL;
    try {
      parsed = new URL(config.baseUrl);
    } catch {
      throw new ModelProviderError(`${config.label} has an invalid base URL.`, 'invalid_configuration', config.id);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ModelProviderError(`${config.label} base URL must use HTTP or HTTPS.`, 'invalid_configuration', config.id);
    }
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (config.apiKey && parsed.protocol !== 'https:' && !localHost) {
      throw new ModelProviderError(
        `${config.label} requires HTTPS when an API key is configured.`,
        'invalid_configuration',
        config.id,
      );
    }
  }

  async generate(input: ModelGenerateRequest): Promise<ModelGenerateResult> {
    if (!input.model.trim()) {
      throw new ModelProviderError(`${this.config.label} requires a model name.`, 'invalid_configuration', this.config.id);
    }
    const startedAt = Date.now();
    try {
      const result = this.config.protocol === 'anthropic-messages'
        ? await this.anthropic(input)
        : this.config.protocol === 'gemini-generate-content'
          ? await this.gemini(input)
          : await this.openAiCompatible(input);
      return {
        text: result.text,
        usage: {
          providerId: this.config.id,
          protocol: this.config.protocol,
          model: result.model ?? input.model,
          ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
          ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
          ...(result.totalTokens !== undefined ? { totalTokens: result.totalTokens } : {}),
          ...(result.requestId ? { requestId: result.requestId } : {}),
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      if (input.signal?.aborted) {
        throw new ModelProviderError(`${this.config.label} request was cancelled.`, 'request_cancelled', this.config.id);
      }
      throw new ModelProviderError(
        `${this.config.label} request failed: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        this.config.id,
      );
    }
  }

  private async openAiCompatible(input: ModelGenerateRequest) {
    const response = await this.request(endpoint(this.config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.prompt },
        ],
        stream: false,
        ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = await readJson(response, this.config) as Record<string, unknown>;
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const message = choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as Record<string, unknown>).message
      : undefined;
    const usage = value.usage && typeof value.usage === 'object'
      ? value.usage as Record<string, unknown>
      : {};
    return {
      text: requireText(message && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined, this.config),
      model: nonEmpty(value.model),
      requestId: nonEmpty(value.id),
      inputTokens: numberValue(usage.prompt_tokens),
      outputTokens: numberValue(usage.completion_tokens),
      totalTokens: numberValue(usage.total_tokens),
    };
  }

  private async anthropic(input: ModelGenerateRequest) {
    const response = await this.request(endpoint(this.config.baseUrl, 'messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 2_048,
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: 'user', content: input.prompt }],
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = await readJson(response, this.config) as Record<string, unknown>;
    const content = Array.isArray(value.content) ? value.content : [];
    const text = content
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .filter((item) => item.type === 'text')
      .map((item) => nonEmpty(item.text) ?? '')
      .join('\n');
    const usage = value.usage && typeof value.usage === 'object'
      ? value.usage as Record<string, unknown>
      : {};
    const inputTokens = numberValue(usage.input_tokens);
    const outputTokens = numberValue(usage.output_tokens);
    return {
      text: requireText(text, this.config),
      model: nonEmpty(value.model),
      requestId: nonEmpty(value.id),
      inputTokens,
      outputTokens,
      ...(inputTokens !== undefined && outputTokens !== undefined
        ? { totalTokens: inputTokens + outputTokens }
        : {}),
    };
  }

  private async gemini(input: ModelGenerateRequest) {
    const model = encodeURIComponent(input.model.trim());
    const response = await this.request(endpoint(this.config.baseUrl, `models/${model}:generateContent`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        },
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = await readJson(response, this.config) as Record<string, unknown>;
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const content = candidates[0] && typeof candidates[0] === 'object'
      ? (candidates[0] as Record<string, unknown>).content
      : undefined;
    const parts = content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : [];
    const text = parts
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => nonEmpty(item.text) ?? '')
      .join('\n');
    const usage = value.usageMetadata && typeof value.usageMetadata === 'object'
      ? value.usageMetadata as Record<string, unknown>
      : {};
    return {
      text: requireText(text, this.config),
      model: nonEmpty(value.modelVersion),
      requestId: nonEmpty(value.responseId),
      inputTokens: numberValue(usage.promptTokenCount),
      outputTokens: numberValue(usage.candidatesTokenCount),
      totalTokens: numberValue(usage.totalTokenCount),
    };
  }
}

function parseJsonPatch(text: string, providerId: string): GraphState {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new ModelProviderError('Model output did not contain a JSON object.', 'invalid_response', providerId);
  }
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
    return value as GraphState;
  } catch (error) {
    throw new ModelProviderError(
      `Model output was not a valid state patch: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_response',
      providerId,
    );
  }
}

function stateInput(context: AgentContext): Record<string, unknown> {
  return Object.fromEntries(context.node.reads.map((field) => [field, context.state[field]]));
}

export function createJsonModelAgent(
  client: ModelProviderClient,
  options: { readonly model: string; readonly maxOutputTokens?: number },
): AgentAdapter {
  return {
    run: async (context) => {
      const instructions = nonEmpty(context.node.config.modelInstructions);
      const forbidden = context.role?.forbiddenActions.length
        ? `\nForbidden actions:\n${context.role.forbiddenActions.map((item) => `- ${item}`).join('\n')}`
        : '';
      const system = [
        `You are executing the graph node "${context.node.label}".`,
        context.role ? `Role: ${context.role.label}. Mission: ${context.role.mission}` : '',
        forbidden,
        instructions ? `Pack instructions: ${instructions}` : '',
        `Return only one JSON object containing exactly these writable fields: ${context.node.writes.join(', ')}.`,
        'Do not include Markdown fences or commentary outside the JSON object.',
      ].filter(Boolean).join('\n');
      const result = await client.generate({
        model: options.model,
        system,
        prompt: JSON.stringify({
          node: { id: context.node.id, description: context.node.description },
          input: stateInput(context),
        }, null, 2),
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        signal: context.signal,
      });
      return { patch: parseJsonPatch(result.text, client.config.id), usage: result.usage };
    },
  };
}
