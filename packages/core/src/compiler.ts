import {
  graphDefinitionSchema,
  industryPackManifestSchema,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  type IndustryPackManifest,
} from '@graph-workbench/contracts';

export class GraphCompileError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Graph compilation failed:\n- ${issues.join('\n- ')}`);
    this.name = 'GraphCompileError';
    this.issues = issues;
  }
}

export interface CompiledGraph {
  readonly definition: GraphDefinition;
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  readonly incomingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly outgoingByNode: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly triggerNodeId: string;
}

export interface CompiledPack {
  readonly manifest: IndustryPackManifest;
  readonly graphs: ReadonlyMap<string, CompiledGraph>;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues];
}

export function compileGraph(input: unknown): CompiledGraph {
  const parsed = graphDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new GraphCompileError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'graph'}: ${issue.message}`),
    );
  }

  const definition = parsed.data;
  const issues: string[] = [];
  const nodeIds = definition.nodes.map((node) => node.id);
  const edgeIds = definition.edges.map((edge) => edge.id);
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  const fieldIds = new Set(Object.keys(definition.state.fields));

  for (const id of duplicates(nodeIds)) issues.push(`Duplicate node id "${id}".`);
  for (const id of duplicates(edgeIds)) issues.push(`Duplicate edge id "${id}".`);

  const triggers = definition.nodes.filter((node) => node.kind === 'trigger');
  if (triggers.length !== 1) {
    issues.push(`A graph must contain exactly one trigger node; found ${triggers.length}.`);
  }

  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const node of definition.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of definition.edges) {
    if (!nodeById.has(edge.source)) issues.push(`Edge "${edge.id}" has unknown source "${edge.source}".`);
    if (!nodeById.has(edge.target)) issues.push(`Edge "${edge.id}" has unknown target "${edge.target}".`);
    if (edge.source === edge.target) issues.push(`Edge "${edge.id}" cannot point to its own source.`);
    if (edge.condition && !fieldIds.has(edge.condition.field)) {
      issues.push(`Edge "${edge.id}" reads undeclared state field "${edge.condition.field}".`);
    }
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  for (const node of definition.nodes) {
    for (const field of [...node.reads, ...node.writes]) {
      if (!fieldIds.has(field)) issues.push(`Node "${node.id}" references undeclared state field "${field}".`);
    }
    if ((node.kind === 'agent' || node.kind === 'function') && !node.handler) {
      issues.push(`Node "${node.id}" (${node.kind}) requires a handler.`);
    }
    if (node.kind === 'human') {
      const decisionField = node.config.decisionField;
      if (typeof decisionField !== 'string' || !fieldIds.has(decisionField)) {
        issues.push(`Human node "${node.id}" must configure a declared decisionField.`);
      } else if (!node.writes.includes(decisionField)) {
        issues.push(`Human node "${node.id}" must declare decisionField "${decisionField}" in writes.`);
      }
    }
    if (node.kind === 'join' && (incoming.get(node.id)?.length ?? 0) < 2) {
      issues.push(`Join node "${node.id}" requires at least two incoming edges.`);
    }
  }

  const triggerId = triggers[0]?.id;
  if (triggerId) {
    const reachable = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    let hasCycle = false;

    const visit = (nodeId: string): void => {
      reachable.add(nodeId);
      if (visiting.has(nodeId)) {
        hasCycle = true;
        return;
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const edge of outgoing.get(nodeId) ?? []) {
        if (nodeById.has(edge.target)) visit(edge.target);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    visit(triggerId);
    if (hasCycle) issues.push('Version 0.1 execution graphs must be acyclic.');
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) issues.push(`Node "${node.id}" is unreachable from the trigger.`);
    }
  }

  if (issues.length > 0) throw new GraphCompileError(issues);

  return {
    definition,
    nodeById,
    incomingByNode: incoming,
    outgoingByNode: outgoing,
    triggerNodeId: triggerId!,
  };
}

export function compilePack(input: unknown): CompiledPack {
  const parsed = industryPackManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new GraphCompileError(
      parsed.error.issues.map((issue) => `pack.${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const manifest = parsed.data;
  const issues: string[] = [];
  const objectTypeIds = new Set(manifest.ontology.objectTypes.map((item) => item.id));
  const toolIds = new Set(manifest.tools.map((item) => item.id));
  const roleIds = new Set(manifest.roles.map((item) => item.id));
  const evaluationIds = new Set(manifest.evaluations.map((item) => item.id));

  for (const id of duplicates(manifest.ontology.objectTypes.map((item) => item.id))) {
    issues.push(`Duplicate object type id "${id}".`);
  }
  for (const id of duplicates(manifest.ontology.relationTypes.map((item) => item.id))) {
    issues.push(`Duplicate relation type id "${id}".`);
  }
  for (const id of duplicates(manifest.roles.map((item) => item.id))) issues.push(`Duplicate role id "${id}".`);
  for (const id of duplicates(manifest.tools.map((item) => item.id))) issues.push(`Duplicate tool id "${id}".`);
  for (const id of duplicates(manifest.graphs.map((item) => item.id))) issues.push(`Duplicate graph id "${id}".`);
  for (const id of duplicates(manifest.deliverables.map((item) => item.id))) {
    issues.push(`Duplicate deliverable id "${id}".`);
  }
  for (const id of duplicates(manifest.fixtures.map((item) => item.id))) {
    issues.push(`Duplicate fixture id "${id}".`);
  }

  for (const deliverable of manifest.deliverables) {
    const graph = manifest.graphs.find((item) => item.id === deliverable.graphId);
    if (!graph) {
      issues.push(`Deliverable "${deliverable.id}" references unknown graph "${deliverable.graphId}".`);
    } else if (!(deliverable.stateField in graph.state.fields)) {
      issues.push(
        `Deliverable "${deliverable.id}" references unknown state field "${deliverable.stateField}".`,
      );
    }
  }
  for (const fixture of manifest.fixtures) {
    const graph = manifest.graphs.find((item) => item.id === fixture.graphId);
    if (!graph) {
      issues.push(`Fixture "${fixture.id}" references unknown graph "${fixture.graphId}".`);
      continue;
    }
    for (const expectation of fixture.expectations) {
      if (!(expectation.field in graph.state.fields)) {
        issues.push(
          `Fixture "${fixture.id}" expects unknown state field "${expectation.field}".`,
        );
      }
      if (
        (expectation.operator === 'equals' || expectation.operator === 'includes') &&
        expectation.value === undefined
      ) {
        issues.push(
          `Fixture "${fixture.id}" expectation "${expectation.description}" requires a value.`,
        );
      }
      if (
        expectation.operator === 'min_items' &&
        (!Number.isInteger(expectation.value) || Number(expectation.value) < 0)
      ) {
        issues.push(
          `Fixture "${fixture.id}" expectation "${expectation.description}" requires a non-negative integer value.`,
        );
      }
    }
  }

  for (const relation of manifest.ontology.relationTypes) {
    for (const typeId of [...relation.sourceTypes, ...relation.targetTypes]) {
      if (!objectTypeIds.has(typeId)) {
        issues.push(`Relation type "${relation.id}" references unknown object type "${typeId}".`);
      }
    }
  }
  for (const role of manifest.roles) {
    for (const toolId of role.allowedTools) {
      if (!toolIds.has(toolId)) issues.push(`Role "${role.id}" references unknown tool "${toolId}".`);
    }
  }
  for (const graph of manifest.graphs) {
    for (const node of graph.nodes) {
      const roleId = node.config.roleId;
      const configuredTools = node.config.toolIds;
      const evaluationId = node.config.evaluationId;
      if (roleId !== undefined && (typeof roleId !== 'string' || !roleIds.has(roleId))) {
        issues.push(`Graph "${graph.id}" node "${node.id}" references unknown role "${String(roleId)}".`);
      }
      if (configuredTools !== undefined && !Array.isArray(configuredTools)) {
        issues.push(`Graph "${graph.id}" node "${node.id}" config.toolIds must be an array.`);
      }
      if (Array.isArray(configuredTools)) {
        for (const toolId of configuredTools) {
          if (typeof toolId !== 'string' || !toolIds.has(toolId)) {
            issues.push(`Graph "${graph.id}" node "${node.id}" references unknown tool "${String(toolId)}".`);
          }
          const role = typeof roleId === 'string'
            ? manifest.roles.find((item) => item.id === roleId)
            : undefined;
          if (role && typeof toolId === 'string' && !role.allowedTools.includes(toolId)) {
            issues.push(`Graph "${graph.id}" node "${node.id}" uses tool "${toolId}" outside role "${role.id}".`);
          }
        }
        if (configuredTools.length > 0 && typeof roleId !== 'string') {
          issues.push(`Graph "${graph.id}" node "${node.id}" must declare roleId when using tools.`);
        }
      }
      if (
        evaluationId !== undefined &&
        (typeof evaluationId !== 'string' || !evaluationIds.has(evaluationId))
      ) {
        issues.push(
          `Graph "${graph.id}" node "${node.id}" references unknown evaluation "${String(evaluationId)}".`,
        );
      }
    }
  }

  const graphs = new Map<string, CompiledGraph>();
  for (const graph of manifest.graphs) {
    try {
      graphs.set(graph.id, compileGraph(graph));
    } catch (error) {
      if (error instanceof GraphCompileError) {
        issues.push(...error.issues.map((issue) => `Graph "${graph.id}": ${issue}`));
      } else {
        throw error;
      }
    }
  }

  if (issues.length > 0) throw new GraphCompileError(issues);
  return { manifest, graphs };
}
