import { describe, expect, it } from 'vitest';
import type { GraphDefinition, GraphNode } from '@graph-workbench/contracts';
import {
  createAutomaticLayout, deriveStageBands, graphFocusNeighborhood, initialGraphFocusNodeIds,
  nodeAccessibleLabel, nodeRunStatus, resolveRunDeliverable, runFocusNodeIds,
} from '../apps/workbench/src/client/graph-model.js';
import type { RunSnapshot } from '../apps/workbench/src/client/types.js';

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
  it('opens a long graph on its executable entry neighborhood instead of the entire overview', () => {
    const graph = linearGraph([
      'trigger', 'function', 'agent', 'function', 'router', 'human', 'function', 'map',
    ]);

    expect(initialGraphFocusNodeIds(graph)).toEqual(['node_0', 'node_1', 'node_2', 'node_3']);
    expect(initialGraphFocusNodeIds(graph).length).toBeLessThan(graph.nodes.length);
  });

  it('keeps active run nodes and their immediate workflow context in focus', () => {
    const graph = linearGraph(['trigger', 'function', 'agent', 'human', 'function', 'compensation']);
    const run = {
      runId: 'run-paused',
      packId: 'visual_semantics',
      graphId: graph.id,
      status: 'paused',
      state: {},
      events: [
        { runId: 'run-paused', seq: 1, type: 'node.started', timestamp: '2026-08-13T00:00:00.000Z', nodeId: 'node_3', detail: {} },
        { runId: 'run-paused', seq: 2, type: 'human.requested', timestamp: '2026-08-13T00:00:01.000Z', nodeId: 'node_3', detail: {} },
      ],
    } satisfies RunSnapshot;

    expect(nodeRunStatus(run, 'node_3')).toBe('waiting');
    expect(runFocusNodeIds(graph, run)).toEqual(['node_3', 'node_2', 'node_4']);
  });

  it('prioritizes failure over concurrent waiting and running nodes', () => {
    const graph = linearGraph(['trigger', 'agent', 'human', 'function']);
    const run = {
      runId: 'run-failed',
      packId: 'visual_semantics',
      graphId: graph.id,
      status: 'failed',
      state: {},
      events: [
        { runId: 'run-failed', seq: 1, type: 'node.started', timestamp: '2026-08-13T00:00:00.000Z', nodeId: 'node_1', detail: {} },
        { runId: 'run-failed', seq: 2, type: 'tool.approval_requested', timestamp: '2026-08-13T00:00:01.000Z', nodeId: 'node_2', detail: {} },
        { runId: 'run-failed', seq: 3, type: 'node.failed', timestamp: '2026-08-13T00:00:02.000Z', nodeId: 'node_3', detail: {} },
      ],
    } satisfies RunSnapshot;

    expect(nodeRunStatus(run, 'node_2')).toBe('waiting');
    expect(runFocusNodeIds(graph, run)).toEqual(['node_3', 'node_2']);
  });

  it('exposes node kind, label, status and description as one accessible name', () => {
    const node = linearGraph(['agent']).nodes[0]!;
    expect(nodeAccessibleLabel(node, 'running')).toBe('Agent node: agent 0. Status: running. Step 0.');
  });

  it('deduplicates anchors when deriving a bounded focus neighborhood', () => {
    const graph = linearGraph(['trigger', 'function', 'agent', 'human']);
    expect(graphFocusNeighborhood(graph, ['node_1', 'node_1'], 3)).toEqual(['node_1', 'node_0', 'node_2']);
  });

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

  it('resolves Pack-declared deliverables without assuming a shared state field', () => {
    const run = {
      runId: 'run-robotics',
      packId: 'robotics_fleet',
      graphId: 'robotics_fleet.task_dispatch',
      status: 'completed',
      state: { dispatch_record: '# Governed fleet dispatch' },
      events: [],
    } satisfies RunSnapshot;

    expect(resolveRunDeliverable([
      {
        id: 'dispatch_record',
        label: 'Fleet dispatch record',
        description: 'Approved fleet dispatch evidence.',
        graphId: 'robotics_fleet.task_dispatch',
        stateField: 'dispatch_record',
        mediaType: 'text/markdown',
        artifactType: 'fleet_dispatch_record',
        evidenceFields: [],
      },
    ], run)).toBe('# Governed fleet dispatch');
  });
});
