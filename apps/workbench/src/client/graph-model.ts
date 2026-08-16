import type { GraphDefinition, GraphNode, IndustryPackManifest, RunSnapshot } from './types.js';

export const nodeKindLabel: Record<GraphNode['kind'], string> = {
  trigger: 'Trigger',
  function: 'Function',
  agent: 'Agent',
  join: 'Join',
  human: 'Human',
  router: 'Router',
  wait: 'Wait',
  subgraph: 'Subgraph',
  loop: 'Loop',
  map: 'Map',
  escalation: 'Escalation',
  compensation: 'Compensation',
};

export type NodeRunStatus = 'idle' | 'running' | 'complete' | 'waiting' | 'failed';

const focusStatusPriority: NodeRunStatus[] = ['failed', 'waiting', 'running'];

export interface GraphStageBand {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function nodeRunStatus(run: RunSnapshot | null, nodeId: string): NodeRunStatus {
  if (!run) return 'idle';
  const events = run.events.filter((event) => event.nodeId === nodeId);
  if (events.some((event) => event.type === 'node.failed' || event.type === 'node.timed_out')) return 'failed';
  if (events.some((event) => event.type === 'tool.approval_requested')
    && !events.some((event) => event.type === 'tool.approval_resolved' || event.type === 'tool.denied')) return 'waiting';
  if (events.some((event) => event.type === 'human.requested')
    && !events.some((event) => event.type === 'human.resolved')) return 'waiting';
  if (events.some((event) => event.type === 'wait.scheduled' || event.type === 'event.waiting')
    && !events.some((event) => event.type === 'wait.resumed' || event.type === 'event.received')) return 'waiting';
  if (events.some((event) => event.type === 'node.completed')) return 'complete';
  if (events.some((event) => event.type === 'node.started')) return 'running';
  return 'idle';
}

export function nodeAccessibleLabel(node: GraphNode, status: NodeRunStatus): string {
  const statusLabel = status === 'idle' ? 'not run' : status;
  return `${nodeKindLabel[node.kind]} node: ${node.label}. Status: ${statusLabel}. ${node.description}`;
}

export function initialGraphFocusNodeIds(graph: GraphDefinition, maximum = 4): string[] {
  if (maximum <= 0 || graph.nodes.length === 0) return [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const roots = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const queue = roots.length ? roots : [graph.nodes[0]!.id];
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length && selected.length < maximum; index += 1) {
    const id = queue[index]!;
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!seen.has(target)) queue.push(target);
    }
  }
  return selected;
}

export function graphFocusNeighborhood(
  graph: GraphDefinition,
  anchors: readonly string[],
  maximum = 6,
): string[] {
  if (maximum <= 0 || anchors.length === 0) return [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const selected = anchors.filter((id, index) => nodeIds.has(id) && anchors.indexOf(id) === index).slice(0, maximum);
  const selectedIds = new Set(selected);
  const adjacent = graph.edges.flatMap((edge) => {
    if (selectedIds.has(edge.source)) return [edge.target];
    if (selectedIds.has(edge.target)) return [edge.source];
    return [];
  });
  for (const id of adjacent) {
    if (selected.length >= maximum) break;
    if (nodeIds.has(id) && !selectedIds.has(id)) {
      selected.push(id);
      selectedIds.add(id);
    }
  }
  return selected;
}

export function runFocusNodeIds(graph: GraphDefinition, run: RunSnapshot | null, maximum = 6): string[] {
  if (!run || run.graphId !== graph.id) return [];
  for (const status of focusStatusPriority) {
    const anchors = graph.nodes
      .filter((node) => nodeRunStatus(run, node.id) === status)
      .map((node) => node.id);
    if (anchors.length) return graphFocusNeighborhood(graph, anchors, maximum);
  }
  return [];
}

export function resolveRunDeliverable(
  deliverables: IndustryPackManifest['deliverables'],
  run: RunSnapshot | null,
): string {
  if (!run) return '';
  for (const definition of deliverables) {
    if (definition.graphId !== run.graphId) continue;
    const value = run.state[definition.stateField];
    if (typeof value === 'string') return value;
  }
  return '';
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
  const maxLevel = Math.max(0, ...level.values());
  const stageCount = Math.min(6, Math.max(1, Math.ceil((maxLevel + 1) / 3)));
  const grouped = new Map<number, GraphNode[]>();
  graph.nodes.forEach((node, index) => {
    const nodeLevel = level.get(node.id) ?? maxLevel + index + 1;
    const stage = Math.min(stageCount - 1, Math.floor((nodeLevel * stageCount) / Math.max(1, maxLevel + 1)));
    grouped.set(stage, [...(grouped.get(stage) ?? []), node]);
  });
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [stage, nodes] of grouped) {
    const ordered = nodes.sort((left, right) => {
      const recovery = (node: GraphNode) => node.kind === 'escalation' || node.kind === 'compensation' ? 1 : 0;
      return recovery(left) - recovery(right)
        || (level.get(left.id) ?? 0) - (level.get(right.id) ?? 0)
        || graph.nodes.indexOf(left) - graph.nodes.indexOf(right);
    });
    let y = 116;
    ordered.forEach((node) => {
      positions[node.id] = { x: stage * 380 + 92, y };
      y += estimatedNodeHeight(node.kind) + 46;
    });
  }
  return positions;
}

/**
 * Must stay in step with the `.workflow-node` heights in styles.css: the layout
 * reserves this much vertical room, so an underestimate makes cards overlap.
 */
function estimatedNodeHeight(kind: GraphNode['kind']): number {
  if (kind === 'agent') return 168;
  if (kind === 'router') return 136;
  if (kind === 'map' || kind === 'loop' || kind === 'subgraph') return 150;
  if (kind === 'human') return 134;
  return 110;
}

const stageNames: Record<number, string[]> = {
  1: ['Workflow'],
  2: ['Ingress', 'Delivery'],
  3: ['Ingress', 'Execution', 'Delivery'],
  4: ['Ingress', 'Understand', 'Govern', 'Delivery'],
  5: ['Ingress', 'Understand', 'Decide', 'Execute', 'Delivery'],
  6: ['Ingress', 'Understand', 'Decide', 'Execute', 'Govern', 'Delivery'],
};

export function deriveStageBands(
  graph: GraphDefinition,
  positions: Readonly<Record<string, { x: number; y: number }>>,
): GraphStageBand[] {
  const placed = graph.nodes.flatMap((node) => positions[node.id]
    ? [{ node, position: positions[node.id]! }]
    : []);
  if (!placed.length) return [];
  const minX = Math.min(...placed.map((item) => item.position.x)) - 72;
  const maxX = Math.max(...placed.map((item) => item.position.x)) + 300;
  const minY = Math.min(...placed.map((item) => item.position.y)) - 72;
  const maxY = Math.max(...placed.map((item) => item.position.y + estimatedNodeHeight(item.node.kind))) + 92;
  const count = Math.min(6, Math.max(1, Math.ceil(graph.nodes.length / 4)));
  const width = Math.max(300, (maxX - minX) / count);
  const names = stageNames[count] ?? stageNames[6]!;
  return Array.from({ length: count }, (_, index) => {
    const nodes = placed.filter(({ position }) => {
      const band = Math.min(count - 1, Math.floor((position.x - minX) / width));
      return band === index;
    }).map(({ node }) => node);
    const recovery = nodes.some((node) => node.kind === 'escalation' || node.kind === 'compensation');
    const orchestration = nodes.some((node) => node.kind === 'map' || node.kind === 'loop' || node.kind === 'subgraph');
    const label = recovery ? 'Recovery' : orchestration && index > 0 && index < count - 1 ? 'Orchestrate' : names[index]!;
    return {
      id: `stage-${index}`,
      label,
      x: minX + index * width,
      y: minY,
      width,
      height: Math.max(460, maxY - minY),
    };
  });
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
