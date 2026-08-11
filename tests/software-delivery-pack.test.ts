import { describe, expect, it } from 'vitest';
import {
  projectSoftwareDeliveryRun,
  softwareDeliveryHandlers,
  softwareDeliveryPack,
  softwareDeliveryTools,
} from '@graph-workbench/pack-software-delivery';
import {
  compilePack,
  GraphRuntime,
  GraphTriggerDispatcher,
  InMemoryContextGraphStore,
} from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';
import { WorkbenchService } from '../apps/workbench/src/service.js';

describe('Professional Software Delivery Pack', () => {
  it('compiles three domain graphs without extending the kernel', () => {
    const compiled = compilePack(softwareDeliveryPack);
    expect([...compiled.graphs.keys()]).toEqual([
      'software_delivery.change_to_release',
      'software_delivery.run_check',
      'software_delivery.observe_deployment',
    ]);
    expect(compiled.manifest.tools).toHaveLength(5);
    expect(compiled.manifest.deliverables.map((item) => item.id)).toEqual([
      'release_readiness_record',
      'deployment_observation_record',
    ]);
  });

  it('passes normal, hotfix, healthy deployment and rollback fixtures without keys', async () => {
    const results = await runAllPackFixtures(softwareDeliveryPack, softwareDeliveryHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.expectations).every((item) => item.passed)).toBe(true);
  });

  it('requires code-owner review before preparing a release', async () => {
    const fixture = softwareDeliveryPack.fixtures[0]!;
    const graph = compilePack(softwareDeliveryPack).graphs.get(fixture.graphId);
    if (!graph) throw new Error('Issue-to-release graph is missing.');
    const result = await new GraphRuntime(graph, {
      pack: softwareDeliveryPack,
      handlers: softwareDeliveryHandlers,
    }).run(fixture.input);

    expect(result.status).toBe('paused');
    expect(result.state.release_candidate).toBeUndefined();
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'map.completed', nodeId: 'run_checks' }),
      expect.objectContaining({ type: 'human.requested', nodeId: 'code_review' }),
    ]));
  });

  it('dispatches deployment events and records escalation plus compensation', async () => {
    const compiled = compilePack(softwareDeliveryPack);
    const dispatcher = new GraphTriggerDispatcher(compiled, { handlers: softwareDeliveryHandlers });
    const [triggered] = await dispatcher.dispatchEvent({
      id: 'deployment-observation-907',
      type: 'deployment.observed',
      correlationKey: 'acme/payments@4.12.3',
      payload: {
        deployment_id: 'deploy-907',
        environment: 'production',
        status: 'failed',
        artifact_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        health_signals: [{ name: 'payment_error_rate', status: 'failed', value: 0.12 }],
      },
      occurredAt: '2026-08-11T02:00:00.000Z',
    });

    expect(triggered?.result).toMatchObject({
      status: 'completed',
      state: { release_id: 'acme/payments@4.12.3', rollback_completed: true },
    });
    expect(triggered?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'trigger.accepted',
      'escalation.raised',
      'compensation.completed',
    ]));
  });

  it('projects approved release evidence and deployment incidents into the context graph', async () => {
    const compiled = compilePack(softwareDeliveryPack);
    const releaseFixture = softwareDeliveryPack.fixtures[0]!;
    const releaseGraph = compiled.graphs.get(releaseFixture.graphId)!;
    const release = await new GraphRuntime(releaseGraph, {
      pack: softwareDeliveryPack,
      handlers: softwareDeliveryHandlers,
    }).run(releaseFixture.input, { runId: 'run-software-release', decisions: releaseFixture.decisions });
    const releaseStore = new InMemoryContextGraphStore(softwareDeliveryPack);
    await projectSoftwareDeliveryRun(releaseStore, release);
    expect((await releaseStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'work_item', 'change_set', 'change_request', 'verification', 'build_provenance',
      'release', 'deployment_request', 'delivery_record',
    ]));
    expect((await releaseStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'implements', 'proposed_as', 'validates', 'governs', 'contains_change',
      'produces', 'requests_promotion', 'documents',
    ]));

    const incidentFixture = softwareDeliveryPack.fixtures.find((item) => item.id === 'failed_deployment_rollback')!;
    const incidentGraph = compiled.graphs.get(incidentFixture.graphId)!;
    const incident = await new GraphRuntime(incidentGraph, {
      pack: softwareDeliveryPack,
      handlers: softwareDeliveryHandlers,
    }).run(incidentFixture.input, { runId: 'run-software-incident' });
    const incidentStore = new InMemoryContextGraphStore(softwareDeliveryPack);
    await projectSoftwareDeliveryRun(incidentStore, incident);
    expect((await incidentStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'release', 'deployment', 'incident', 'delivery_record',
    ]));
    expect((await incidentStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'promotes', 'affects', 'documents',
    ]));
  });

  it('ships deterministic typed reference connectors', async () => {
    expect(await softwareDeliveryTools.repository_read!.execute({
      repository: 'acme/billing-api',
      ref: 'main',
    }, { nodeId: 'test', runId: 'run-test', secrets: {}, signal: new AbortController().signal })).toMatchObject({
      repository: 'acme/billing-api',
      commit_sha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
  });

  it('runs as an installable bundled Pack through the Workbench service', async () => {
    const service = new WorkbenchService();
    try {
      expect((await service.describeWorkbench()).catalog.some((item) => item.id === 'software_delivery')).toBe(true);
      await service.install('software_delivery');
      const workspace = await service.activate('software_delivery');
      expect(workspace.activePack.graph.id).toBe('software_delivery.change_to_release');

      const firstPause = await service.start(softwareDeliveryPack.fixtures[0]!.input);
      expect(firstPause).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'code_review' } });
      const secondPause = await service.decide(firstPause.runId, true);
      expect(secondPause).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'release_approval' } });
      const completed = await service.decide(firstPause.runId, true);
      expect(completed).toMatchObject({
        status: 'completed',
        state: { release_record: expect.stringContaining('# Release readiness record') },
      });
      expect(completed.context?.objects.some((item) => item.type === 'release')).toBe(true);
    } finally {
      await service.close();
    }
  });
});
