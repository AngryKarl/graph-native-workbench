import type { ContextObject, ContextRelation } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface CompletedCybersecurityRun {
  readonly runId: string;
  readonly state: GraphState;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function items<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function projectCybersecurityResponseRun(
  store: ContextGraphStore,
  run: CompletedCybersecurityRun,
): Promise<void> {
  if (typeof run.state.incident_record === 'string') {
    await projectIncidentResponse(store, run);
    return;
  }
  if (typeof run.state.recovery_record === 'string' && typeof run.state.recovery_healthy === 'boolean') {
    await projectRecoveryObservation(store, run);
    return;
  }
  throw new Error('Cybersecurity context requires a completed triage, incident response or recovery observation.');
}

async function projectIncidentResponse(store: ContextGraphStore, run: CompletedCybersecurityRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const assessment = object(run.state.severity_assessment);
  const evidence = items<Record<string, unknown>>(run.state.evidence_results);
  const indicators = [
    ...items<string>(run.state.indicators).map((value) => ({ value, kind: 'indicator' })),
    ...items<string>(run.state.technique_ids).map((value) => ({ value, kind: 'attack_technique' })),
  ];
  const incident = object(run.state.incident);
  const declared = Boolean(text(incident.incident_id));
  const containment = items<Record<string, unknown>>(run.state.containment_results);
  const lessons = object(run.state.lessons_learned);
  const ids = {
    signal: `${base}.signal`, assessment: `${base}.assessment`, incident: `${base}.incident`,
    declarationDecision: `${base}.decision.declaration`, containmentDecision: `${base}.decision.containment`,
    recoveryDecision: `${base}.decision.recovery`, recoveryAction: `${base}.action.recovery`,
    lessons: `${base}.lessons`, record: `${base}.record`,
  };
  const provenance = makeProvenance(run.runId, recordedAt);
  const objects: ContextObject[] = [
    contextObject(ids.signal, 'security_signal', {
      signal_id: text(run.state.signal_id), source: text(run.state.source), title: text(run.state.title),
      observed_at: text(run.state.observed_at), confidence: numeric(run.state.confidence),
    }, recordedAt, provenance('normalize_signal', 'role.soc_analyst')),
    contextObject(ids.assessment, 'severity_assessment', {
      severity: text(assessment.severity), confidence: numeric(assessment.confidence),
      incident_likely: run.state.incident_likely === true, rationale: text(assessment.rationale),
    }, recordedAt, provenance('correlate_and_classify', 'role.soc_analyst')),
    ...evidence.map((value, index) => contextObject(`${base}.evidence.${index + 1}`, 'security_evidence', {
      evidence_id: text(value.evidence_id), evidence_ref: text(value.evidence_ref), digest: text(value.digest), status: text(value.status),
    }, recordedAt, provenance('analyze_evidence', 'role.forensic_analyst'))),
    ...indicators.map((value, index) => contextObject(`${base}.indicator.${index + 1}`, 'security_indicator', value, recordedAt, provenance('correlate_and_classify'))),
    ...(declared ? incidentObjects(run, base, incident, containment, lessons, recordedAt, provenance, ids) : []),
    contextObject(ids.record, 'security_delivery_record', {
      record_type: declared ? 'incident_response' : 'triage_closure', content: run.state.incident_record,
    }, recordedAt, provenance(declared ? 'publish_incident' : 'publish_non_incident')),
  ];
  await appendObjects(store, objects);

  const relations: ContextRelation[] = [
    relation(`${base}.relation.assessment.signal`, 'classifies_signal', ids.assessment, ids.signal, recordedAt, provenance('correlate_and_classify')),
    ...evidence.map((_, index) => relation(
      `${base}.relation.assessment.evidence.${index + 1}`, 'supported_by_evidence', ids.assessment, `${base}.evidence.${index + 1}`, recordedAt, provenance('correlate_and_classify'),
    )),
    ...indicators.map((_, index) => relation(
      `${base}.relation.signal.indicator.${index + 1}`, 'has_indicator', ids.signal, `${base}.indicator.${index + 1}`, recordedAt, provenance('correlate_and_classify'),
    )),
    ...(declared ? incidentRelations(run, base, evidence, containment, recordedAt, provenance, ids) : [
      relation(`${base}.relation.record.assessment`, 'documents_security_work', ids.record, ids.assessment, recordedAt, provenance('publish_non_incident')),
    ]),
  ];
  await appendRelations(store, relations);
}

function incidentObjects(
  run: CompletedCybersecurityRun,
  base: string,
  incident: Record<string, unknown>,
  containment: Record<string, unknown>[],
  lessons: Record<string, unknown>,
  recordedAt: string,
  provenance: ReturnType<typeof makeProvenance>,
  ids: Record<string, string>,
): ContextObject[] {
  return [
    contextObject(ids.incident!, 'security_incident', {
      incident_id: text(incident.incident_id), title: text(incident.title), severity: text(incident.severity), status: 'recovered',
    }, recordedAt, provenance('declare_incident', 'role.incident_commander')),
    ...items<string>(run.state.affected_asset_ids).map((assetId, index) => contextObject(`${base}.asset.${index + 1}`, 'affected_asset', {
      asset_id: assetId, criticality: text(run.state.asset_criticality),
    }, recordedAt, provenance('declare_incident'))),
    ...items<string>(run.state.affected_identity_ids).map((identityId, index) => contextObject(`${base}.identity.${index + 1}`, 'affected_identity', {
      identity_id: identityId, identity_kind: text(run.state.identity_kind),
    }, recordedAt, provenance('declare_incident'))),
    ...containment.map((action, index) => contextObject(`${base}.action.containment.${index + 1}`, 'response_action', {
      action_id: text(action.action_id), action_type: text(action.type), target_id: text(action.target_id), status: text(action.status),
    }, recordedAt, provenance('execute_containment', 'role.containment_approver'))),
    contextObject(ids.recoveryAction!, 'response_action', {
      action_id: `${text(incident.incident_id)}-recovery`, action_type: 'eradication_and_recovery',
      target_id: text(incident.incident_id), status: text(object(run.state.recovery_result).status),
    }, recordedAt, provenance('execute_recovery', 'role.recovery_owner')),
    contextObject(ids.declarationDecision!, 'security_decision', { gate: 'incident_declaration', approved: true }, recordedAt, provenance('incident_declaration_approval', 'role.incident_commander')),
    contextObject(ids.containmentDecision!, 'security_decision', { gate: 'containment', approved: true }, recordedAt, provenance('containment_approval', 'role.containment_approver')),
    contextObject(ids.recoveryDecision!, 'security_decision', { gate: 'recovery', approved: true }, recordedAt, provenance('recovery_approval', 'role.recovery_owner')),
    contextObject(ids.lessons!, 'lessons_learned', {
      incident_id: text(incident.incident_id), finding_count: items(lessons.findings).length,
      improvement_count: items(lessons.control_improvements).length,
    }, recordedAt, provenance('capture_lessons', 'role.incident_commander')),
  ];
}

function incidentRelations(
  run: CompletedCybersecurityRun,
  base: string,
  evidence: Record<string, unknown>[],
  containment: Record<string, unknown>[],
  recordedAt: string,
  provenance: ReturnType<typeof makeProvenance>,
  ids: Record<string, string>,
): ContextRelation[] {
  return [
    relation(`${base}.relation.signal.incident`, 'indicates_incident', ids.signal!, ids.incident!, recordedAt, provenance('declare_incident')),
    ...evidence.map((_, index) => relation(`${base}.relation.incident.evidence.${index + 1}`, 'supported_by_evidence', ids.incident!, `${base}.evidence.${index + 1}`, recordedAt, provenance('declare_incident'))),
    ...items(run.state.affected_asset_ids).map((_, index) => relation(`${base}.relation.incident.asset.${index + 1}`, 'affects_security_asset', ids.incident!, `${base}.asset.${index + 1}`, recordedAt, provenance('declare_incident'))),
    ...items(run.state.affected_identity_ids).map((_, index) => relation(`${base}.relation.incident.identity.${index + 1}`, 'affects_security_identity', ids.incident!, `${base}.identity.${index + 1}`, recordedAt, provenance('declare_incident'))),
    ...containment.map((_, index) => relation(`${base}.relation.action.${index + 1}.incident`, 'mitigates_incident', `${base}.action.containment.${index + 1}`, ids.incident!, recordedAt, provenance('execute_containment'))),
    relation(`${base}.relation.recovery-action.incident`, 'mitigates_incident', ids.recoveryAction!, ids.incident!, recordedAt, provenance('execute_recovery')),
    relation(`${base}.relation.declaration.incident`, 'governs_response', ids.declarationDecision!, ids.incident!, recordedAt, provenance('incident_declaration_approval')),
    ...containment.map((_, index) => relation(`${base}.relation.containment-decision.action.${index + 1}`, 'governs_response', ids.containmentDecision!, `${base}.action.containment.${index + 1}`, recordedAt, provenance('containment_approval'))),
    relation(`${base}.relation.recovery-decision.action`, 'governs_response', ids.recoveryDecision!, ids.recoveryAction!, recordedAt, provenance('recovery_approval')),
    relation(`${base}.relation.lessons.incident`, 'improves_after_incident', ids.lessons!, ids.incident!, recordedAt, provenance('capture_lessons')),
    relation(`${base}.relation.record.incident`, 'documents_security_work', ids.record!, ids.incident!, recordedAt, provenance('publish_incident')),
  ];
}

async function projectRecoveryObservation(store: ContextGraphStore, run: CompletedCybersecurityRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const healthy = run.state.recovery_healthy === true;
  const observation = object(run.state.recovery_observation);
  const ids = { incident: `${base}.incident-reference`, observation: `${base}.recovery-observation`, action: `${base}.rollback-action`, record: `${base}.record` };
  const provenance = makeProvenance(run.runId, recordedAt);
  await appendObjects(store, [
    contextObject(ids.incident, 'security_incident', {
      incident_id: text(run.state.incident_id), title: text(run.state.incident_title), severity: text(run.state.incident_severity), status: healthy ? 'recovered' : 'contained',
    }, recordedAt, provenance('assess_recovery')),
    contextObject(ids.observation, 'recovery_observation', {
      recovery_id: text(observation.recovery_id), status: text(observation.status), healthy,
      signal_count: numeric(observation.signal_count),
    }, recordedAt, provenance('assess_recovery', 'role.recovery_owner')),
    ...(!healthy ? [contextObject(ids.action, 'response_action', {
      action_id: `${text(run.state.recovery_id)}-rollback`, action_type: 'rollback_failed_recovery',
      target_id: text(run.state.change_ref), status: run.state.recovery_rollback_completed === true ? 'completed' : 'failed',
    }, recordedAt, provenance('rollback_recovery', 'role.recovery_owner'))] : []),
    contextObject(ids.record, 'security_delivery_record', {
      record_type: healthy ? 'recovery_health' : 'recovery_failure', content: run.state.recovery_record,
    }, recordedAt, provenance(healthy ? 'publish_healthy' : 'publish_failed')),
  ]);
  await appendRelations(store, [
    relation(`${base}.relation.observation.incident`, 'observes_incident_recovery', ids.observation, ids.incident, recordedAt, provenance('assess_recovery')),
    ...(!healthy ? [
      relation(`${base}.relation.rollback.incident`, 'mitigates_incident', ids.action, ids.incident, recordedAt, provenance('rollback_recovery')),
      relation(`${base}.relation.record.action`, 'documents_security_work', ids.record, ids.action, recordedAt, provenance('publish_failed')),
    ] : [
      relation(`${base}.relation.record.observation`, 'documents_security_work', ids.record, ids.observation, recordedAt, provenance('publish_healthy')),
    ]),
  ]);
}

function makeProvenance(runId: string, recordedAt: string) {
  return (nodeId: string, actorId = 'system.runtime') => ({
    sourceIds: [], producedByRunId: runId, producedByNodeId: nodeId, actorId, recordedAt,
  });
}

function contextObject(id: string, type: string, data: Record<string, unknown>, recordedAt: string, provenance: ContextObject['provenance']): ContextObject {
  return { id, type, version: 1, status: 'confirmed', data, validFrom: recordedAt, validTo: null, provenance };
}

function relation(id: string, type: string, sourceId: string, targetId: string, recordedAt: string, provenance: ContextRelation['provenance']): ContextRelation {
  return { id, type, sourceId, targetId, version: 1, attributes: {}, validFrom: recordedAt, validTo: null, provenance };
}

async function appendObjects(store: ContextGraphStore, objects: readonly ContextObject[]): Promise<void> {
  for (const value of objects) await store.appendObject(value);
}

async function appendRelations(store: ContextGraphStore, relations: readonly ContextRelation[]): Promise<void> {
  for (const value of relations) await store.appendRelation(value);
}
