import { describe, expect, it } from 'vitest';
import type { GraphDefinition, GraphNode } from '@graph-workbench/contracts';
import { createAutomaticLayout, deriveStageBands } from '../apps/workbench/src/client/graph-model.js';

function linearGraph(kinds: GraphNode['kind'][]): GraphDefinition {
  const nodes = kinds.map((kind, index): GraphNode => ({
    id: `node_${index}`,
    kind,
    label: `${kind} ${index}`,
    description: `Step ${index}.`,
    reads: [],
    writes: [`field_${index}`],
    config: {},
  }));
  return {
    id: 'visual_semantics.workflow',
    version: 1,
    name: 'Visual semantics workflow',
    description: 'Exercises the stage-aware Workbench layout.',
    state: { fields: Object.fromEntries(nodes.map((node, index) => [node.writes[0]!, { type: 'string', required: false, description: `Field ${index}.` }])) },
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge_${index}`,
      source: nodes[index]!.id,
      target: node.id,
      on: 'success',
    })),
    budget: { maxSteps: 100, maxDurationMs: 60_000, maxConcurrency: 4 },
  };
}

describe('Workbench graph visual model', () => {
  it('compresses a long linear workflow into readable stage columns', () => {
    const graph = linearGraph([
      'trigger', 'function', 'agent', 'function', 'router', 'human',
      'function', 'map', 'join', 'human', 'function', 'compensation',
    ]);
    const positions = createAutomaticLayout(graph);
    const columns = new Set(Object.values(positions).map((position) => position.x));

    expect(Object.keys(positions)).toHaveLength(graph.nodes.length);
    expect(columns.size).toBeGreaterThan(1);
    expect(columns.size).toBeLessThan(graph.nodes.length / 2);
    expect(positions.node_2!.y).toBeGreaterThan(positions.node_1!.y);
  });

  it('derives bounded stage bands and exposes recovery semantics', () => {
    const graph = linearGraph([
      'trigger', 'agent', 'function', 'router', 'human', 'map', 'function', 'compensation',
    ]);
    const positions = createAutomaticLayout(graph);
    const stages = deriveStageBands(graph, positions);

    expect(stages).toHaveLength(2);
    expect(stages.every((stage) => stage.width >= 300 && stage.height >= 460)).toBe(true);
    expect(stages.some((stage) => stage.label === 'Recovery')).toBe(true);
  });
});
