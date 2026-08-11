import { describe, expect, it, vi } from 'vitest';
import type { IndustryPackManifest } from '@graph-workbench/contracts';
import {
  compilePack,
  createJsonModelAgent,
  GraphRuntime,
  ModelProviderClient,
  type AgentAdapter,
  type ToolAdapter,
} from '@graph-workbench/core';

function governedPack(toolId: 'lookup' | 'publish'): IndustryPackManifest {
  return {
    id: 'adapter_test',
    version: '0.1.0',
    name: 'Adapter test Pack',
    description: 'Exercises Agent and governed tool adapter contracts.',
    license: 'MIT',
    ontology: { objectTypes: [], relationTypes: [] },
    roles: [
      {
        id: 'analyst',
        label: 'Analyst',
        mission: 'Analyze a query using approved tools.',
        allowedTools: ['lookup', 'publish'],
        forbiddenActions: [],
      },
    ],
    tools: [
      {
        id: 'lookup',
        label: 'Lookup',
        risk: 'read',
        description: 'Read a governed source.',
        operation: 'query',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        outputSchema: { type: 'string' },
        idempotency: 'intrinsic',
      },
      {
        id: 'publish',
        label: 'Publish',
        risk: 'external',
        description: 'Publish outside the runtime.',
        operation: 'command',
        inputSchema: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
          additionalProperties: false,
        },
        outputSchema: { type: 'string' },
        idempotency: 'none',
      },
    ],
    evaluations: [],
    deliverables: [],
    fixtures: [],
    graphs: [
      {
        id: 'adapter_test.workflow',
        version: 1,
        name: 'Adapter test workflow',
        description: 'Invoke one governed tool through an Agent adapter.',
        state: {
          fields: {
            query: { type: 'string', required: true, description: 'Input query.' },
            answer: { type: 'string', required: false, description: 'Adapter result.' },
          },
        },
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Start',
            description: 'Accept the query.',
            reads: ['query'],
            writes: [],
            config: {},
          },
          {
            id: 'analyze',
            kind: 'agent',
            label: 'Analyze',
            description: 'Use the configured Agent and tool adapters.',
            handler: 'adapter_test.agent',
            reads: ['query'],
            writes: ['answer'],
            config: { roleId: 'analyst', toolIds: [toolId] },
          },
        ],
        edges: [{ id: 'e_start_analyze', source: 'start', target: 'analyze', on: 'success' }],
        budget: { maxSteps: 8, maxDurationMs: 30_000, maxConcurrency: 2 },
      },
    ],
  };
}

function graph(pack: IndustryPackManifest) {
  const compiled = compilePack(pack).graphs.get('adapter_test.workflow');
  if (!compiled) throw new Error('Adapter test graph is missing.');
  return compiled;
}

describe('Agent and tool adapters', () => {
  it('runs a model-directed tool loop through the existing governed invokeTool boundary', async () => {
    const pack = governedPack('lookup');
    let round = 0;
    const request: typeof fetch = vi.fn(async (_input, init) => {
      round += 1;
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (round === 1) {
        expect(payload.tools).toEqual([expect.objectContaining({
          function: expect.objectContaining({
            name: 'graph_workbench_tool_1',
            parameters: expect.objectContaining({ required: ['query'] }),
          }),
        })]);
        return new Response(JSON.stringify({
          id: 'request-1',
          model: 'test-model',
          choices: [{ message: { content: null, tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'graph_workbench_tool_1', arguments: '{"query":"graph governance"}' },
          }] } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }));
      }
      const messages = payload.messages as Array<Record<string, unknown>>;
      expect(messages.at(-1)).toMatchObject({
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'found:graph governance',
      });
      return new Response(JSON.stringify({
        id: 'request-2',
        model: 'test-model',
        choices: [{ message: { content: '{"answer":"found:graph governance"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }));
    });
    const client = new ModelProviderClient({
      id: 'test',
      label: 'Test provider',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9876/v1',
    }, request);
    const result = await new GraphRuntime(graph(pack), {
      pack,
      agents: { 'adapter_test.agent': createJsonModelAgent(client, { model: 'test-model' }) },
      tools: {
        lookup: {
          execute: (input) => `found:${String((input as { query: string }).query)}`,
        },
      },
    }).run({ query: 'graph governance' });

    expect(result.status).toBe('completed');
    expect(result.state.answer).toBe('found:graph governance');
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['tool.requested', 'tool.started', 'tool.completed']),
    );
    expect(result.events.find((event) => event.type === 'tool.started')).toMatchObject({
      detail: { operation: 'query', idempotency: 'intrinsic' },
    });
    expect(result.events.find((event) => event.type === 'tool.completed')).toMatchObject({
      detail: { outputSchemaValidated: true },
    });
    expect(result.events.find((event) => event.type === 'node.completed' && event.nodeId === 'analyze'))
      .toMatchObject({ detail: { usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 } } });
  });

  it('fails closed when a model exceeds the configured tool-call limit', async () => {
    const pack = governedPack('lookup');
    let round = 0;
    const request: typeof fetch = async () => {
      round += 1;
      return new Response(JSON.stringify({
        id: `request-${round}`,
        choices: [{ message: { content: null, tool_calls: [{
          id: `call-${round}`,
          type: 'function',
          function: { name: 'graph_workbench_tool_1', arguments: '{"query":"again"}' },
        }] } }],
      }));
    };
    const client = new ModelProviderClient({
      id: 'test', label: 'Test provider', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:9876/v1',
    }, request);
    const execute = vi.fn(() => 'result');
    const result = await new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': createJsonModelAgent(client, { model: 'test-model', maxToolRounds: 1 }),
      },
      tools: { lookup: { execute } },
    }).run({ query: 'loop forever' });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('Expected a failed run.');
    expect(result.error.message).toContain('1-round tool-call limit');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects connector input and output that violate the declared schemas', async () => {
    const pack = governedPack('lookup');
    const execute = vi.fn(() => 'unused');
    const invalidInput = await new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': {
          run: async (context) => ({
            patch: { answer: String(await context.invokeTool('lookup', { wrong: 'shape' })) },
          }),
        },
      },
      tools: { lookup: { execute } },
    }).run({ query: 'invalid input' });
    expect(invalidInput.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
    expect(invalidInput.events.find((event) => event.type === 'tool.denied')).toMatchObject({
      detail: { reason: 'input does not match the declared schema' },
    });

    const invalidOutput = await new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': {
          run: async (context) => ({
            patch: { answer: String(await context.invokeTool('lookup', { query: 'valid' })) },
          }),
        },
      },
      tools: { lookup: { execute: () => 42 } },
    }).run({ query: 'invalid output' });
    expect(invalidOutput.status).toBe('failed');
    expect(invalidOutput.events.some((event) => event.type === 'tool.failed')).toBe(true);
  });

  it('resumes an approved model tool call without repeating the provider request', async () => {
    const pack = governedPack('publish');
    let providerRequests = 0;
    const request: typeof fetch = async (_input, init) => {
      providerRequests += 1;
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (providerRequests === 1) {
        return new Response(JSON.stringify({
          id: 'approval-request-1',
          model: 'test-model',
          choices: [{ message: { content: null, tool_calls: [{
            id: 'publish-call-1',
            type: 'function',
            function: { name: 'graph_workbench_tool_1', arguments: '{"content":"approved draft"}' },
          }] } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }));
      }
      expect((payload.messages as Array<Record<string, unknown>>).at(-1)).toMatchObject({
        role: 'tool',
        tool_call_id: 'publish-call-1',
        content: 'published',
      });
      return new Response(JSON.stringify({
        id: 'approval-request-2',
        model: 'test-model',
        choices: [{ message: { content: '{"answer":"published"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }));
    };
    const client = new ModelProviderClient({
      id: 'test', label: 'Test provider', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:9876/v1',
    }, request);
    const execute = vi.fn(() => 'published');
    const runtime = new GraphRuntime(graph(pack), {
      pack,
      agents: { 'adapter_test.agent': createJsonModelAgent(client, { model: 'test-model' }) },
      tools: { publish: { execute } },
    });

    const paused = await runtime.run({ query: 'publish this' });
    expect(paused.status).toBe('paused');
    expect(providerRequests).toBe(1);
    if (paused.status !== 'paused') throw new Error('Expected tool approval pause.');
    const approvalId = String(paused.events.find((event) =>
      event.type === 'tool.approval_requested')?.detail.approvalId ?? '');

    const completed = await runtime.resume(paused.checkpoint, {
      toolApprovals: { [approvalId]: true },
    });
    expect(completed.status).toBe('completed');
    expect(providerRequests).toBe(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(completed.events.find((event) => event.type === 'node.completed'))
      .toMatchObject({ detail: { usage: { totalTokens: 25 } } });
  });

  it('scopes tools to the Pack role and exposes only declared secrets to the tool adapter', async () => {
    const pack = governedPack('lookup');
    const secret = 'private-test-token';
    const tool: ToolAdapter = {
      requiredSecrets: ['lookup_token'],
      execute: (input, context) => {
        expect(context.secrets).toEqual({ lookup_token: secret });
        return `found:${String((input as { query: string }).query)}`;
      },
    };
    const agent: AgentAdapter = {
      run: async (context) => {
        expect('secrets' in context).toBe(false);
        const output = await context.invokeTool('lookup', { query: context.state.query });
        return {
          patch: { answer: String(output) },
          usage: { model: 'deterministic-test', inputTokens: 3, outputTokens: 2 },
        };
      },
    };
    const result = await new GraphRuntime(graph(pack), {
      pack,
      agents: { 'adapter_test.agent': agent },
      tools: { lookup: tool },
      secrets: { get: (name) => (name === 'lookup_token' ? secret : undefined) },
    }).run({ query: 'graph governance' });

    expect(result.status).toBe('completed');
    expect(result.state.answer).toBe('found:graph governance');
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['tool.requested', 'tool.started', 'tool.completed']),
    );
    expect(JSON.stringify({ state: result.state, events: result.events })).not.toContain(secret);
  });

  it('checkpoints non-read tools for a bound human approval before execution', async () => {
    const pack = governedPack('publish');
    const execute = vi.fn(() => 'published');
    const runtime = new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': {
          run: async (context) => ({
            patch: { answer: String(await context.invokeTool('publish', { content: 'draft' })) },
          }),
        },
      },
      tools: { publish: { execute } },
    });
    const paused = await runtime.run({ query: 'publish this' });

    expect(paused.status).toBe('paused');
    expect(execute).not.toHaveBeenCalled();
    const request = paused.events.find((event) => event.type === 'tool.approval_requested');
    expect(request).toMatchObject({
      nodeId: 'analyze',
      detail: { toolId: 'publish', risk: 'external', roleId: 'analyst' },
    });
    if (paused.status !== 'paused' || typeof request?.detail.approvalId !== 'string') {
      throw new Error('Expected a tool approval checkpoint.');
    }

    const unauthorized = await runtime.resume(paused.checkpoint, {
      actor: {
        id: 'member.observer',
        kind: 'human',
        displayName: 'Observer',
        workspaceRole: 'member',
        roleIds: ['observer'],
      },
      toolApprovals: { [request.detail.approvalId]: true },
    });
    expect(unauthorized.status).toBe('paused');
    expect(unauthorized.events.find((event) => event.type === 'tool.denied')?.detail.reason)
      .toContain('role "analyst" is required');

    const resumed = await runtime.resume(paused.checkpoint, {
      toolApprovals: { [request.detail.approvalId]: true },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.state.answer).toBe('published');
    expect(execute).toHaveBeenCalledOnce();
    expect(resumed.events.some((event) => event.type === 'tool.approval_resolved')).toBe(true);
  });

  it('allows an authorized external tool and records Agent usage', async () => {
    const pack = governedPack('publish');
    const result = await new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': {
          run: async (context) => ({
            patch: { answer: String(await context.invokeTool('publish', { content: 'approved' })) },
            usage: { model: 'adapter-model', costUsd: 0.01 },
          }),
        },
      },
      tools: { publish: { execute: () => 'published' } },
      authorizeTool: ({ tool }) => tool.id === 'publish',
    }).run({ query: 'publish this' });

    expect(result.status).toBe('completed');
    expect(result.state.answer).toBe('published');
    expect(result.events.find((event) => event.type === 'node.completed' && event.nodeId === 'analyze'))
      .toMatchObject({ detail: { usage: { model: 'adapter-model', costUsd: 0.01 } } });
  });
});
