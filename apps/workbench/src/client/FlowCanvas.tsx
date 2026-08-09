import { memo, useEffect, useMemo, useRef, type DragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnEdgesDelete,
  type OnNodesDelete,
  type ReactFlowInstance,
} from '@xyflow/react';
import { Bot, Braces, CircleDot, GitFork, GitMerge, UserRoundCheck } from 'lucide-react';
import { nextEdgeId, nextNodeId, nodeKindLabel, nodeRunStatus } from './graph-model.js';
import type { GraphDefinition, GraphNode, GraphPosition, RunSnapshot } from './types.js';

const kindIcon = {
  trigger: CircleDot,
  function: Braces,
  agent: Bot,
  join: GitMerge,
  human: UserRoundCheck,
  router: GitFork,
};

interface WorkflowNodeData extends Record<string, unknown> {
  definition: GraphNode;
  status: ReturnType<typeof nodeRunStatus>;
  selected: boolean;
}

const WorkflowNode = memo(function WorkflowNode({ data }: { data: WorkflowNodeData }) {
  const Icon = kindIcon[data.definition.kind];
  return (
    <div className={`workflow-node kind-${data.definition.kind} status-${data.status} ${data.selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-kind"><Icon size={14} /><span>{nodeKindLabel[data.definition.kind]}</span></div>
      <strong>{data.definition.label}</strong>
      <p>{data.definition.description}</p>
      <div className="node-io">
        <span>{data.definition.reads.length} in</span>
        <span>{data.definition.writes.length} out</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export function FlowCanvas({ graph, positions, run, selectedNodeId, onSelectNode, onChange }: {
  graph: GraphDefinition;
  positions: Record<string, GraphPosition>;
  run: RunSnapshot | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onChange: (graph: GraphDefinition, positions: Record<string, GraphPosition>) => void;
}) {
  const instance = useRef<ReactFlowInstance<Node<WorkflowNodeData>, Edge> | null>(null);
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNode }), []);
  const presentedNodes = useMemo<Node<WorkflowNodeData>[]>(() => graph.nodes.map((definition) => ({
    id: definition.id,
    type: 'workflow',
    position: positions[definition.id] ?? { x: 0, y: 0 },
    selected: selectedNodeId === definition.id,
    data: {
      definition,
      status: nodeRunStatus(run, definition.id),
      selected: selectedNodeId === definition.id,
    },
  })), [graph.nodes, positions, run, selectedNodeId]);
  const [nodes, setNodes, onNodesChange] = useNodesState(presentedNodes);
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

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    className: `workflow-edge edge-${edge.on}`,
  })), [graph.edges]);

  const selectNode: NodeMouseHandler = (_event, node) => onSelectNode(node.id);
  const deleteNodes: OnNodesDelete = (deleted) => {
    const ids = new Set(deleted.map((node) => node.id));
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
    const kind = event.dataTransfer.getData('application/graphwork-node') as GraphNode['kind'];
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

  return (
    <div className="flow-canvas" onDrop={drop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(value) => { instance.current = value; }}
        onNodeClick={selectNode}
        onPaneClick={() => onSelectNode(null)}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_event, node) => onChange(graph, { ...positions, [node.id]: node.position })}
        onNodesDelete={deleteNodes}
        onEdgesDelete={deleteEdges}
        onConnect={connect}
        defaultViewport={{ x: 28, y: 16, zoom: 0.65 }}
        minZoom={0.25}
        maxZoom={1.8}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#cbd5e1" />
        <MiniMap pannable zoomable nodeColor={(node) => {
          const kind = (node.data as WorkflowNodeData).definition.kind;
          return kind === 'human' ? '#d97706' : kind === 'agent' ? '#2563eb' : '#64748b';
        }} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
