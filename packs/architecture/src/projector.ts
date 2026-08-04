import type { ContextObject, ContextRelation } from '@graph-native/contracts';
import type { ContextGraphStore, GraphState } from '@graph-native/core';

interface CompletedArchitectureRun {
  readonly runId: string;
  readonly state: GraphState;
}

interface EvidenceItem {
  source: string;
  locator: string;
  claim: string;
}

interface Finding {
  discipline: string;
  statement: string;
  design_impact: string;
  source_indexes?: number[];
}

interface Direction {
  id: string;
  name: string;
  thesis: string;
  strategies: string[];
  risks: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function projectArchitectureRun(
  store: ContextGraphStore,
  run: CompletedArchitectureRun,
): Promise<void> {
  if (run.state.approved !== true || typeof run.state.deliverable !== 'string') {
    throw new Error('Only an approved architecture run with a deliverable can be confirmed.');
  }

  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const evidence = records<EvidenceItem>(run.state.evidence);
  const requirements = strings(run.state.client_goals);
  const constraints = strings(run.state.constraints);
  const findings = [
    ...records<Finding>(run.state.site_findings),
    ...records<Finding>(run.state.program_findings),
  ];
  const directions = records<Direction>(run.state.concept_directions);
  const briefId = `${base}.brief`;
  const decisionId = `${base}.decision`;
  const deliverableId = `${base}.deliverable`;
  const evidenceIds = evidence.map((_item, index) => `${base}.evidence.${index + 1}`);
  const requirementIds = requirements.map((_item, index) => `${base}.requirement.${index + 1}`);
  const constraintIds = constraints.map((_item, index) => `${base}.constraint.${index + 1}`);
  const findingIds = findings.map((_item, index) => `${base}.finding.${index + 1}`);
  const directionIds = directions.map((_item, index) => `${base}.direction.${index + 1}`);
  const provenance = (nodeId: string, sourceIds: string[] = [], actorId = 'system.runtime') => ({
    sourceIds,
    producedByRunId: run.runId,
    producedByNodeId: nodeId,
    actorId,
    recordedAt,
  });
  const object = (
    id: string,
    type: ContextObject['type'],
    data: ContextObject['data'],
    nodeId: string,
    sourceIds: string[] = [],
    actorId?: string,
  ): ContextObject => ({
    id,
    type,
    version: 1,
    status: 'confirmed',
    data,
    validFrom: recordedAt,
    validTo: null,
    provenance: provenance(nodeId, sourceIds, actorId),
  });

  const objects: ContextObject[] = [
    object(briefId, 'project_brief', {
      project_name: String(run.state.project_name),
      project_type: String(run.state.project_type),
      site_context: String(run.state.site_context),
      goals: requirements,
    }, 'normalize_brief'),
    ...evidence.map((item, index) => object(
      evidenceIds[index]!,
      'source_evidence',
      { source: item.source, locator: item.locator, claim: item.claim },
      'audit_evidence',
    )),
    ...requirements.map((statement, index) => object(
      requirementIds[index]!,
      'requirement',
      { statement, category: 'project_goal' },
      'normalize_brief',
      evidenceIds[index % Math.max(evidenceIds.length, 1)] ? [evidenceIds[index % evidenceIds.length]!] : [],
    )),
    ...constraints.map((statement, index) => object(
      constraintIds[index]!,
      'constraint',
      { statement, status: 'needs_review' },
      'audit_evidence',
      evidenceIds[index % Math.max(evidenceIds.length, 1)] ? [evidenceIds[index % evidenceIds.length]!] : [],
    )),
    ...findings.map((finding, index) => {
      const sources = (finding.source_indexes ?? []).flatMap((sourceIndex) => evidenceIds[sourceIndex] ? [evidenceIds[sourceIndex]!] : []);
      return object(
        findingIds[index]!,
        'analysis_finding',
        {
          discipline: finding.discipline,
          statement: finding.statement,
          design_impact: finding.design_impact,
        },
        index < records<Finding>(run.state.site_findings).length ? 'site_analysis' : 'program_analysis',
        sources,
      );
    }),
    ...directions.map((direction, index) => object(
      directionIds[index]!,
      'design_direction',
      {
        name: direction.name,
        thesis: direction.thesis,
        strategies: direction.strategies,
        risks: direction.risks,
      },
      'develop_directions',
      findingIds,
    )),
    object(
      decisionId,
      'decision',
      { approved: true, rationale: String(run.state.review_status) },
      'approval',
      directionIds,
      'role.design_reviewer',
    ),
    object(
      deliverableId,
      'deliverable',
      {
        title: `${String(run.state.project_name)} concept design brief`,
        content: run.state.deliverable,
        format: 'text/markdown',
      },
      'publish',
      [...evidenceIds, ...findingIds, ...directionIds, decisionId],
    ),
  ];

  for (const item of objects) await store.appendObject(item);

  let relationIndex = 0;
  const relation = (
    type: ContextRelation['type'],
    sourceId: string,
    targetId: string,
    nodeId: string,
    actorId?: string,
  ): ContextRelation => ({
    id: `${base}.relation.${++relationIndex}`,
    type,
    sourceId,
    targetId,
    version: 1,
    attributes: {},
    validFrom: recordedAt,
    validTo: null,
    provenance: provenance(nodeId, [sourceId, targetId], actorId),
  });

  const relations: ContextRelation[] = [
    ...requirementIds.map((id) => relation('brief_contains', briefId, id, 'normalize_brief')),
    ...constraintIds.map((id) => relation('brief_contains', briefId, id, 'audit_evidence')),
    ...requirementIds.flatMap((id, index) => evidenceIds.length > 0
      ? [relation('evidence_supports', evidenceIds[index % evidenceIds.length]!, id, 'audit_evidence')]
      : []),
    ...constraintIds.flatMap((id, index) => evidenceIds.length > 0
      ? [relation('evidence_supports', evidenceIds[index % evidenceIds.length]!, id, 'audit_evidence')]
      : []),
    ...findings.flatMap((finding, findingIndex) => (finding.source_indexes ?? []).flatMap((sourceIndex) =>
      evidenceIds[sourceIndex]
        ? [relation('evidence_supports', evidenceIds[sourceIndex]!, findingIds[findingIndex]!, 'audit_evidence')]
        : [])),
    ...findingIds.flatMap((findingId) => directionIds.map((directionId) =>
      relation('finding_informs', findingId, directionId, 'develop_directions'))),
    ...constraintIds.flatMap((constraintId) => directionIds.map((directionId) =>
      relation('constraint_governs', constraintId, directionId, 'evaluate_directions'))),
    ...findingIds.map((id) => relation('deliverable_includes', id, deliverableId, 'publish')),
    ...directionIds.map((id) => relation('deliverable_includes', id, deliverableId, 'publish')),
    relation('decision_governs', decisionId, deliverableId, 'approval', 'role.design_reviewer'),
  ];
  for (const item of relations) await store.appendRelation(item);
}
