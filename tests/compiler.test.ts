import { describe, expect, it } from 'vitest';
import { researchPack } from '@graph-workbench/pack-research';
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
});
