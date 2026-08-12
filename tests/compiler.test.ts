import { describe, expect, it } from 'vitest';
import { researchPack } from '@graph-workbench/pack-research';
import { architecturePack } from '@graph-workbench/pack-architecture';
import { compileGraph, compilePack, GraphCompileError } from '@graph-workbench/core';

describe('graph compiler', () => {
  it('compiles a valid Industry Pack and its execution graph', () => {
    const compiled = compilePack(researchPack);
    expect(compiled.graphs.get('research.workflow')?.triggerNodeId).toBe('start');
  });

  it('rejects an edge that targets an unknown node', () => {
    const graph = structuredClone(researchPack.graphs[0]!);
    graph.edges[0]!.target = 'missing_node';
    expect(() => compileGraph(graph)).toThrow(GraphCompileError);
    expect(() => compileGraph(graph)).toThrow(/unknown target/);
  });

  it('rejects a node that writes an undeclared state field', () => {
    const graph = structuredClone(researchPack.graphs[0]!);
    graph.nodes[1]!.writes = ['secret_output'];
    expect(() => compileGraph(graph)).toThrow(/undeclared state field/);
  });

  it('rejects Pack nodes that reference an unknown role', () => {
    const pack = structuredClone(researchPack);
    pack.graphs[0]!.nodes[2]!.config.roleId = 'missing_role';
    expect(() => compilePack(pack)).toThrow(/unknown role/);
  });

  it('rejects a deliverable or fixture that references an unknown state field', () => {
    const pack = structuredClone(researchPack);
    pack.deliverables[0]!.stateField = 'missing_output';
    pack.fixtures[0]!.expectations[0]!.field = 'missing_result';
    expect(() => compilePack(pack)).toThrow(/unknown state field "missing_output"/);
    expect(() => compilePack(pack)).toThrow(/unknown state field "missing_result"/);
  });

  it('rejects incomplete or unsafe typed Tool contracts', () => {
    const incomplete = structuredClone(researchPack) as unknown as Record<string, unknown>;
    const incompleteTools = incomplete.tools as Array<Record<string, unknown>>;
    delete incompleteTools[0]!.outputSchema;
    expect(() => compilePack(incomplete)).toThrow(/must declare operation, inputSchema, outputSchema and idempotency together/);

    const unsafeQuery = structuredClone(researchPack) as unknown as Record<string, unknown>;
    const unsafeTools = unsafeQuery.tools as Array<Record<string, unknown>>;
    unsafeTools[0]!.idempotency = 'none';
    expect(() => compilePack(unsafeQuery)).toThrow(/Query tools must be intrinsically idempotent/);
  });

  it('rejects Artifact declarations with unknown or repeated Evidence fields', () => {
    const unknown = structuredClone(researchPack);
    unknown.deliverables[0]!.evidenceFields = ['missing_evidence'];
    expect(() => compilePack(unknown)).toThrow(/unknown evidence field "missing_evidence"/);

    const repeated = structuredClone(researchPack);
    repeated.deliverables[0]!.evidenceFields = ['market_evidence', 'market_evidence'];
    expect(() => compilePack(repeated)).toThrow(/repeats evidence field "market_evidence"/);
  });

  it('rejects unsafe orchestration mappings and duplicate webhook ingress', () => {
    const invalidMapping = structuredClone(architecturePack);
    const followup = invalidMapping.graphs.find((graph) => graph.id === 'architecture.feedback_followup')!;
    followup.nodes.find((node) => node.id === 'summarize')!.reads = [];
    expect(() => compilePack(invalidMapping)).toThrow(/must declare mapped input "feedback" in reads/);

    const duplicateWebhook = structuredClone(architecturePack);
    const duplicate = structuredClone(followup);
    duplicate.id = 'architecture.duplicate_followup';
    duplicateWebhook.graphs.push(duplicate);
    expect(() => compilePack(duplicateWebhook)).toThrow(/Duplicate webhook trigger/);
  });

  it('rejects invalid joins and duplicate incoming sources', () => {
    const invalidMode = structuredClone(researchPack.graphs[0]!);
    const join = invalidMode.nodes.find((node) => node.kind === 'join')!;
    join.config.mode = 'sometimes';
    expect(() => compileGraph(invalidMode)).toThrow(/Join node .* has invalid config/);

    const duplicateSource = structuredClone(researchPack.graphs[0]!);
    const duplicateJoin = duplicateSource.nodes.find((node) => node.kind === 'join')!;
    const incoming = duplicateSource.edges.filter((edge) => edge.target === duplicateJoin.id);
    incoming[1]!.source = incoming[0]!.source;
    expect(() => compileGraph(duplicateSource)).toThrow(/requires at least two incoming branches/);
  });
});
