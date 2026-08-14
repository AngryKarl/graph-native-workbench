import { memo, useEffect, useMemo, useRef, type DragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  useViewport,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnEdgesDelete,
  type OnNodesDelete,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  Bot, Box, Braces, CircleDot, Clock3, GitFork, GitMerge, Hourglass, ListTree,
  Network, Repeat2, ShieldAlert, Undo2, UserRoundCheck, Workflow, Wrench,
} from 'lucide-react';
import {
  createAutomaticLayout, deriveStageBands, graphFocusNeighborhood, initialGraphFocusNodeIds,
  nextEdgeId, nextNodeId, nodeAccessibleLabel, nodeKindLabel, nodeRunStatus, runFocusNodeIds,
} from './graph-model.js';
import type { GraphDefinition, GraphNode, GraphPosition, PackDescription, RunSnapshot } from './types.js';

const kindIcon = {
  trigger: CircleDot,
  function: Braces,
  agent: Bot,
  join: GitMerge,
  human: UserRoundCheck,
  router: GitFork,
  wait: Hourglass,
  subgraph: Workflow,
  loop: Repeat2,
  map: ListTree,
  escalation: ShieldAlert,
  compensation: Undo2,
};

interface ToolMeta {
  label: string;
  risk: PackDescription['manifest']['tools'][number]['risk'];
}

interface WorkflowNodeData extends Record<string, unknown> {
  type: 'workflow';
  definition: GraphNode;
  status: ReturnType<typeof nodeRunStatus>;
  selected: boolean;
  roleLabel?: string;
  tools: ToolMeta[];
  modelLabel: string;
  triggerDetail?: string;
  deliverableLabel?: string;
}

interface StageNodeData extends Record<string, unknown> {
  type: 'stage';
  label: string;
  index: number;
}

type CanvasNodeData = WorkflowNodeData | StageNodeData;

function nodeHandles() {
  return <>
    <Handle id="left-target" type="target" position={Position.Left} />
    <Handle id="top-target" type="target" position={Position.Top} />
    <Handle id="right-source" type="source" position={Position.Right} />
    <Handle id="bottom-source" type="source" position={Position.Bottom} />
  </>;
}

function configString(node: GraphNode, key: string): string | undefined {
  const value = node.config[key];
  return typeof value === 'string' ? value : undefined;
}

function nodeDetail(node: GraphNode): string | undefined {
  if (node.kind === 'wait') {
    const mode = configString(node, 'mode');
    if (mode === 'event') return configString(node, 'eventType') ?? 'Correlated event';
    const duration = node.config.durationMs;
    if (mode === 'timer' && typeof duration === 'number') return `${Math.max(1, Math.round(duration / 60_000))} min timer`;
    return 'Durable wait';
  }
  if (node.kind === 'subgraph') return configString(node, 'graphId');
  if (node.kind === 'loop') {
    const maximum = node.config.maxIterations;
    return typeof maximum === 'number' ? `Up to ${maximum} iterations` : 'Bounded iteration';
  }
  if (node.kind === 'map') {
    const concurrency = node.config.maxConcurrency;
    return typeof concurrency === 'number' ? `${concurrency} parallel workers` : 'Parallel item map';
  }
  if (node.kind === 'join') {
    return configString(node, 'mode') === 'any' ? 'Continue on first branch' : 'Wait for every branch';
  }
  if (node.kind === 'escalation') {
    return typeof node.config.severity === 'string' ? `${node.config.severity} severity` : 'Visible escalation';
  }
  if (node.kind === 'compensation') {
    const targets = node.config.compensates;
    return Array.isArray(targets) ? `Restores ${targets.length} action${targets.length === 1 ? '' : 's'}` : 'Failure recovery';
  }
  return undefined;
}

function NodeBadges({ data }: { data: WorkflowNodeData }) {
  const detail = nodeDetail(data.definition);
  return <div className="node-badges">
    {data.roleLabel ? <span className="node-role">{data.roleLabel}</span> : null}
    {detail ? <span>{detail}</span> : null}
    {data.tools.slice(0, 1).map((tool) => <span key={tool.label} className={`tool-risk risk-${tool.risk}`}><Wrench size={9} />{tool.label}</span>)}
    {data.tools.length > 1 ? <span>+{data.tools.length - 1} tools</span> : null}
  </div>;
}

function NodeRunStatus({ status }: { status: WorkflowNodeData['status'] }) {
  if (status === 'idle') return null;
  const label = status === 'complete' ? 'Complete' : status[0]!.toUpperCase() + status.slice(1);
  return <span className={`node-run-status status-${status}`} aria-hidden="true"><i className={`node-status status-${status}`} />{label}</span>;
}

const WorkflowNode = memo(function WorkflowNode({ data }: { data: WorkflowNodeData }) {
  const { zoom } = useViewport();
  const Icon = kindIcon[data.definition.kind];
  const zoomClass = zoom < 0.44 ? 'zoom-overview' : zoom < 0.72 ? 'zoom-compact' : 'zoom-detail';
  const commonClass = `workflow-node kind-${data.definition.kind} status-${data.status} ${data.selected ? 'is-selected' : ''} ${zoomClass}`;

  if (data.definition.kind === 'router') {
    return <div className={commonClass} title={data.definition.description}>
      {nodeHandles()}
      <div className="router-shape"><div><Icon size={16} /><strong>{data.definition.label}</strong></div></div>
      <NodeRunStatus status={data.status} />
    </div>;
  }

  if (data.definition.kind === 'join') {
    return <div className={commonClass} title={data.definition.description}>
      {nodeHandles()}
      <div className="join-bar"><Icon size={17} /></div>
      <strong>{data.definition.label}</strong>
      <small>{nodeDetail(data.definition)}</small>
      <NodeRunStatus status={data.status} />
    </div>;
  }

  return <div className={commonClass} title={data.definition.description}>
    {nodeHandles()}
    <div className="node-heading">
      <span className="node-symbol"><Icon size={data.definition.kind === 'agent' ? 18 : 15} /></span>
      <span className="node-heading-copy">
        <span className="node-kind">{nodeKindLabel[data.definition.kind]}</span>
        <strong>{data.definition.label}</strong>
      </span>
      <NodeRunStatus status={data.status} />
    </div>
    {data.definition.kind === 'trigger' && data.triggerDetail ? <div className="trigger-detail"><Network size={11} />{data.triggerDetail}</div> : null}
    {data.definition.kind === 'agent' ? <div className="agent-runtime"><Bot size={11} /><span>{data.modelLabel}</span><i /> <Box size={10} /><span>{data.definition.reads.length} context</span></div> : null}
    <p>{data.definition.description}</p>
    <NodeBadges data={data} />
    <div className="node-io">
      <span>{data.definition.reads.length} in</span>
      <span>{data.definition.writes.length} out</span>
      {data.deliverableLabel ? <span className="deliverable"><Box size={9} />{data.deliverableLabel}</span> : null}
    </div>
  </div>;
});

const StageNode = memo(function StageNode({ data }: { data: StageNodeData }) {
  return <div className={`workflow-stage stage-${data.index % 2}`}><span>{data.label}</span></div>;
});

function triggerDetail(graph: GraphDefinition): string {
  if (!graph.trigger || graph.trigger.type === 'manual') return 'Manual input';
  if (graph.trigger.type === 'webhook') return `${graph.trigger.method} ${graph.trigger.path}`;
  if (graph.trigger.type === 'schedule') return `${graph.trigger.cron} · ${graph.trigger.timezone}`;
  return graph.trigger.eventType;
}

function edgeHandles(source: GraphPosition, target: GraphPosition) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  }
  return { sourceHandle: 'bottom-source', targetHandle: 'top-target' };
}

export function FlowCanvas({ graph, positions, run, selectedNodeId, manifest, modelLabel, onSelectNode, onChange }: {
  graph: GraphDefinition;
  positions: Record<string, GraphPosition>;
  run: RunSnapshot | null;
  selectedNodeId: string | null;
  manifest: PackDescription['manifest'];
  modelLabel: string;
  onSelectNode: (nodeId: string | null) => void;
  onChange: (graph: GraphDefinition, positions: Record<string, GraphPosition>) => void;
}) {
  const instance = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null);
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNode, stage: StageNode }), []);
  const resolvedPositions = useMemo(() => Object.keys(positions).length ? positions : createAutomaticLayout(graph), [graph, positions]);
  const roles = useMemo(() => new Map(manifest.roles.map((role) => [role.id, role.label])), [manifest.roles]);
  const tools = useMemo(() => new Map(manifest.tools.map((tool) => [tool.id, tool])), [manifest.tools]);
  const deliverables = useMemo(() => new Map(manifest.deliverables
    .filter((item) => item.graphId === graph.id)
    .map((item) => [item.stateField, item.label])), [graph.id, manifest.deliverables]);
  const stages = useMemo(() => deriveStageBands(graph, resolvedPositions), [graph, resolvedPositions]);
  const initialFocusIds = useMemo(() => initialGraphFocusNodeIds(graph), [graph]);
  const activeFocusIds = useMemo(() => runFocusNodeIds(graph, run), [graph, run]);
  const selectedFocusIds = useMemo(
    () => selectedNodeId ? graphFocusNeighborhood(graph, [selectedNodeId]) : [],
    [graph, selectedNodeId],
  );
  const focusIds = activeFocusIds.length ? activeFocusIds
    : selectedFocusIds.length ? selectedFocusIds
      : initialFocusIds;
  const presentedNodes = useMemo<Node<CanvasNodeData>[]>(() => {
    const stageNodes: Node<CanvasNodeData>[] = stages.map((stage, index) => ({
      id: `__${stage.id}`,
      type: 'stage',
      position: { x: stage.x, y: stage.y },
      data: { type: 'stage', label: stage.label, index },
      style: { width: stage.width, height: stage.height },
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      zIndex: -1,
    }));
    const workflowNodes: Node<CanvasNodeData>[] = graph.nodes.map((definition): Node<CanvasNodeData> => {
      const toolIds = Array.isArray(definition.config.toolIds)
        ? definition.config.toolIds.filter((id): id is string => typeof id === 'string')
        : [];
      const roleId = configString(definition, 'roleId');
      const roleLabel = roleId ? roles.get(roleId) : undefined;
      const deliverableLabel = definition.writes.map((field) => deliverables.get(field)).find(Boolean);
      return {
        id: definition.id,
        type: 'workflow',
        position: resolvedPositions[definition.id] ?? { x: 0, y: 0 },
        selected: selectedNodeId === definition.id,
        ariaLabel: nodeAccessibleLabel(definition, nodeRunStatus(run, definition.id)),
        data: {
          type: 'workflow',
          definition,
          status: nodeRunStatus(run, definition.id),
          selected: selectedNodeId === definition.id,
          ...(roleLabel ? { roleLabel } : {}),
          tools: toolIds.flatMap((id) => {
            const tool = tools.get(id);
            return tool ? [{ label: tool.label, risk: tool.risk }] : [];
          }),
          modelLabel,
          ...(definition.kind === 'trigger' ? { triggerDetail: triggerDetail(graph) } : {}),
          ...(deliverableLabel ? { deliverableLabel } : {}),
        },
        zIndex: 1,
      };
    });
    return [...stageNodes, ...workflowNodes];
  }, [deliverables, graph, modelLabel, resolvedPositions, roles, run, selectedNodeId, stages, tools]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>(presentedNodes);

  useEffect(() => {
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return presentedNodes.map((node) => {
        const current = currentById.get(node.id);
        return {
          ...node,
          ...(current?.measured ? { measured: current.measured } : {}),
          ...(current?.dragging ? { position: current.position, dragging: true } : {}),
        };
      });
    });
  }, [presentedNodes, setNodes]);

  const initialFocusKey = initialFocusIds.join('|');
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void instance.current?.fitView({
        nodes: initialFocusIds.map((id) => ({ id })),
        padding: 0.22,
        minZoom: 0.58,
        maxZoom: 0.9,
        duration: 240,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graph.id, initialFocusKey]);

  const activeFocusKey = activeFocusIds.join('|');
  useEffect(() => {
    if (!activeFocusIds.length) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.current?.fitView({
        nodes: activeFocusIds.map((id) => ({ id })),
        padding: 0.3,
        minZoom: 0.62,
        maxZoom: 0.96,
        duration: 320,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFocusKey]);

  const focusCore = () => {
    void instance.current?.fitView({
      nodes: focusIds.map((id) => ({ id })),
      padding: 0.26,
      minZoom: 0.58,
      maxZoom: 0.96,
      duration: 240,
    });
  };
  const showOverview = () => {
    void instance.current?.fitView({
      nodes: graph.nodes.map((node) => ({ id: node.id })),
      padding: 0.12,
      minZoom: 0.24,
      maxZoom: 0.82,
      duration: 240,
    });
  };

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => {
    const source = resolvedPositions[edge.source] ?? { x: 0, y: 0 };
    const target = resolvedPositions[edge.target] ?? { x: 0, y: 0 };
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? (edge.on === 'failure' ? 'failure' : edge.on === 'always' ? 'always' : undefined),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
      className: `workflow-edge edge-${edge.on}`,
      labelStyle: { fontSize: 9, fontWeight: 650, fill: edge.on === 'failure' ? '#c43c3c' : '#64748b' },
      labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.94 },
      labelBgPadding: [5, 3] as [number, number],
      ...edgeHandles(source, target),
    };
  }), [graph.edges, resolvedPositions]);

  const selectNode: NodeMouseHandler = (_event, node) => {
    if (!node.id.startsWith('__')) onSelectNode(node.id);
  };
  const deleteNodes: OnNodesDelete = (deleted) => {
    const ids = new Set(deleted.filter((node) => !node.id.startsWith('__')).map((node) => node.id));
    if (!ids.size) return;
    const nextPositions = { ...positions };
    ids.forEach((id) => delete nextPositions[id]);
    onChange({
      ...graph,
      nodes: graph.nodes.filter((node) => !ids.has(node.id)),
      edges: graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
    }, nextPositions);
    onSelectNode(null);
  };
  const deleteEdges: OnEdgesDelete = (deleted) => {
    const ids = new Set(deleted.map((edge) => edge.id));
    onChange({ ...graph, edges: graph.edges.filter((edge) => !ids.has(edge.id)) }, positions);
  };
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const id = nextEdgeId(graph, connection.source, connection.target);
    const next = addEdge({ ...connection, id }, edges);
    const added = next.find((edge) => edge.id === id);
    if (!added) return;
    onChange({
      ...graph,
      edges: [...graph.edges, { id, source: connection.source, target: connection.target, on: 'success' }],
    }, positions);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/graph-workbench-node') as GraphNode['kind'];
    if (!kind || !instance.current) return;
    const id = nextNodeId(graph, kind);
    const position = instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const node: GraphNode = {
      id,
      kind,
      label: `New ${nodeKindLabel[kind]}`,
      description: 'Configure this node before running the graph.',
      reads: [],
      writes: [],
      config: {},
    };
    onChange({ ...graph, nodes: [...graph.nodes, node] }, { ...positions, [id]: position });
    onSelectNode(id);
  };

  return <div className="flow-canvas" onDrop={drop} onDragOver={(event) => event.preventDefault()}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onInit={(value) => { instance.current = value; }}
      onNodeClick={selectNode}
      onPaneClick={() => onSelectNode(null)}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_event, node) => {
        if (!node.id.startsWith('__')) onChange(graph, { ...positions, [node.id]: node.position });
      }}
      onNodesDelete={deleteNodes}
      onEdgesDelete={deleteEdges}
      onConnect={connect}
      fitView
      fitViewOptions={{
        nodes: initialFocusIds.map((id) => ({ id })),
        padding: 0.22,
        minZoom: 0.58,
        maxZoom: 0.9,
      }}
      minZoom={0.24}
      maxZoom={1.8}
      aria-label={`${graph.name} workflow canvas`}
      defaultEdgeOptions={{ type: 'smoothstep' }}
      deleteKeyCode={['Backspace', 'Delete']}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#cbd5e1" />
      <Panel className="canvas-focus-controls" position="top-right">
        <button type="button" className="canvas-focus-button" onClick={focusCore}>
          {activeFocusIds.length ? 'Focus active' : selectedFocusIds.length ? 'Focus selection' : 'Focus start'}
        </button>
        <button type="button" className="canvas-focus-button" onClick={showOverview}>Overview</button>
      </Panel>
      <MiniMap pannable zoomable nodeColor={(node) => {
        const data = node.data as CanvasNodeData;
        if (data.type === 'stage') return '#e8edf4';
        const kind = data.definition.kind;
        return kind === 'human' ? '#d97706'
          : kind === 'agent' ? '#2563eb'
            : kind === 'trigger' ? '#07835d'
              : kind === 'escalation' || kind === 'compensation' ? '#c43c3c'
                : '#64748b';
      }} />
      <Controls
        showInteractive={false}
        fitViewOptions={{
          nodes: graph.nodes.map((node) => ({ id: node.id })),
          padding: 0.12,
          minZoom: 0.24,
          maxZoom: 0.82,
          duration: 240,
        }}
      />
    </ReactFlow>
  </div>;
}
