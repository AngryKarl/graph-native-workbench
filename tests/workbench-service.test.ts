import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkbenchService } from '../apps/workbench/src/service.js';

describe('Workbench service', () => {
  it('exposes the Architecture Pack and starts from its real fixture input', () => {
    const description = new WorkbenchService().describePack();
    expect(description).toMatchObject({
      id: 'architecture',
      graph: { id: 'architecture.concept_workflow' },
      input: { project_name: '长宁街区更新', output_language: 'zh-CN' },
    });
    expect(description.graph.nodes.some((node) => node.id === 'approval')).toBe(true);
  });

  it('runs to human review and projects an approved result into the context graph', async () => {
    const service = new WorkbenchService();
    const input = service.describePack().input;
    const paused = await service.start(input);
    expect(paused.status).toBe('paused');
    expect(paused.state.concept_directions).toHaveLength(2);
    expect(paused.events.some((event) => event.type === 'human.requested')).toBe(true);

    const completed = await service.decide(paused.runId, true);
    expect(completed.status).toBe('completed');
    expect(completed.state.deliverable).toContain('# 概念设计简报');
    expect(completed.context?.objects.some((object) => object.type === 'deliverable')).toBe(true);
    expect(completed.context?.relations.some((relation) => relation.type === 'decision_governs')).toBe(true);
    expect(service.get(paused.runId)).toEqual(completed);
  });

  it('records a rejected review without publishing a deliverable', async () => {
    const service = new WorkbenchService();
    const paused = await service.start(service.describePack().input);
    const rejected = await service.decide(paused.runId, false);
    expect(rejected.status).toBe('completed');
    expect(rejected.state.deliverable).toBeUndefined();
    expect(rejected.state.rejection_reason).toBeTypeOf('string');
    expect(rejected.context).toBeUndefined();
  });

  it('installs and runs another bundled Pack through the same workbench contract', async () => {
    const service = new WorkbenchService();
    const installed = service.install('research');
    expect(installed.installedPackIds).toContain('research');

    const activated = service.activate('research');
    expect(activated.activePackId).toBe('research');
    expect(activated.activePack.graph.id).toBe('research.workflow');

    const paused = await service.start(activated.activePack.input);
    expect(paused).toMatchObject({ packId: 'research', graphId: 'research.workflow', status: 'paused' });
    const completed = await service.decide(paused.runId, true);
    expect(completed.state.deliverable).toContain('# Approved research deliverable');
    expect(completed.context?.objects.some((object) => object.type === 'deliverable')).toBe(true);
  });

  it('runs a model-enabled Agent through a selected compatible provider and projects its usage', async () => {
    const secret = 'server-only-secret';
    const request: typeof fetch = async (_input, init) => {
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${secret}` });
      return new Response(JSON.stringify({
        id: 'model-request-1',
        model: 'test-model-resolved',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({ synthesis: 'Model-backed synthesis with preserved evidence.' }),
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const service = new WorkbenchService({
      modelEnvironment: { GRAPHWORK_MODEL_API_KEY: secret },
      modelFetch: request,
    });
    service.install('research');
    const workspace = service.activate('research');
    service.configureModelProvider({
      providerId: 'custom',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:9876/v1',
    });

    const paused = await service.start(workspace.activePack.input);
    expect(paused.status).toBe('paused');
    expect(paused.state.synthesis).toBe('Model-backed synthesis with preserved evidence.');
    expect(paused.events.find((event) => event.type === 'node.completed' && event.nodeId === 'synthesize'))
      .toMatchObject({ detail: { usage: { providerId: 'custom', totalTokens: 28 } } });
    expect(JSON.stringify(paused)).not.toContain(secret);

    const completed = await service.decide(paused.runId, true);
    expect(completed.context?.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'model_call',
        data: expect.objectContaining({ provider_id: 'custom', model: 'test-model-resolved' }),
      }),
    ]));
    expect(completed.context?.relations.some((relation) => relation.type === 'contributed_to')).toBe(true);
  });

  it('exposes provider readiness without returning environment secret values', () => {
    const service = new WorkbenchService({
      modelEnvironment: { OPENAI_API_KEY: 'private-provider-key' },
    });
    const models = service.describeWorkbench().models;
    expect(models.selection.providerId).toBe('deterministic');
    expect(models.providers.find((provider) => provider.id === 'openai')?.configured).toBe(true);
    expect(JSON.stringify(models)).not.toContain('private-provider-key');
  });

  it('validates, saves and executes an edited graph definition', async () => {
    const service = new WorkbenchService();
    const pack = service.describePack();
    const graph = {
      ...pack.graph,
      name: 'Edited architecture workflow',
      nodes: pack.graph.nodes.map((node) => node.id === 'approval'
        ? { ...node, label: 'Principal design review' }
        : node),
    };
    const validation = service.validateGraph(pack.id, graph);
    expect(validation).toMatchObject({ valid: true, nodeCount: graph.nodes.length });

    service.saveDraft(pack.id, graph, { approval: { x: 900, y: 240 } });
    expect(service.describePack().graph.name).toBe('Edited architecture workflow');
    const paused = await service.start(pack.input);
    expect(paused.status).toBe('paused');
    expect(paused.events.some((event) => event.nodeId === 'approval')).toBe(true);
  });

  it('persists installed Packs, the active Pack, drafts and runs across service restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-native-workbench-'));
    const dataFile = join(directory, 'workbench.json');
    try {
      const first = new WorkbenchService({ dataFile });
      first.install('research');
      const workspace = first.activate('research');
      const graph = { ...workspace.activePack.graph, name: 'Persistent research workflow' };
      first.saveDraft('research', graph, { start: { x: 20, y: 40 } });
      const paused = await first.start(workspace.activePack.input);

      const second = new WorkbenchService({ dataFile });
      const restored = second.describeWorkbench();
      expect(restored.activePackId).toBe('research');
      expect(restored.installedPackIds).toEqual(['architecture', 'research']);
      expect(restored.activePack.graph.name).toBe('Persistent research workflow');
      expect(second.get(paused.runId)?.status).toBe('paused');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
