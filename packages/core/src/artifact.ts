import {
  portableArtifactSchema,
  type GraphDefinition,
  type GraphEvent,
  type IndustryPackManifest,
  type PortableArtifact,
} from '@graph-workbench/contracts';
import { sha256Json } from './integrity.js';
import type { GraphState } from './state.js';

export interface RunArtifactSource {
  readonly pack: IndustryPackManifest;
  readonly graph: GraphDefinition;
  readonly runId: string;
  readonly state: Readonly<GraphState>;
  readonly events: readonly GraphEvent[];
}

export function verifyPortableArtifact(input: unknown): PortableArtifact {
  const artifact = portableArtifactSchema.parse(input);
  if (sha256Json(artifact.content) !== artifact.contentDigest) {
    throw new Error(`Artifact "${artifact.id}" content digest does not match its content.`);
  }
  for (const evidence of artifact.evidence) {
    if (sha256Json(evidence.value) !== evidence.digest) {
      throw new Error(`Artifact "${artifact.id}" Evidence "${evidence.id}" digest does not match its value.`);
    }
  }
  return artifact;
}

function writtenFields(event: GraphEvent): readonly string[] {
  return Array.isArray(event.detail.writtenFields)
    ? event.detail.writtenFields.filter((field): field is string => typeof field === 'string')
    : [];
}

export function createRunArtifacts(source: RunArtifactSource): readonly PortableArtifact[] {
  const deliverables = source.pack.deliverables.filter((item) =>
    item.graphId === source.graph.id
    && item.artifactType
    && source.state[item.stateField] !== undefined);

  return deliverables.map((definition) => {
    const content = structuredClone(source.state[definition.stateField]);
    const artifactId = `artifact-${sha256Json({
      runId: source.runId,
      deliverableId: definition.id,
    }).slice(0, 32)}`;
    const evidence = (definition.evidenceFields ?? []).flatMap((field) => {
      const value = source.state[field];
      if (value === undefined) return [];
      const items = Array.isArray(value) ? value : [value];
      return items.map((item, ordinal) => ({
        id: `evidence-${sha256Json({ artifactId, field, ordinal }).slice(0, 32)}`,
        sourceField: field,
        ordinal,
        value: structuredClone(item),
        digest: sha256Json(item),
      }));
    });
    const producerEvent = [...source.events].reverse().find((event) =>
      event.type === 'node.completed' && writtenFields(event).includes(definition.stateField));
    const approvalEvent = definition.approvalField
      ? [...source.events].reverse().find((event) =>
          event.type === 'human.resolved'
          && event.detail.decisionField === definition.approvalField)
      : undefined;
    const producedAt = producerEvent?.timestamp
      ?? source.events.at(-1)?.timestamp
      ?? new Date().toISOString();
    const approval = definition.approvalField ? {
      stateField: definition.approvalField,
      value: structuredClone(source.state[definition.approvalField]),
      ...(typeof approvalEvent?.detail.requiredRoleId === 'string'
        ? { requiredRoleId: approvalEvent.detail.requiredRoleId }
        : {}),
      ...(typeof approvalEvent?.detail.resolvedByActorId === 'string'
        ? { actorId: approvalEvent.detail.resolvedByActorId }
        : {}),
      ...(typeof approvalEvent?.detail.resolvedByActorName === 'string'
        ? { actorName: approvalEvent.detail.resolvedByActorName }
        : {}),
      ...(approvalEvent ? { recordedAt: approvalEvent.timestamp } : {}),
    } : undefined;

    return verifyPortableArtifact({
      formatVersion: 1,
      id: artifactId,
      artifactType: definition.artifactType,
      deliverableId: definition.id,
      mediaType: definition.mediaType,
      content,
      contentDigest: sha256Json(content),
      evidence,
      producer: {
        packId: source.pack.id,
        graphId: source.graph.id,
        graphVersion: source.graph.version,
        runId: source.runId,
        ...(producerEvent?.nodeId ? { nodeId: producerEvent.nodeId } : {}),
        producedAt,
      },
      ...(approval ? { approval } : {}),
    });
  });
}
