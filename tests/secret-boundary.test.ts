import { describe, expect, it } from 'vitest';
import type { IndustryPackManifest } from '@graph-workbench/contracts';
import {
  compilePack,
  EnvironmentSecretProvider,
  GraphRuntime,
  StaticSecretProvider,
  type AgentAdapter,
  type ToolAdapter,
} from '@graph-workbench/core';

const SECRET = 'ghp_should_never_be_logged';

function connectorPack(): IndustryPackManifest {
  return {
    id: 'secret_boundary_test',
    version: '0.1.0',
    name: 'Secret boundary test Pack',
    description: 'Exercises the tool secret boundary end to end.',
    license: 'MIT',
    ontology: { objectTypes: [], relationTypes: [] },
    roles: [{
      id: 'engineer',
      label: 'Engineer',
      mission: 'Read an external system through a governed connector.',
      allowedTools: ['remote_read'],
      forbiddenActions: [],
    }],
    tools: [{
      id: 'remote_read',
      label: 'Remote read',
      risk: 'read',
      description: 'Read from a credentialed external system.',
      operation: 'query',
      inputSchema: {
        type: 'object',
        properties: { resource: { type: 'string' } },
        required: ['resource'],
        additionalProperties: false,
      },
      outputSchema: { type: 'string' },
      idempotency: 'intrinsic',
    }],
    evaluations: [],
    deliverables: [],
    fixtures: [],
    graphs: [{
      id: 'secret_boundary_test.workflow',
      version: 1,
      name: 'Connector workflow',
      description: 'Call one credentialed tool.',
      state: {
        fields: {
          resource: { type: 'string', required: true, description: 'Resource to read.' },
          answer: { type: 'string', required: false, description: 'Connector result.' },
        },
      },
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          label: 'Start',
          description: 'Accept the resource.',
          reads: ['resource'],
          writes: [],
          config: {},
        },
        {
          id: 'read_remote',
          kind: 'agent',
          label: 'Read remote system',
          description: 'Invoke the credentialed connector.',
          handler: 'secret_boundary_test.agent',
          reads: ['resource'],
          writes: ['answer'],
          config: { roleId: 'engineer', toolIds: ['remote_read'] },
        },
      ],
      edges: [{ id: 'e_start_read', source: 'start', target: 'read_remote', on: 'success' }],
      budget: { maxSteps: 8, maxDurationMs: 30_000, maxConcurrency: 2 },
    }],
  };
}

const agent: AgentAdapter = {
  run: async (context) => ({
    patch: { answer: String(await context.invokeTool('remote_read', { resource: String(context.state.resource) })) },
  }),
};

function compiled() {
  const graph = compilePack(connectorPack()).graphs.get('secret_boundary_test.workflow');
  if (!graph) throw new Error('Secret boundary graph is missing.');
  return graph;
}

describe('tool secret boundary', () => {
  it('delivers a declared secret to its adapter without exposing it to the run trace', async () => {
    let received: string | undefined;
    const tool: ToolAdapter = {
      requiredSecrets: ['GITHUB_TOKEN'],
      execute: (_input, context) => {
        received = context.secrets.GITHUB_TOKEN;
        return 'ok';
      },
    };

    const result = await new GraphRuntime(compiled(), {
      agents: { 'secret_boundary_test.agent': agent },
      tools: { remote_read: tool },
      pack: connectorPack(),
      secrets: new EnvironmentSecretProvider({ GITHUB_TOKEN: SECRET }, ['GITHUB_TOKEN']),
    }).run({ resource: 'repos/acme/api' });

    expect(result.status).toBe('completed');
    expect(received).toBe(SECRET);
    // The credential must not leak into anything the workspace persists or exports.
    expect(JSON.stringify(result.events)).not.toContain(SECRET);
    expect(JSON.stringify(result.state)).not.toContain(SECRET);
  });

  it('denies the tool with a stated reason when its secret is absent, rather than calling it unauthenticated', async () => {
    let called = false;
    const tool: ToolAdapter = {
      requiredSecrets: ['GITHUB_TOKEN'],
      execute: () => { called = true; return 'ok'; },
    };

    const result = await new GraphRuntime(compiled(), {
      agents: { 'secret_boundary_test.agent': agent },
      tools: { remote_read: tool },
      pack: connectorPack(),
      secrets: new EnvironmentSecretProvider({}, ['GITHUB_TOKEN']),
    }).run({ resource: 'repos/acme/api' });

    expect(called).toBe(false);
    expect(result.status).toBe('failed');
    const denied = result.events.find((event) => event.type === 'tool.denied');
    expect(denied?.detail.reason).toMatch(/required secret "GITHUB_TOKEN" is unavailable/);
  });

  it('refuses environment names the Pack did not declare, so one connector cannot read another credential', () => {
    const provider = new EnvironmentSecretProvider(
      { GITHUB_TOKEN: SECRET, OPENAI_API_KEY: 'sk-other' },
      ['GITHUB_TOKEN'],
    );

    expect(provider.get('GITHUB_TOKEN')).toBe(SECRET);
    expect(provider.get('OPENAI_API_KEY')).toBeUndefined();
  });

  it('treats an empty environment variable as unset so a blank token fails early', () => {
    expect(new EnvironmentSecretProvider({ GITHUB_TOKEN: '   ' }).get('GITHUB_TOKEN')).toBeUndefined();
    expect(new StaticSecretProvider({ GITHUB_TOKEN: SECRET }).get('GITHUB_TOKEN')).toBe(SECRET);
  });
});
