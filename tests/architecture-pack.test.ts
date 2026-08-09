import { describe, expect, it } from 'vitest';
import {
  architectureHandlers,
  architecturePack,
  projectArchitectureRun,
} from '@graphwork/pack-architecture';
import { compilePack, GraphRuntime, InMemoryContextGraphStore } from '@graphwork/core';
import { runAllPackFixtures } from '@graphwork/pack-sdk';

describe('Architecture Industry Pack', () => {
  it('compiles as a domain-only Pack with a declared deliverable and golden fixtures', () => {
    const compiled = compilePack(architecturePack);
    expect(compiled.graphs.get('architecture.concept_workflow')?.definition.nodes).toHaveLength(13);
    expect(compiled.manifest.deliverables).toMatchObject([
      { id: 'concept_design_brief', stateField: 'deliverable', mediaType: 'text/markdown' },
    ]);
    expect(compiled.manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      'street_renewal',
      'transit_culture_hub',
    ]);
  });

  it('passes every zero-key golden fixture', async () => {
    const results = await runAllPackFixtures(architecturePack, architectureHandlers);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.expectations).every((item) => item.passed)).toBe(true);
    expect(results[0]?.state.deliverable).toContain('# 概念设计简报');
    expect(results[1]?.state.deliverable).toContain('# Concept design brief');
  });

  it('pauses for design review before producing a deliverable', async () => {
    const fixture = architecturePack.fixtures[0]!;
    const graph = compilePack(architecturePack).graphs.get(fixture.graphId);
    if (!graph) throw new Error('Architecture workflow is missing.');
    const result = await new GraphRuntime(graph, {
      handlers: architectureHandlers,
      pack: architecturePack,
    }).run(fixture.input);

    expect(result.status).toBe('paused');
    expect(result.state.deliverable).toBeUndefined();
    expect(result.events.some((event) => event.type === 'human.requested')).toBe(true);
  });

  it('projects an approved run into typed, provenance-linked business records', async () => {
    const fixture = architecturePack.fixtures[0]!;
    const graph = compilePack(architecturePack).graphs.get(fixture.graphId);
    if (!graph) throw new Error('Architecture workflow is missing.');
    const result = await new GraphRuntime(graph, {
      handlers: architectureHandlers,
      pack: architecturePack,
    }).run(fixture.input, { runId: 'run-architecture-projection', decisions: fixture.decisions });
    expect(result.status).toBe('completed');

    const store = new InMemoryContextGraphStore(architecturePack);
    await projectArchitectureRun(store, result);
    const objects = await store.listObjects();
    const relations = await store.listRelations();

    expect(objects.some((object) => object.type === 'source_evidence')).toBe(true);
    expect(objects.some((object) => object.type === 'design_direction')).toBe(true);
    expect(objects.find((object) => object.type === 'deliverable')).toMatchObject({
      status: 'confirmed',
      provenance: { producedByRunId: 'run-architecture-projection', producedByNodeId: 'publish' },
    });
    expect(relations.some((relation) => relation.type === 'evidence_supports')).toBe(true);
    expect(relations.some((relation) => relation.type === 'decision_governs')).toBe(true);
  });
});
