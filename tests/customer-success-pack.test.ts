import { describe, expect, it } from 'vitest';
import { customerSuccessHandlers, customerSuccessPack, projectCustomerSuccessRun } from '@graph-workbench/pack-customer-success';
import { compilePack, GraphRuntime, InMemoryContextGraphStore } from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';

describe('Customer Success Industry Pack', () => {
  it('compiles as a domain-only Pack with two golden fixtures', () => {
    const compiled = compilePack(customerSuccessPack);
    expect(compiled.graphs.get('customer_success.renewal_workflow')?.definition.nodes).toHaveLength(12);
    expect(compiled.manifest.fixtures.map((fixture) => fixture.id)).toEqual(['enterprise_renewal', 'expansion_ready']);
  });

  it('passes every zero-key golden fixture', async () => {
    const results = await runAllPackFixtures(customerSuccessPack, customerSuccessHandlers);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.expectations).every((item) => item.passed)).toBe(true);
  });

  it('requires revenue-owner approval before publishing', async () => {
    const fixture = customerSuccessPack.fixtures[0]!;
    const graph = compilePack(customerSuccessPack).graphs.get(fixture.graphId);
    if (!graph) throw new Error('Customer Success workflow is missing.');
    const paused = await new GraphRuntime(graph, { handlers: customerSuccessHandlers, pack: customerSuccessPack }).run(fixture.input);
    expect(paused.status).toBe('paused');
    expect(paused.state.deliverable).toBeUndefined();
  });

  it('projects approved work into evidence- and decision-linked context', async () => {
    const fixture = customerSuccessPack.fixtures[0]!;
    const graph = compilePack(customerSuccessPack).graphs.get(fixture.graphId);
    if (!graph) throw new Error('Customer Success workflow is missing.');
    const result = await new GraphRuntime(graph, { handlers: customerSuccessHandlers, pack: customerSuccessPack }).run(fixture.input, { runId: 'run-customer-success', decisions: fixture.decisions });
    const store = new InMemoryContextGraphStore(customerSuccessPack);
    await projectCustomerSuccessRun(store, result);
    const objects = await store.listObjects();
    const relations = await store.listRelations();
    expect(objects.some((object) => object.type === 'renewal_risk')).toBe(true);
    expect(objects.some((object) => object.type === 'success_plan')).toBe(true);
    expect(relations.some((relation) => relation.type === 'risk_supported_by')).toBe(true);
    expect(relations.some((relation) => relation.type === 'decision_governs')).toBe(true);
  });
});
