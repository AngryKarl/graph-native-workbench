import { describe, expect, it } from 'vitest';
import { healthcareDiagnosticsHandlers, healthcareDiagnosticsPack, projectHealthcareDiagnosticsRun } from '@graph-workbench/pack-healthcare-diagnostics';
import { compilePack, GraphRuntime, GraphTriggerDispatcher, InMemoryContextGraphStore } from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';

describe('Healthcare Diagnostic Coordination Pack', () => {
  it('compiles three FHIR-shaped coordination graphs and five typed boundaries', () => {
    const compiled = compilePack(healthcareDiagnosticsPack);
    expect([...compiled.graphs.keys()]).toEqual(['healthcare_diagnostics.diagnostic_coordination', 'healthcare_diagnostics.analyze_study', 'healthcare_diagnostics.followup_observation']);
    expect(compiled.manifest.tools).toHaveLength(5);
  });

  it('passes routine, urgent, access-rejected and unexpected-followup fixtures without keys', async () => {
    const results = await runAllPackFixtures(healthcareDiagnosticsPack, healthcareDiagnosticsHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('requires access and specialist decisions before publishing a report', async () => {
    const fixture = healthcareDiagnosticsPack.fixtures[0]!;
    const graph = compilePack(healthcareDiagnosticsPack).graphs.get(fixture.graphId)!;
    const runtime = new GraphRuntime(graph, { pack: healthcareDiagnosticsPack, handlers: healthcareDiagnosticsHandlers });
    const access = await runtime.run(fixture.input, { runId: 'run-health-access' });
    expect(access).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['access_approval'] } });
    expect(access.state.study_analyses).toBeUndefined();
    const specialist = await runtime.run(fixture.input, { runId: 'run-health-specialist', decisions: { access_approval: true } });
    expect(specialist).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['specialist_review'] } });
    expect(specialist.state.diagnostic_report).toBeUndefined();
  });

  it('dispatches unexpected follow-up events into visible specialist escalation', async () => {
    const fixture = healthcareDiagnosticsPack.fixtures.find((item) => item.id === 'unexpected_followup')!;
    const dispatcher = new GraphTriggerDispatcher(compilePack(healthcareDiagnosticsPack), { handlers: healthcareDiagnosticsHandlers });
    const [triggered] = await dispatcher.dispatchEvent({ id: 'followup-1002', type: 'diagnostic.followup_observed', correlationKey: 'case-1002', payload: { report_id: fixture.input.report_id, followup_observations: fixture.input.followup_observations }, occurredAt: '2026-08-11T12:00:00.000Z' });
    expect(triggered?.result).toMatchObject({ status: 'completed', state: { case_id: 'case-1002', followup_expected: false, review_scheduled: true } });
    expect(triggered?.result.events.map((event) => event.type)).toContain('escalation.raised');
  });

  it('projects request, consent, study, observation, specialist report and follow-up context', async () => {
    const compiled = compilePack(healthcareDiagnosticsPack);
    const fixture = healthcareDiagnosticsPack.fixtures[0]!;
    const result = await new GraphRuntime(compiled.graphs.get(fixture.graphId)!, { pack: healthcareDiagnosticsPack, handlers: healthcareDiagnosticsHandlers }).run(fixture.input, { runId: 'run-health-context', decisions: fixture.decisions });
    const store = new InMemoryContextGraphStore(healthcareDiagnosticsPack);
    await projectHealthcareDiagnosticsRun(store, result);
    expect((await store.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining(['service_request', 'consent_record', 'study', 'observation', 'practitioner_decision', 'diagnostic_report', 'followup_plan', 'diagnostic_record']));
    expect((await store.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining(['authorized_by', 'fulfills_request', 'derived_from_study', 'governs_report', 'includes_observation', 'responds_to_request', 'defines_followup', 'documents_diagnostic_work']));
  });
});
