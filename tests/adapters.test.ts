import { describe, expect, it, vi } from 'vitest';
import type { IndustryPackManifest } from '@graph-native/contracts';
import {
  compilePack,
  GraphRuntime,
  type AgentAdapter,
  type ToolAdapter,
} from '@graph-native/core';

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
      { id: 'lookup', label: 'Lookup', risk: 'read', description: 'Read a governed source.' },
      { id: 'publish', label: 'Publish', risk: 'external', description: 'Publish outside the runtime.' },
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

  it('denies non-read tools by default before the adapter can execute', async () => {
    const pack = governedPack('publish');
    const execute = vi.fn(() => 'published');
    const result = await new GraphRuntime(graph(pack), {
      pack,
      agents: {
        'adapter_test.agent': {
          run: async (context) => ({
            patch: { answer: String(await context.invokeTool('publish', { content: 'draft' })) },
          }),
        },
      },
      tools: { publish: { execute } },
    }).run({ query: 'publish this' });

    expect(result.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
    expect(result.events.some((event) => event.type === 'tool.denied')).toBe(true);
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
