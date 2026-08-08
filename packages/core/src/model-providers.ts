import {
  AgentSuspensionError,
  ToolApprovalRequiredError,
  type AgentAdapter,
  type AgentContext,
  type AgentUsage,
} from './adapters.js';
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

export interface ModelToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

export interface ModelToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: unknown;
}

export interface ModelToolResult {
  readonly callId: string;
  readonly toolId: string;
  readonly output: unknown;
}

export interface ModelToolExchange {
  readonly text: string;
  readonly calls: readonly ModelToolCall[];
  readonly results: readonly ModelToolResult[];
}

export interface ModelGenerateRequest {
  readonly model: string;
  readonly prompt: string;
  readonly system?: string;
  readonly maxOutputTokens?: number;
  readonly tools?: readonly ModelToolDefinition[];
  readonly exchanges?: readonly ModelToolExchange[];
  readonly signal?: AbortSignal;
}

export interface ModelGenerateResult {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function providerToolName(index: number): string {
  return `graphwork_tool_${index + 1}`;
}

function toolByProviderName(
  input: ModelGenerateRequest,
  name: string,
  provider: ModelProviderConfig,
): ModelToolDefinition {
  const index = /^graphwork_tool_(\d+)$/.exec(name)?.[1];
  const tool = index ? input.tools?.[Number(index) - 1] : undefined;
  if (!tool) {
    throw new ModelProviderError(
      `${provider.label} requested an unknown tool "${name}".`,
      'invalid_response',
      provider.id,
    );
  }
  return tool;
}

function providerNameForTool(
  input: ModelGenerateRequest,
  toolId: string,
  provider: ModelProviderConfig,
): string {
  const index = input.tools?.findIndex((tool) => tool.id === toolId) ?? -1;
  if (index < 0) {
    throw new ModelProviderError(
      `Tool "${toolId}" is not available to ${provider.label}.`,
      'invalid_configuration',
      provider.id,
    );
  }
  return providerToolName(index);
}

function toolInput(value: unknown, provider: ModelProviderConfig): unknown {
  if (typeof value !== 'string') return value ?? {};
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ModelProviderError(
      `${provider.label} returned invalid JSON tool arguments.`,
      'invalid_response',
      provider.id,
    );
  }
}

function toolParameters(tool: ModelToolDefinition): Readonly<Record<string, unknown>> {
  return tool.inputSchema ?? { type: 'object' };
}

function toolOutput(value: unknown, providerId: string): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    throw new ModelProviderError(
      'Tool output must be JSON serializable before it can be returned to a model.',
      'invalid_response',
      providerId,
    );
  }
}

function requireOutput(
  text: string,
  calls: readonly ModelToolCall[],
  provider: ModelProviderConfig,
): string {
  if (!text && calls.length === 0) {
    throw new ModelProviderError(`${provider.label} returned no text or tool request.`, 'invalid_response', provider.id);
  }
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
        toolCalls: result.toolCalls,
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
    const messages: Array<Record<string, unknown>> = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      { role: 'user', content: input.prompt },
    ];
    for (const exchange of input.exchanges ?? []) {
      messages.push({
        role: 'assistant',
        content: exchange.text || null,
        tool_calls: exchange.calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: providerNameForTool(input, call.toolId, this.config),
            arguments: JSON.stringify(call.input ?? {}),
          },
        })),
      });
      for (const result of exchange.results) {
        messages.push({
          role: 'tool',
          tool_call_id: result.callId,
          content: toolOutput(result.output, this.config.id),
        });
      }
    }
    const response = await this.request(endpoint(this.config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        messages,
        stream: false,
        ...(input.tools?.length ? {
          tools: input.tools.map((tool, index) => ({
            type: 'function',
            function: {
              name: providerToolName(index),
              description: tool.description,
              parameters: toolParameters(tool),
            },
          })),
          tool_choice: 'auto',
        } : {}),
        ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = await readJson(response, this.config) as Record<string, unknown>;
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const message = recordValue(choices[0])?.message;
    const messageRecord = recordValue(message);
    const rawCalls = Array.isArray(messageRecord?.tool_calls) ? messageRecord.tool_calls : [];
    const toolCalls = rawCalls.map((value) => {
      const call = recordValue(value);
      const fn = recordValue(call?.function);
      const id = nonEmpty(call?.id);
      const name = nonEmpty(fn?.name);
      if (!id || !name) {
        throw new ModelProviderError(`${this.config.label} returned an invalid tool request.`, 'invalid_response', this.config.id);
      }
      const tool = toolByProviderName(input, name, this.config);
      return { id, toolId: tool.id, input: toolInput(fn?.arguments, this.config) };
    });
    const text = nonEmpty(messageRecord?.content) ?? '';
    const usage = value.usage && typeof value.usage === 'object'
      ? value.usage as Record<string, unknown>
      : {};
    return {
      text: requireOutput(text, toolCalls, this.config),
      toolCalls,
      model: nonEmpty(value.model),
      requestId: nonEmpty(value.id),
      inputTokens: numberValue(usage.prompt_tokens),
      outputTokens: numberValue(usage.completion_tokens),
      totalTokens: numberValue(usage.total_tokens),
    };
  }

  private async anthropic(input: ModelGenerateRequest) {
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: input.prompt }];
    for (const exchange of input.exchanges ?? []) {
      messages.push({
        role: 'assistant',
        content: [
          ...(exchange.text ? [{ type: 'text', text: exchange.text }] : []),
          ...exchange.calls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: providerNameForTool(input, call.toolId, this.config),
            input: call.input ?? {},
          })),
        ],
      });
      messages.push({
        role: 'user',
        content: exchange.results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.callId,
          content: toolOutput(result.output, this.config.id),
        })),
      });
    }
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
        messages,
        ...(input.tools?.length ? {
          tools: input.tools.map((tool, index) => ({
            name: providerToolName(index),
            description: tool.description,
            input_schema: toolParameters(tool),
          })),
        } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = await readJson(response, this.config) as Record<string, unknown>;
    const content = Array.isArray(value.content) ? value.content : [];
    const blocks = content
      .map(recordValue)
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const text = blocks
      .filter((item) => item.type === 'text')
      .map((item) => nonEmpty(item.text) ?? '')
      .join('\n');
    const toolCalls = blocks
      .filter((item) => item.type === 'tool_use')
      .map((item) => {
        const id = nonEmpty(item.id);
        const name = nonEmpty(item.name);
        if (!id || !name) {
          throw new ModelProviderError(`${this.config.label} returned an invalid tool request.`, 'invalid_response', this.config.id);
        }
        const tool = toolByProviderName(input, name, this.config);
        return { id, toolId: tool.id, input: item.input ?? {} };
      });
    const usage = value.usage && typeof value.usage === 'object'
      ? value.usage as Record<string, unknown>
      : {};
    const inputTokens = numberValue(usage.input_tokens);
    const outputTokens = numberValue(usage.output_tokens);
    return {
      text: requireOutput(text, toolCalls, this.config),
      toolCalls,
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
    const contents: Array<Record<string, unknown>> = [
      { role: 'user', parts: [{ text: input.prompt }] },
    ];
    for (const exchange of input.exchanges ?? []) {
      contents.push({
        role: 'model',
        parts: [
          ...(exchange.text ? [{ text: exchange.text }] : []),
          ...exchange.calls.map((call) => ({
            functionCall: {
              name: providerNameForTool(input, call.toolId, this.config),
              args: call.input ?? {},
            },
          })),
        ],
      });
      contents.push({
        role: 'user',
        parts: exchange.results.map((result) => ({
          functionResponse: {
            name: providerNameForTool(input, result.toolId, this.config),
            response: { output: toolOutput(result.output, this.config.id) },
          },
        })),
      });
    }
    const response = await this.request(endpoint(this.config.baseUrl, `models/${model}:generateContent`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { 'x-goog-api-key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({
        ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
        contents,
        ...(input.tools?.length ? {
          tools: [{
            functionDeclarations: input.tools.map((tool, index) => ({
              name: providerToolName(index),
              description: tool.description,
              parameters: toolParameters(tool),
            })),
          }],
        } : {}),
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
      .map(recordValue)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => nonEmpty(item.text) ?? '')
      .join('\n');
    const toolCalls = parts
      .map(recordValue)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .flatMap((item, index) => {
        const call = recordValue(item.functionCall);
        if (!call) return [];
        const name = nonEmpty(call.name);
        if (!name) {
          throw new ModelProviderError(`${this.config.label} returned an invalid tool request.`, 'invalid_response', this.config.id);
        }
        const tool = toolByProviderName(input, name, this.config);
        const responseId = nonEmpty(value.responseId) ?? 'response';
        return [{ id: `${responseId}:${index + 1}`, toolId: tool.id, input: call.args ?? {} }];
      });
    const usage = value.usageMetadata && typeof value.usageMetadata === 'object'
      ? value.usageMetadata as Record<string, unknown>
      : {};
    return {
      text: requireOutput(text, toolCalls, this.config),
      toolCalls,
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

function addUsage(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

function mergeUsage(current: AgentUsage | undefined, next: AgentUsage): AgentUsage {
  const {
    inputTokens: _inputTokens,
    outputTokens: _outputTokens,
    totalTokens: _totalTokens,
    costUsd: _costUsd,
    latencyMs: _latencyMs,
    ...identity
  } = next;
  const inputTokens = addUsage(current?.inputTokens, next.inputTokens);
  const outputTokens = addUsage(current?.outputTokens, next.outputTokens);
  const totalTokens = addUsage(current?.totalTokens, next.totalTokens);
  const costUsd = addUsage(current?.costUsd, next.costUsd);
  const latencyMs = addUsage(current?.latencyMs, next.latencyMs);
  return {
    ...identity,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

interface JsonModelAgentSuspension {
  readonly formatVersion: 1;
  readonly round: number;
  readonly exchanges: readonly ModelToolExchange[];
  readonly usage?: AgentUsage;
  readonly current: {
    readonly text: string;
    readonly calls: readonly ModelToolCall[];
    readonly results: readonly ModelToolResult[];
  };
}

function resumeModelAgent(value: unknown, providerId: string): JsonModelAgentSuspension | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelProviderError('Stored Agent suspension is invalid.', 'invalid_response', providerId);
  }
  const state = value as Partial<JsonModelAgentSuspension>;
  if (
    state.formatVersion !== 1
    || !Number.isInteger(state.round)
    || !Array.isArray(state.exchanges)
    || !state.current
    || !Array.isArray(state.current.calls)
    || !Array.isArray(state.current.results)
  ) {
    throw new ModelProviderError('Stored Agent suspension is incompatible.', 'invalid_response', providerId);
  }
  if (state.current.results.length > state.current.calls.length) {
    throw new ModelProviderError('Stored Agent suspension has more results than tool calls.', 'invalid_response', providerId);
  }
  for (let index = 0; index < state.current.results.length; index += 1) {
    const call = state.current.calls[index];
    const result = state.current.results[index];
    if (!call || !result || result.callId !== call.id || result.toolId !== call.toolId) {
      throw new ModelProviderError('Stored Agent suspension tool results do not match their calls.', 'invalid_response', providerId);
    }
  }
  return state as JsonModelAgentSuspension;
}

export function createJsonModelAgent(
  client: ModelProviderClient,
  options: {
    readonly model: string;
    readonly maxOutputTokens?: number;
    readonly maxToolRounds?: number;
  },
): AgentAdapter {
  return {
    run: async (context) => {
      const maxToolRounds = Math.max(0, Math.min(8, options.maxToolRounds ?? 4));
      const instructions = nonEmpty(context.node.config.modelInstructions);
      const forbidden = context.role?.forbiddenActions.length
        ? `\nForbidden actions:\n${context.role.forbiddenActions.map((item) => `- ${item}`).join('\n')}`
        : '';
      const system = [
        `You are executing the graph node "${context.node.label}".`,
        context.role ? `Role: ${context.role.label}. Mission: ${context.role.mission}` : '',
        forbidden,
        instructions ? `Pack instructions: ${instructions}` : '',
        context.tools.length
          ? 'Use only the supplied tools when they are needed. After tool results are returned, continue until you can produce the final state patch.'
          : '',
        `Return only one JSON object containing exactly these writable fields: ${context.node.writes.join(', ')}.`,
        'Do not include Markdown fences or commentary outside the JSON object.',
      ].filter(Boolean).join('\n');
      const tools = context.tools.map((tool) => ({
        id: tool.id,
        description: `${tool.label}: ${tool.description} Risk: ${tool.risk}.`,
      }));
      const resumed = resumeModelAgent(context.resumeState, client.config.id);
      const exchanges: ModelToolExchange[] = [...(resumed?.exchanges ?? [])];
      let usage: AgentUsage | undefined = resumed?.usage;
      let pending = resumed?.current;
      for (let round = resumed?.round ?? 0; round <= maxToolRounds; round += 1) {
        let text: string;
        let calls: readonly ModelToolCall[];
        let results: ModelToolResult[];
        if (pending) {
          ({ text, calls } = pending);
          results = [...pending.results];
          pending = undefined;
        } else {
          const result = await client.generate({
            model: options.model,
            system,
            prompt: JSON.stringify({
              node: { id: context.node.id, description: context.node.description },
              input: stateInput(context),
            }, null, 2),
            ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
            ...(tools.length ? { tools } : {}),
            ...(exchanges.length ? { exchanges } : {}),
            signal: context.signal,
          });
          usage = mergeUsage(usage, result.usage);
          text = result.text;
          calls = result.toolCalls;
          results = [];
        }
        if (calls.length === 0) {
          return {
            patch: parseJsonPatch(text, client.config.id),
            ...(usage ? { usage } : {}),
          };
        }
        if (round === maxToolRounds) {
          throw new ModelProviderError(
            `Model exceeded the ${maxToolRounds}-round tool-call limit.`,
            'invalid_response',
            client.config.id,
          );
        }
        const callIds = new Set<string>();
        for (const call of calls) {
          if (callIds.has(call.id)) {
            throw new ModelProviderError('Model returned duplicate tool-call IDs.', 'invalid_response', client.config.id);
          }
          callIds.add(call.id);
        }
        for (const call of calls.slice(results.length)) {
          let output: unknown;
          try {
            output = await context.invokeTool(call.toolId, call.input);
          } catch (error) {
            if (error instanceof ToolApprovalRequiredError) {
              throw new AgentSuspensionError({
                formatVersion: 1,
                round,
                exchanges,
                ...(usage ? { usage } : {}),
                current: { text, calls, results },
              } satisfies JsonModelAgentSuspension, error);
            }
            throw error;
          }
          toolOutput(output, client.config.id);
          results.push({ callId: call.id, toolId: call.toolId, output });
        }
        exchanges.push({ text, calls, results });
      }
      throw new ModelProviderError('Model tool loop ended unexpectedly.', 'invalid_response', client.config.id);
    },
  };
}
