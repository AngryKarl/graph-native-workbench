import { memo, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { ArrowRight, Box, CalendarClock, CircleDot, Network, PackageOpen, Radio, Webhook, Workflow } from 'lucide-react';
import type { GraphDefinition, PackDescription } from './types.js';

interface PackGraphData extends Record<string, unknown> {
  kind: 'graph';
  graph: GraphDefinition;
  trigger: string;
  composites: number;
  deliverables: string[];
  active: boolean;
  onOpen: (graphId: string) => void;
}

interface BoundaryData extends Record<string, unknown> {
  kind: 'boundary';
  tone: 'input' | 'output';
  label: string;
  detail: string;
}

type OverviewData = PackGraphData | BoundaryData;

function triggerLabel(graph: GraphDefinition): string {
  if (!graph.trigger || graph.trigger.type === 'manual') return 'Manual input';
  if (graph.trigger.type === 'webhook') return `${graph.trigger.method} ${graph.trigger.path}`;
  if (graph.trigger.type === 'schedule') return graph.trigger.cron;
  return graph.trigger.eventType;
}

function triggerIcon(graph: GraphDefinition) {
  if (!graph.trigger || graph.trigger.type === 'manual') return CircleDot;
  if (graph.trigger.type === 'webhook') return Webhook;
  if (graph.trigger.type === 'schedule') return CalendarClock;
  return Radio;
}

const PackGraphNode = memo(function PackGraphNode({ data }: { data: PackGraphData }) {
  const TriggerIcon = triggerIcon(data.graph);
  return <article className={`pack-graph-node ${data.active ? 'is-active' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <header><span><Workflow size={16} /></span><div><small>Workflow</small><strong>{data.graph.name}</strong></div></header>
    <p>{data.graph.description}</p>
    <div className="pack-graph-facts">
      <span><TriggerIcon size={11} />{data.trigger}</span>
      <span><Network size={11} />{data.graph.nodes.length} nodes</span>
      {data.composites ? <span><PackageOpen size={11} />{data.composites} linked</span> : null}
    </div>
    {data.deliverables.length ? <div className="pack-graph-outputs"><Box size={11} />{data.deliverables.join(' · ')}</div> : null}
    <button className="nodrag" onClick={() => data.onOpen(data.graph.id)}>Open workflow<ArrowRight size={12} /></button>
  </article>;
});

const BoundaryNode = memo(function BoundaryNode({ data }: { data: BoundaryData }) {
  const Icon = data.tone === 'input' ? Radio : Box;
  return <div className={`pack-boundary-node tone-${data.tone}`}>
    {data.tone === 'output' ? <Handle type="target" position={Position.Left} /> : null}
    <Icon size={15} /><span><strong>{data.label}</strong><small>{data.detail}</small></span>
    {data.tone === 'input' ? <Handle type="source" position={Position.Right} /> : null}
  </div>;
});

const overviewNodeTypes = { packGraph: PackGraphNode, boundary: BoundaryNode };

export function PackOverview({ pack, activeGraphId, onOpenGraph }: {
  pack: PackDescription;
  activeGraphId: string;
  onOpenGraph: (graphId: string) => void;
}) {
  const graphIds = useMemo(() => new Set(pack.manifest.graphs.map((graph) => graph.id)), [pack.manifest.graphs]);
  const nodes = useMemo<Node<OverviewData>[]>(() => pack.manifest.graphs.flatMap((graph, index) => {
    const y = index * 190 + 60;
    const deliverables = pack.manifest.deliverables.filter((item) => item.graphId === graph.id).map((item) => item.label);
    const composites = graph.nodes.filter((node) => {
      const child = node.config.graphId;
      return typeof child === 'string' && graphIds.has(child);
    }).length;
    return [
      {
        id: `ingress:${graph.id}`,
        type: 'boundary',
        position: { x: 40, y: y + 34 },
        data: { kind: 'boundary', tone: 'input', label: graph.trigger?.type ?? 'manual', detail: triggerLabel(graph) },
        draggable: false,
        selectable: false,
        connectable: false,
      },
      {
        id: graph.id,
        type: 'packGraph',
        position: { x: 265, y },
        data: {
          kind: 'graph',
          graph,
          trigger: triggerLabel(graph),
          composites,
          deliverables,
          active: graph.id === activeGraphId,
          onOpen: onOpenGraph,
        },
        draggable: false,
        selectable: false,
      },
      {
        id: `output:${graph.id}`,
        type: 'boundary',
        position: { x: 665, y: y + 34 },
        data: {
          kind: 'boundary',
          tone: 'output',
          label: deliverables.length ? 'Deliverable' : 'Context',
          detail: deliverables.join(' · ') || `${graph.nodes.reduce((count, node) => count + node.writes.length, 0)} state writes`,
        },
        draggable: false,
        selectable: false,
        connectable: false,
      },
    ];
  }), [activeGraphId, graphIds, onOpenGraph, pack.manifest.deliverables, pack.manifest.graphs]);

  const edges = useMemo<Edge[]>(() => {
    const result: Edge[] = [];
    for (const graph of pack.manifest.graphs) {
      result.push({
        id: `ingress-edge:${graph.id}`,
        source: `ingress:${graph.id}`,
        target: graph.id,
        type: 'smoothstep',
        className: 'overview-edge ingress-edge',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      });
      result.push({
        id: `output-edge:${graph.id}`,
        source: graph.id,
        target: `output:${graph.id}`,
        type: 'smoothstep',
        className: 'overview-edge output-edge',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      });
      for (const node of graph.nodes) {
        const child = node.config.graphId;
        if (typeof child !== 'string' || !graphIds.has(child)) continue;
        result.push({
          id: `dependency:${graph.id}:${node.id}:${child}`,
          source: graph.id,
          target: child,
          label: node.kind,
          type: 'smoothstep',
          className: 'overview-edge dependency-edge',
          labelStyle: { fill: '#2563eb', fontSize: 9, fontWeight: 650 },
          labelBgStyle: { fill: '#eff5ff', fillOpacity: 0.95 },
        });
      }
    }
    return result;
  }, [graphIds, pack.manifest.graphs]);

  return <div className="pack-overview">
    <div className="pack-overview-summary">
      <span><Workflow size={14} /><strong>{pack.manifest.graphs.length}</strong> workflows</span>
      <span><Network size={14} /><strong>{pack.manifest.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0)}</strong> executable nodes</span>
      <span><Box size={14} /><strong>{pack.manifest.deliverables.length}</strong> deliverables</span>
    </div>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={overviewNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 0.9 }}
      minZoom={0.25}
      maxZoom={1.35}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d6dde8" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
