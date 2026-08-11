import { describe, expect, it } from 'vitest';
import {
  cybersecurityResponseHandlers,
  cybersecurityResponsePack,
  cybersecurityResponseTools,
  projectCybersecurityResponseRun,
} from '@graph-workbench/pack-cybersecurity-response';
import {
  compilePack,
  GraphRuntime,
  GraphTriggerDispatcher,
  InMemoryContextGraphStore,
} from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';
import { WorkbenchService } from '../apps/workbench/src/service.js';

describe('Cybersecurity Incident Response Pack', () => {
  it('compiles three domain graphs and eight typed connector contracts', () => {
    const compiled = compilePack(cybersecurityResponsePack);
    expect([...compiled.graphs.keys()]).toEqual([
      'cybersecurity_response.incident_response',
      'cybersecurity_response.analyze_evidence',
      'cybersecurity_response.observe_recovery',
    ]);
    expect(compiled.manifest.tools).toHaveLength(8);
    expect(compiled.manifest.deliverables.map((item) => item.id)).toEqual(['incident_record', 'recovery_record']);
  });

  it('passes credential, ransomware, non-incident and failed-recovery fixtures without keys', async () => {
    const results = await runAllPackFixtures(cybersecurityResponsePack, cybersecurityResponseHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.expectations).every((item) => item.passed)).toBe(true);
  });

  it('requires declaration, containment and recovery decisions in order', async () => {
    const fixture = cybersecurityResponsePack.fixtures.find((item) => item.id === 'privileged_credential_compromise')!;
    const graph = compilePack(cybersecurityResponsePack).graphs.get(fixture.graphId)!;
    const runtime = new GraphRuntime(graph, { pack: cybersecurityResponsePack, handlers: cybersecurityResponseHandlers });

    const declaration = await runtime.run(fixture.input, { runId: 'run-security-declaration' });
    expect(declaration.status).toBe('paused');
    expect(declaration.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'incident_declaration_approval' }),
    ]));
    expect(declaration.state.containment_plan).toBeUndefined();

    const containment = await runtime.run(fixture.input, {
      runId: 'run-security-containment', decisions: { incident_declaration_approval: true },
    });
    expect(containment.status).toBe('paused');
    expect(containment.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'containment_approval' }),
    ]));
    expect(containment.state.containment_results).toBeUndefined();

    const recovery = await runtime.run(fixture.input, {
      runId: 'run-security-recovery', decisions: { incident_declaration_approval: true, containment_approval: true },
    });
    expect(recovery.status).toBe('paused');
    expect(recovery.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'human.requested', nodeId: 'recovery_approval' }),
    ]));
    expect(recovery.state.recovery_result).toBeUndefined();
  });

  it('dispatches recovery events with visible escalation and safe compensation', async () => {
    const dispatcher = new GraphTriggerDispatcher(compilePack(cybersecurityResponsePack), { handlers: cybersecurityResponseHandlers });
    const [triggered] = await dispatcher.dispatchEvent({
      id: 'recovery-observation-77',
      type: 'security.recovery_observed',
      correlationKey: 'incident-ransomware-901',
      payload: {
        incident_title: 'Encryption behavior and lateral movement detected', incident_severity: 'critical',
        recovery_id: 'recovery-77', change_ref: 'change://rebuild/77', recovery_status: 'degraded',
        containment_still_active: true,
        health_signals: [{ name: 'malware_scan', status: 'failed' }],
      },
      occurredAt: '2026-08-11T05:00:00.000Z',
    });
    expect(triggered?.result).toMatchObject({
      status: 'completed',
      state: { incident_id: 'incident-ransomware-901', recovery_healthy: false, recovery_rollback_completed: true },
    });
    expect(triggered?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'trigger.accepted', 'escalation.raised', 'compensation.completed',
    ]));
  });

  it('projects incident, non-incident and recovery evidence into typed context graphs', async () => {
    const compiled = compilePack(cybersecurityResponsePack);
    const incidentFixture = cybersecurityResponsePack.fixtures.find((item) => item.id === 'privileged_credential_compromise')!;
    const incident = await new GraphRuntime(compiled.graphs.get(incidentFixture.graphId)!, {
      pack: cybersecurityResponsePack, handlers: cybersecurityResponseHandlers,
    }).run(incidentFixture.input, { runId: 'run-security-incident-context', decisions: incidentFixture.decisions });
    const incidentStore = new InMemoryContextGraphStore(cybersecurityResponsePack);
    await projectCybersecurityResponseRun(incidentStore, incident);
    expect((await incidentStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'security_signal', 'security_indicator', 'affected_asset', 'affected_identity', 'security_evidence',
      'security_incident', 'severity_assessment', 'response_action', 'security_decision', 'lessons_learned',
      'security_delivery_record',
    ]));
    expect((await incidentStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'classifies_signal', 'indicates_incident', 'supported_by_evidence', 'has_indicator',
      'affects_security_asset', 'affects_security_identity', 'mitigates_incident', 'governs_response',
      'improves_after_incident', 'documents_security_work',
    ]));

    const closureFixture = cybersecurityResponsePack.fixtures.find((item) => item.id === 'benign_administration_activity')!;
    const closure = await new GraphRuntime(compiled.graphs.get(closureFixture.graphId)!, {
      pack: cybersecurityResponsePack, handlers: cybersecurityResponseHandlers,
    }).run(closureFixture.input, { runId: 'run-security-closure-context' });
    const closureStore = new InMemoryContextGraphStore(cybersecurityResponsePack);
    await projectCybersecurityResponseRun(closureStore, closure);
    expect((await closureStore.listObjects()).some((item) => item.type === 'security_incident')).toBe(false);
    expect((await closureStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'classifies_signal', 'documents_security_work',
    ]));

    const recoveryFixture = cybersecurityResponsePack.fixtures.find((item) => item.id === 'failed_recovery_change')!;
    const recovery = await new GraphRuntime(compiled.graphs.get(recoveryFixture.graphId)!, {
      pack: cybersecurityResponsePack, handlers: cybersecurityResponseHandlers,
    }).run(recoveryFixture.input, { runId: 'run-security-recovery-context' });
    const recoveryStore = new InMemoryContextGraphStore(cybersecurityResponsePack);
    await projectCybersecurityResponseRun(recoveryStore, recovery);
    expect((await recoveryStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'security_incident', 'recovery_observation', 'response_action', 'security_delivery_record',
    ]));
    expect((await recoveryStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'observes_incident_recovery', 'mitigates_incident', 'documents_security_work',
    ]));
  });

  it('ships deterministic typed reference connectors', async () => {
    expect(await cybersecurityResponseTools.containment_execute!.execute({
      idempotency_key: 'incident-42:isolate:asset-1', action_type: 'isolate_asset',
      target_id: 'asset-1', incident_id: 'incident-42',
    }, { nodeId: 'test', runId: 'run-test', secrets: {}, signal: new AbortController().signal })).toMatchObject({
      action_id: 'containment-incident-42-isolate-asset-1', status: 'completed',
    });
  });

  it('runs as an installable bundled Pack through the Workbench service', async () => {
    const service = new WorkbenchService();
    try {
      expect((await service.describeWorkbench()).catalog.some((item) => item.id === 'cybersecurity_response')).toBe(true);
      await service.install('cybersecurity_response');
      const workspace = await service.activate('cybersecurity_response');
      expect(workspace.activePack.graph.id).toBe('cybersecurity_response.incident_response');

      const declaration = await service.start(cybersecurityResponsePack.fixtures[0]!.input);
      expect(declaration).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'incident_declaration_approval' } });
      const containment = await service.decide(declaration.runId, true);
      expect(containment).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'containment_approval' } });
      const recovery = await service.decide(declaration.runId, true);
      expect(recovery).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'recovery_approval' } });
      const completed = await service.decide(declaration.runId, true);
      expect(completed).toMatchObject({
        status: 'completed', state: { incident_record: expect.stringContaining('# Cybersecurity incident response') },
      });
      expect(completed.context?.objects.some((item) => item.type === 'security_incident')).toBe(true);
    } finally {
      await service.close();
    }
  });
});
