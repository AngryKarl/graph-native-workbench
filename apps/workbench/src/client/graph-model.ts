import type { GraphDefinition, GraphNode, RunSnapshot } from './types.js';

export const nodeKindLabel: Record<GraphNode['kind'], string> = {
  trigger: 'Trigger',
  function: 'Function',
  agent: 'Agent',
  join: 'Join',
  human: 'Human',
  router: 'Router',
};

export type NodeRunStatus = 'idle' | 'running' | 'complete' | 'waiting' | 'failed';

export function nodeRunStatus(run: RunSnapshot | null, nodeId: string): NodeRunStatus {
  if (!run) return 'idle';
  const events = run.events.filter((event) => event.nodeId === nodeId);
  if (events.some((event) => event.type === 'node.failed' || event.type === 'node.timed_out')) return 'failed';
  if (events.some((event) => event.type === 'human.requested')
    && !events.some((event) => event.type === 'human.resolved')) return 'waiting';
  if (events.some((event) => event.type === 'node.completed')) return 'complete';
  if (events.some((event) => event.type === 'node.started')) return 'running';
  return 'idle';
}

export function createAutomaticLayout(graph: GraphDefinition): Record<string, { x: number; y: number }> {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const level = new Map(queue.map((id) => [id, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    for (const target of outgoing.get(id) ?? []) {
      level.set(target, Math.max(level.get(target) ?? 0, (level.get(id) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  const grouped = new Map<number, string[]>();
  graph.nodes.forEach((node, index) => {
    const value = level.get(node.id) ?? index;
    grouped.set(value, [...(grouped.get(value) ?? []), node.id]);
  });
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [column, ids] of grouped) {
    const totalHeight = Math.max(0, (ids.length - 1) * 148);
    ids.forEach((id, index) => {
      positions[id] = { x: column * 260 + 56, y: index * 148 - totalHeight / 2 + 280 };
    });
  }
  return positions;
}

export function nextNodeId(graph: GraphDefinition, kind: GraphNode['kind']): string {
  let index = 1;
  const base = `new_${kind}`;
  while (graph.nodes.some((node) => node.id === `${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function nextEdgeId(graph: GraphDefinition, source: string, target: string): string {
  let index = 1;
  const base = `e_${source}_${target}`.slice(0, 108).replace(/[^a-z0-9._-]/g, '_');
  let id = base;
  while (graph.edges.some((edge) => edge.id === id)) id = `${base}_${index++}`.slice(0, 120);
  return id;
}
