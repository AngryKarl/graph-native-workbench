import { compilePack } from '@graph-workbench/core';

export interface PackInspection {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly objectTypes: readonly string[];
  readonly relationTypes: readonly string[];
  readonly roles: readonly string[];
  readonly tools: readonly string[];
  readonly evaluations: readonly string[];
  readonly deliverables: readonly string[];
  readonly fixtures: readonly string[];
  readonly graphs: ReadonlyArray<{
    id: string;
    version: number;
    nodes: number;
    edges: number;
    nodeKinds: Readonly<Record<string, number>>;
  }>;
}

export function inspectPack(input: unknown): PackInspection {
  const compiled = compilePack(input);
  const manifest = compiled.manifest;
  return {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    objectTypes: manifest.ontology.objectTypes.map((item) => item.id),
    relationTypes: manifest.ontology.relationTypes.map((item) => item.id),
    roles: manifest.roles.map((item) => item.id),
    tools: manifest.tools.map((item) => item.id),
    evaluations: manifest.evaluations.map((item) => item.id),
    deliverables: manifest.deliverables.map((item) => item.id),
    fixtures: manifest.fixtures.map((item) => item.id),
    graphs: manifest.graphs.map((graph) => ({
      id: graph.id,
      version: graph.version,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      nodeKinds: graph.nodes.reduce<Record<string, number>>((counts, node) => {
        counts[node.kind] = (counts[node.kind] ?? 0) + 1;
        return counts;
      }, {}),
    })),
  };
}

export function formatPackInspection(inspection: PackInspection): string {
  const list = (values: readonly string[]) => (values.length > 0 ? values.join(', ') : 'none');
  const lines = [
    `${inspection.name} (${inspection.id}@${inspection.version})`,
    `Context objects: ${list(inspection.objectTypes)}`,
    `Relations: ${list(inspection.relationTypes)}`,
    `Roles: ${list(inspection.roles)}`,
    `Tools: ${list(inspection.tools)}`,
    `Evaluations: ${list(inspection.evaluations)}`,
    `Deliverables: ${list(inspection.deliverables)}`,
    `Fixtures: ${list(inspection.fixtures)}`,
    'Graphs:',
  ];
  for (const graph of inspection.graphs) {
    const kinds = Object.entries(graph.nodeKinds)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(', ');
    lines.push(`  - ${graph.id}@${graph.version} — ${graph.nodes} nodes, ${graph.edges} edges (${kinds})`);
  }
  return lines.join('\n');
}
