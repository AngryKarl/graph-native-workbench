import { describe, expect, it } from 'vitest';
import {
  dataMlopsHandlers,
  dataMlopsPack,
  dataMlopsTools,
  projectDataMlopsRun,
} from '@graph-workbench/pack-data-mlops';
import {
  compilePack,
  GraphRuntime,
  GraphTriggerDispatcher,
  InMemoryContextGraphStore,
} from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';
import { WorkbenchService } from '../apps/workbench/src/service.js';

describe('Data and MLOps Asset Release Pack', () => {
  it('compiles four domain graphs and six typed connector contracts', () => {
    const compiled = compilePack(dataMlopsPack);
    expect([...compiled.graphs.keys()]).toEqual([
      'data_mlops.asset_release',
      'data_mlops.process_partition',
      'data_mlops.controlled_backfill',
      'data_mlops.monitor_asset',
    ]);
    expect(compiled.manifest.tools).toHaveLength(6);
    expect(compiled.manifest.deliverables.map((item) => item.id)).toEqual([
      'asset_release_record', 'backfill_record', 'monitoring_record',
    ]);
  });

  it('passes dataset, model, backfill and quality-incident fixtures without keys', async () => {
    const results = await runAllPackFixtures(dataMlopsPack, dataMlopsHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.expectations).every((item) => item.passed)).toBe(true);
  });

  it('keeps dataset publication behind owner and registry decisions', async () => {
    const fixture = dataMlopsPack.fixtures.find((item) => item.id === 'daily_customer_dataset')!;
    const graph = compilePack(dataMlopsPack).graphs.get(fixture.graphId)!;
    const runtime = new GraphRuntime(graph, { pack: dataMlopsPack, handlers: dataMlopsHandlers });

    const ownerPause = await runtime.run(fixture.input, { runId: 'run-data-owner' });
    expect(ownerPause.status).toBe('paused');
    expect(ownerPause.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'data_owner_approval' }),
    ]));
    expect(ownerPause.state.registry_release).toBeUndefined();

    const releasePause = await runtime.run(fixture.input, {
      runId: 'run-data-release', decisions: { data_owner_approval: true },
    });
    expect(releasePause.status).toBe('paused');
    expect(releasePause.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'release_approval' }),
    ]));
    expect(releasePause.state.model_risk_approved).toBeUndefined();
  });

  it('adds independent model-risk review before registry publication', async () => {
    const fixture = dataMlopsPack.fixtures.find((item) => item.id === 'churn_model_candidate')!;
    const graph = compilePack(dataMlopsPack).graphs.get(fixture.graphId)!;
    const runtime = new GraphRuntime(graph, { pack: dataMlopsPack, handlers: dataMlopsHandlers });
    const modelPause = await runtime.run(fixture.input, {
      runId: 'run-model-risk', decisions: { data_owner_approval: true },
    });
    expect(modelPause.status).toBe('paused');
    expect(modelPause.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'model_risk_approval' }),
    ]));
    expect(modelPause.state.registry_release).toBeUndefined();
  });

  it('dispatches quality events with visible escalation and compensation', async () => {
    const dispatcher = new GraphTriggerDispatcher(compilePack(dataMlopsPack), { handlers: dataMlopsHandlers });
    const [triggered] = await dispatcher.dispatchEvent({
      id: 'quality-observation-17',
      type: 'data.asset_quality_observed',
      correlationKey: 'ml.customer_churn',
      payload: {
        asset_version: '17', registry_entry_id: 'models://retention/customer_churn/17',
        registry: 'models://retention', alias: 'champion-candidate', asset_kind: 'model',
        quality_signals: [{ name: 'prediction_drift', status: 'failed', value: 0.21 }],
      },
      occurredAt: '2026-08-11T03:00:00.000Z',
    });
    expect(triggered?.result).toMatchObject({
      status: 'completed',
      state: { asset_id: 'ml.customer_churn', asset_healthy: false, rollback_completed: true },
    });
    expect(triggered?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'trigger.accepted', 'escalation.raised', 'compensation.completed',
    ]));
  });

  it('projects release, backfill and incident evidence into typed context graphs', async () => {
    const compiled = compilePack(dataMlopsPack);
    const releaseFixture = dataMlopsPack.fixtures.find((item) => item.id === 'daily_customer_dataset')!;
    const release = await new GraphRuntime(compiled.graphs.get(releaseFixture.graphId)!, {
      pack: dataMlopsPack, handlers: dataMlopsHandlers,
    }).run(releaseFixture.input, { runId: 'run-data-release-context', decisions: releaseFixture.decisions });
    const releaseStore = new InMemoryContextGraphStore(dataMlopsPack);
    await projectDataMlopsRun(releaseStore, release);
    expect((await releaseStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'data_asset', 'asset_version', 'data_partition', 'schema_contract', 'quality_evaluation',
      'lineage_source', 'governance_decision', 'registry_release', 'data_delivery_record',
    ]));
    expect((await releaseStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'has_version', 'partition_of', 'conforms_to', 'validates_asset', 'derived_from',
      'governs_release', 'publishes_version', 'documents_data_work',
    ]));

    const backfillFixture = dataMlopsPack.fixtures.find((item) => item.id === 'failed_only_backfill')!;
    const backfill = await new GraphRuntime(compiled.graphs.get(backfillFixture.graphId)!, {
      pack: dataMlopsPack, handlers: dataMlopsHandlers,
    }).run(backfillFixture.input, { runId: 'run-data-backfill-context', decisions: backfillFixture.decisions });
    const backfillStore = new InMemoryContextGraphStore(dataMlopsPack);
    await projectDataMlopsRun(backfillStore, backfill);
    expect((await backfillStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'reprocesses', 'documents_data_work',
    ]));

    const incidentFixture = dataMlopsPack.fixtures.find((item) => item.id === 'model_quality_degradation')!;
    const incident = await new GraphRuntime(compiled.graphs.get(incidentFixture.graphId)!, {
      pack: dataMlopsPack, handlers: dataMlopsHandlers,
    }).run(incidentFixture.input, { runId: 'run-data-incident-context' });
    const incidentStore = new InMemoryContextGraphStore(dataMlopsPack);
    await projectDataMlopsRun(incidentStore, incident);
    expect((await incidentStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'registry_release', 'quality_incident', 'data_delivery_record',
    ]));
    expect((await incidentStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'affects_release', 'documents_data_work',
    ]));
  });

  it('ships deterministic typed reference connectors', async () => {
    expect(await dataMlopsTools.registry_publish!.execute({
      idempotency_key: 'run-17:publish', asset_id: 'ml.customer_churn', version: '17', registry: 'models://retention',
    }, { nodeId: 'test', runId: 'run-test', secrets: {}, signal: new AbortController().signal })).toMatchObject({
      registry_id: 'registry-run-17-publish', status: 'published',
    });
  });

  it('runs as an installable bundled Pack through the Workbench service', async () => {
    const service = new WorkbenchService();
    try {
      expect((await service.describeWorkbench()).catalog.some((item) => item.id === 'data_mlops')).toBe(true);
      await service.install('data_mlops');
      const workspace = await service.activate('data_mlops');
      expect(workspace.activePack.graph.id).toBe('data_mlops.asset_release');

      const firstPause = await service.start(dataMlopsPack.fixtures[0]!.input);
      expect(firstPause).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'data_owner_approval' } });
      const secondPause = await service.decide(firstPause.runId, true);
      expect(secondPause).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'release_approval' } });
      const completed = await service.decide(firstPause.runId, true);
      expect(completed).toMatchObject({
        status: 'completed', state: { asset_release_record: expect.stringContaining('# Data asset release') },
      });
      expect(completed.context?.objects.some((item) => item.type === 'registry_release')).toBe(true);
    } finally {
      await service.close();
    }
  });
});
