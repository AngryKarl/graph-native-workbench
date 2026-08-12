import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryContextGraphStore, verifyRunAuditBundle } from '@graph-workbench/core';
import { researchPack } from '@graph-workbench/pack-research';
import { bundledPackCatalog } from '../apps/workbench/src/catalog.js';
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
    expect(paused.pendingApproval).toMatchObject({
      requiredRoleId: 'design_reviewer',
      requiredRoleLabel: 'Design reviewer',
      actingActorId: 'local.user',
      actorAuthorized: true,
    });

    const completed = await service.decide(paused.runId, true);
    expect(completed.status).toBe('completed');
    expect(completed.state.deliverable).toContain('# 概念设计简报');
    expect(completed.context?.objects.some((object) => object.type === 'deliverable')).toBe(true);
    expect(completed.context?.relations.some((relation) => relation.type === 'decision_governs')).toBe(true);
    expect(completed.artifacts).toEqual([
      expect.objectContaining({
        artifactType: 'concept_design_brief',
        approval: expect.objectContaining({ actorId: 'local.user' }),
      }),
    ]);
    expect(completed.events.find((event) => event.type === 'human.resolved')).toMatchObject({
      detail: { resolvedByActorId: 'local.user', resolvedByActorName: 'Local user' },
    });
    expect(service.get(paused.runId)).toEqual(completed);
  });

  it('keeps an approval paused when the current member lacks its responsible role', async () => {
    const service = new WorkbenchService({
      actor: {
        id: 'member.researcher',
        kind: 'human',
        displayName: 'Research member',
        workspaceRole: 'member',
        roleIds: ['researcher'],
      },
    });
    const paused = await service.start(service.describePack().input);
    expect(paused.pendingApproval).toMatchObject({
      requiredRoleId: 'design_reviewer',
      actingActorId: 'member.researcher',
      actorAuthorized: false,
    });

    await expect(service.decide(paused.runId, true)).rejects.toThrow(/role "design_reviewer" is required/);
    expect(service.get(paused.runId)?.status).toBe('paused');
  });

  it('persists team identities and enforces their Pack approval responsibilities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-team-'));
    const dataFile = join(directory, 'workbench.json');
    let first: WorkbenchService | undefined;
    let second: WorkbenchService | undefined;
    try {
      first = new WorkbenchService({ dataFile });
      await first.upsertActor({
        id: 'member.designer',
        kind: 'human',
        displayName: 'Design member',
        workspaceRole: 'member',
        roleIds: ['design_reviewer'],
      });
      expect(() => first?.upsertActor({
        id: 'local.user',
        kind: 'human',
        displayName: 'Local user',
        workspaceRole: 'member',
        roleIds: [],
      })).toThrow(/retain at least one owner/);
      await first.activateActor('member.designer');
      const paused = await first.start(first.describePack().input);
      expect(paused.pendingApproval).toMatchObject({
        actingActorId: 'member.designer',
        actorAuthorized: true,
      });
      expect(() => first?.upsertActor({
        id: 'member.other',
        kind: 'human',
        displayName: 'Other member',
        workspaceRole: 'member',
        roleIds: [],
      })).toThrow(/owner permission/);

      second = new WorkbenchService({ dataFile });
      const restored = await second.describeWorkbench();
      expect(restored.actor.id).toBe('member.designer');
      expect(restored.actors).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'member.designer', roleIds: ['design_reviewer'] }),
      ]));
      const completed = await second.decide(paused.runId, true);
      expect(completed.artifacts?.[0]?.approval?.actorId).toBe('member.designer');
    } finally {
      await Promise.all([first?.close(), second?.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads externally supplied records from the shared Context authority', async () => {
    const contextStore = new InMemoryContextGraphStore();
    await contextStore.appendObject({
      id: 'external.case',
      type: 'external_case',
      version: 1,
      status: 'confirmed',
      data: { title: 'Shared team case' },
      validFrom: '2026-08-11T00:00:00.000Z',
      validTo: null,
      provenance: {
        sourceIds: ['external.system'],
        actorId: 'service.sync',
        recordedAt: '2026-08-11T00:00:00.000Z',
      },
    });
    const service = new WorkbenchService({ contextStore });
    expect((await service.describeWorkbench()).context.objects).toEqual([
      expect.objectContaining({ id: 'external.case', type: 'external_case' }),
    ]);
  });

  it('dispatches Pack triggers and resumes correlated waits through the Workbench service', async () => {
    const service = new WorkbenchService();
    const paused = await service.triggerWebhook('architecture', 'architecture.feedback_followup', 'POST', {
      project_name: 'Civic hub',
      feedback_case_id: 'feedback-service-1',
    });
    expect(paused).toMatchObject({
      status: 'paused',
      pendingWait: { mode: 'event', eventType: 'design.feedback.received', correlationKey: 'feedback-service-1' },
    });
    const feedback = await service.publishEvent({
      id: 'feedback-service-event-1',
      type: 'design.feedback.received',
      correlationKey: 'feedback-service-1',
      payload: { decision: 'approved with notes' },
      occurredAt: '2026-08-11T02:00:00.000Z',
    });
    expect(feedback.resumed[0]).toMatchObject({ status: 'completed', state: { summary: expect.stringContaining('approved with notes') } });

    await service.install('customer_success');
    const scheduled = await service.triggerSchedule('customer_success', 'customer_success.scheduled_health_scan', { id: 'health-scan-service-1', scheduledFor: '2026-08-11T08:00:00.000Z' });
    expect(scheduled).toMatchObject({ status: 'completed', state: { scan_attempt: 2 } });
    const scheduledReplay = await service.triggerSchedule('customer_success', 'customer_success.scheduled_health_scan', { id: 'health-scan-service-1', scheduledFor: '2026-08-11T08:00:00.000Z' });
    expect(scheduledReplay.runId).toBe(scheduled.runId);
    const critical = await service.publishEvent({
      id: 'critical-service-event-1',
      type: 'customer.health_critical',
      correlationKey: 'account-service-1',
      payload: { severity: 'critical', simulate_failure: true },
      occurredAt: '2026-08-11T02:05:00.000Z',
    });
    expect(critical.started[0]).toMatchObject({ status: 'completed', state: { recovered: true } });
    expect(critical.started[0]?.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'escalation.raised', 'compensation.completed',
    ]));
    const replay = await service.publishEvent({
      id: 'critical-service-event-1',
      type: 'customer.health_critical',
      correlationKey: 'account-service-1',
      payload: { severity: 'critical', simulate_failure: true },
      occurredAt: '2026-08-11T02:05:00.000Z',
    });
    expect(replay.started).toEqual([]);
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

  it('exports a portable integrity-checked audit bundle for a Workbench run', async () => {
    const service = new WorkbenchService();
    const paused = await service.start(service.describePack().input);
    const completed = await service.decide(paused.runId, true);
    const audit = service.exportAudit(completed.runId);

    expect(verifyRunAuditBundle(audit)).toEqual(audit);
    expect(audit.run).toMatchObject({
      runId: completed.runId,
      packId: 'architecture',
      status: 'completed',
    });
    expect(audit.context?.objects.some((item) => item.type === 'deliverable')).toBe(true);
    expect(audit.artifacts?.[0]).toMatchObject({ artifactType: 'concept_design_brief' });
  });

  it('installs and runs another bundled Pack through the same workbench contract', async () => {
    const service = new WorkbenchService();
    const installed = await service.install('research');
    expect(installed.installedPackIds).toContain('research');
    expect(installed.activePackId).toBe('research');
    expect(installed.activePack.graph.id).toBe('research.workflow');

    const paused = await service.start(installed.activePack.input);
    expect(paused).toMatchObject({ packId: 'research', graphId: 'research.workflow', status: 'paused' });
    const completed = await service.decide(paused.runId, true);
    expect(completed.state.deliverable).toContain('# Approved research deliverable');
    expect(completed.context?.objects.some((object) => object.type === 'deliverable')).toBe(true);
  });

  it('installs and completes the finance, healthcare and robotics standard Packs', async () => {
    const service = new WorkbenchService();
    const standardPacks = [
      { id: 'quantitative_finance', contextType: 'finance_record', approvals: 3 },
      { id: 'healthcare_diagnostics', contextType: 'diagnostic_record', approvals: 2 },
      { id: 'robotics_fleet', contextType: 'fleet_record', approvals: 1 },
    ] as const;

    for (const expected of standardPacks) {
      const installed = await service.install(expected.id);
      let run = await service.start(installed.activePack.input);
      let approvals = 0;
      while (run.status === 'paused' && run.pendingApproval) {
        run = await service.decide(run.runId, true);
        approvals += 1;
      }

      expect(run.status).toBe('completed');
      expect(approvals).toBe(expected.approvals);
      expect(run.artifacts?.length).toBeGreaterThan(0);
      expect(run.context?.objects.some((object) => object.type === expected.contextType)).toBe(true);
      expect(run.context?.relations.length).toBeGreaterThan(0);
    }
  });

  it('runs a model-enabled Agent through a selected compatible provider and projects its usage', async () => {
    const secret = 'server-only-secret';
    let modelRound = 0;
    const request: typeof fetch = async (_input, init) => {
      modelRound += 1;
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${secret}` });
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (modelRound === 1) {
        expect(payload.tools).toHaveLength(2);
        return new Response(JSON.stringify({
          id: 'model-request-1',
          model: 'test-model-resolved',
          choices: [{ message: { content: null, tool_calls: [{
            id: 'read-1',
            type: 'function',
            function: {
              name: 'graph_workbench_tool_2',
              arguments: '{"locator":"reference://technology/runtime-test"}',
            },
          }] } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const messages = payload.messages as Array<Record<string, unknown>>;
      expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'read-1' });
      return new Response(JSON.stringify({
        id: 'model-request-2',
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
      modelEnvironment: { GRAPH_WORKBENCH_MODEL_API_KEY: secret },
      modelFetch: request,
    });
    await service.install('research');
    const workspace = await service.activate('research');
    await service.configureModelProvider({
      providerId: 'custom',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:9876/v1',
    });

    const paused = await service.start(workspace.activePack.input);
    expect(paused.status).toBe('paused');
    expect(paused.state.synthesis).toBe('Model-backed synthesis with preserved evidence.');
    expect(paused.events.find((event) => event.type === 'node.completed' && event.nodeId === 'synthesize'))
      .toMatchObject({ detail: { usage: { providerId: 'custom', totalTokens: 38 } } });
    expect(paused.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['tool.requested', 'tool.started', 'tool.completed']),
    );
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

  it('presents a model-requested external tool for approval and resumes the same exchange', async () => {
    const original = bundledPackCatalog.get('research');
    if (!original) throw new Error('Research runtime is missing.');
    bundledPackCatalog.set('research', {
      ...original,
      manifest: {
        ...researchPack,
        tools: researchPack.tools.map((tool) =>
          tool.id === 'document_read' ? { ...tool, risk: 'external' as const } : tool),
      },
    });
    let providerRequests = 0;
    const request: typeof fetch = async (_input, init) => {
      providerRequests += 1;
      const payload = JSON.parse(String(init?.body)) as { messages?: Array<{ role?: string }> };
      const hasToolResult = payload.messages?.some((message) => message.role === 'tool');
      return new Response(JSON.stringify(hasToolResult ? {
        id: 'governed-final',
        choices: [{ message: { content: '{"synthesis":"Approved external evidence."}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      } : {
        id: 'governed-tool-request',
        choices: [{ message: { content: null, tool_calls: [{
          id: 'governed-read-1',
          type: 'function',
          function: {
            name: 'graph_workbench_tool_2',
            arguments: '{"locator":"reference://technology/runtime-test"}',
          },
        }] } }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const service = new WorkbenchService({ modelFetch: request });
      await service.install('research');
      const workspace = await service.activate('research');
      await service.configureModelProvider({
        providerId: 'custom',
        model: 'governed-model',
        baseUrl: 'http://127.0.0.1:9876/v1',
      });

      const toolPaused = await service.start(workspace.activePack.input);
      expect(toolPaused).toMatchObject({
        status: 'paused',
        pendingApproval: { kind: 'tool', toolId: 'document_read', risk: 'external' },
      });
      expect(providerRequests).toBe(1);

      const humanPaused = await service.decide(toolPaused.runId, true);
      expect(humanPaused).toMatchObject({
        status: 'paused',
        pendingApproval: { kind: 'human', nodeId: 'approval' },
        state: { synthesis: 'Approved external evidence.' },
      });
      expect(providerRequests).toBe(2);

      const completed = await service.decide(toolPaused.runId, true);
      expect(completed.status).toBe('completed');
    } finally {
      bundledPackCatalog.set('research', original);
    }
  });

  it('exposes provider readiness without returning environment secret values', async () => {
    const service = new WorkbenchService({
      modelEnvironment: { OPENAI_API_KEY: 'private-provider-key' },
    });
    const models = (await service.describeWorkbench()).models;
    expect(models.selection.providerId).toBe('deterministic');
    expect(models.providers.find((provider) => provider.id === 'openai')?.configured).toBe(true);
    expect(JSON.stringify(models)).not.toContain('private-provider-key');
  });

  it('never sends a preset provider credential to an overridden endpoint', async () => {
    let requests = 0;
    const service = new WorkbenchService({
      modelEnvironment: { OPENAI_API_KEY: 'private-provider-key' },
      modelFetch: async () => {
        requests += 1;
        return new Response('{}');
      },
    });
    expect(() => service.configureModelProvider({
      providerId: 'openai',
      model: 'gpt-test',
      baseUrl: 'https://attacker.example/v1',
    })).toThrow(/may only be sent to the built-in endpoint/);
    expect(requests).toBe(0);
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
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-'));
    const dataFile = join(directory, 'workbench.json');
    let first: WorkbenchService | undefined;
    let second: WorkbenchService | undefined;
    try {
      first = new WorkbenchService({ dataFile });
      await first.install('research');
      const workspace = await first.activate('research');
      const graph = { ...workspace.activePack.graph, name: 'Persistent research workflow' };
      first.saveDraft('research', graph, { start: { x: 20, y: 40 } });
      const paused = await first.start(workspace.activePack.input);

      second = new WorkbenchService({ dataFile });
      const restored = await second.describeWorkbench();
      expect(restored.activePackId).toBe('research');
      expect(restored.installedPackIds).toEqual(['architecture', 'research']);
      expect(restored.activePack.graph.name).toBe('Persistent research workflow');
      expect(second.get(paused.runId)?.status).toBe('paused');
    } finally {
      await Promise.all([first?.close(), second?.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('describes every graph in a multi-graph Pack and keeps the selected draft', () => {
    const service = new WorkbenchService();
    const pack = service.describePack('customer_success', 'customer_success.scheduled_health_scan');
    expect(pack.graph.id).toBe('customer_success.scheduled_health_scan');
    expect(pack.graph.trigger).toMatchObject({ type: 'schedule' });
    expect(pack.fixtures.every((fixture) => fixture.graphId === pack.graph.id)).toBe(true);

    const edited = { ...pack.graph, name: 'Edited scheduled health scan' };
    service.saveDraft(pack.id, edited, { start: { x: 40, y: 80 } });
    expect(service.describePack(pack.id, edited.id)).toMatchObject({
      graph: { name: 'Edited scheduled health scan' },
      positions: { start: { x: 40, y: 80 } },
    });
    expect(service.describePack(pack.id).graph.id).not.toBe(edited.id);

    const child = service.describePack(pack.id, 'customer_success.scan_preparation');
    expect(child.fixtures).toEqual([]);
    expect(child.input).toEqual({});
  });

  it('aggregates confirmed context from multiple Packs across a service restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-workbench-context-'));
    const dataFile = join(directory, 'workbench.json');
    let first: WorkbenchService | undefined;
    let second: WorkbenchService | undefined;
    try {
      first = new WorkbenchService({ dataFile });
      const architecturePaused = await first.start(first.describePack().input);
      const architectureCompleted = await first.decide(architecturePaused.runId, true);

      await first.install('research');
      const researchInput = first.describePack('research').input;
      const researchPaused = await first.start(researchInput);
      const researchCompleted = await first.decide(researchPaused.runId, true);

      await first.close();
      first = undefined;
      const persisted = JSON.parse(await readFile(dataFile, 'utf8')) as {
        runs: Record<string, Record<string, unknown>>;
      };
      for (const session of Object.values(persisted.runs)) delete session.context;
      await writeFile(dataFile, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');

      second = new WorkbenchService({ dataFile });
      const restored = await second.describeWorkbench();
      expect(restored.context.sourceRunIds).toEqual(expect.arrayContaining([
        architectureCompleted.runId,
        researchCompleted.runId,
      ]));
      expect(restored.context.sourceRunIds).toHaveLength(2);
      expect(restored.context.objects).toEqual(expect.arrayContaining([
        expect.objectContaining({
          provenance: expect.objectContaining({ producedByRunId: architectureCompleted.runId }),
        }),
        expect.objectContaining({
          provenance: expect.objectContaining({ producedByRunId: researchCompleted.runId }),
        }),
      ]));
      expect(restored.context.relations.length).toBeGreaterThan(0);
    } finally {
      await Promise.all([first?.close(), second?.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
