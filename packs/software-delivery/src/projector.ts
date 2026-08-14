import type { ContextObject, ContextRelation, GraphEvent } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface CompletedSoftwareDeliveryRun {
  readonly runId: string;
  readonly state: GraphState;
  readonly events?: readonly GraphEvent[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function items<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function projectSoftwareDeliveryRun(
  store: ContextGraphStore,
  run: CompletedSoftwareDeliveryRun,
): Promise<void> {
  if (typeof run.state.release_record === 'string' && run.state.release_approved === true) {
    await projectRelease(store, run);
    return;
  }
  if (typeof run.state.deployment_record === 'string' && typeof run.state.deployment_healthy === 'boolean') {
    await projectDeployment(store, run);
    return;
  }
  throw new Error('Software Delivery context requires an approved release or completed deployment observation.');
}

async function projectRelease(
  store: ContextGraphStore,
  run: CompletedSoftwareDeliveryRun,
): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const candidate = object(run.state.release_candidate);
  const risk = object(run.state.risk_assessment);
  const change = object(run.state.change_set);
  const changeRequest = object(run.state.change_request);
  const buildProvenance = object(run.state.build_provenance);
  const deploymentRequest = object(run.state.deployment_request);
  const verifications = items<Record<string, unknown>>(run.state.verification_results);
  const ids = {
    work: `${base}.work-item`,
    repository: `${base}.repository`,
    change: `${base}.change-set`,
    changeRequest: `${base}.change-request`,
    codeDecision: `${base}.decision.code-owner`,
    releaseDecision: `${base}.decision.release-manager`,
    release: `${base}.release`,
    buildProvenance: `${base}.build-provenance`,
    deploymentRequest: `${base}.deployment-request`,
    record: `${base}.record`,
  };
  const provenance = (nodeId: string, actorId = 'system.runtime') => ({
    sourceIds: [],
    producedByRunId: run.runId,
    producedByNodeId: nodeId,
    actorId,
    recordedAt,
  });

  const objects: ContextObject[] = [
    {
      id: ids.work,
      type: 'work_item',
      version: 1,
      status: 'confirmed',
      data: {
        issue_id: text(run.state.issue_id),
        title: text(run.state.title),
        acceptance_criteria: items(run.state.acceptance_criteria),
        risk_level: text(risk.level),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('normalize_intake'),
    },
    {
      id: ids.repository,
      type: 'repository',
      version: 1,
      status: 'confirmed',
      data: { name: text(run.state.repository), ref: text(run.state.base_ref) },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('build_change_set'),
    },
    {
      id: ids.change,
      type: 'change_set',
      version: 1,
      status: 'confirmed',
      data: {
        summary: text(change.summary),
        affected_components: items(change.affected_components),
        reversible: change.reversible === true,
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('build_change_set', 'role.software_engineer'),
    },
    {
      id: ids.changeRequest,
      type: 'change_request',
      version: 1,
      status: 'confirmed',
      data: {
        change_request_id: text(changeRequest.change_request_id),
        url: text(changeRequest.url),
        status: text(changeRequest.status),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('open_change_request', 'role.software_engineer'),
    },
    ...verifications.map((verification, index): ContextObject => ({
      id: `${base}.verification.${index + 1}`,
      type: 'verification',
      version: 1,
      status: 'confirmed',
      data: {
        check_id: text(verification.check_id),
        type: text(verification.type),
        status: text(verification.status),
        evidence_uri: text(verification.evidence_uri),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('run_checks', 'role.quality_engineer'),
    })),
    {
      id: ids.codeDecision,
      type: 'review_decision',
      version: 1,
      status: 'confirmed',
      data: { gate: 'code_owner', approved: true },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('code_review', 'role.code_owner'),
    },
    {
      id: ids.releaseDecision,
      type: 'review_decision',
      version: 1,
      status: 'confirmed',
      data: { gate: 'release_manager', approved: true },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('release_approval', 'role.release_manager'),
    },
    {
      id: ids.release,
      type: 'release',
      version: 1,
      status: 'confirmed',
      data: {
        release_id: text(candidate.release_id),
        version: text(candidate.version),
        environment: text(candidate.environment),
        artifact_digest: text(candidate.artifact_digest),
        status: 'approved',
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('prepare_release'),
    },
    {
      id: ids.buildProvenance,
      type: 'build_provenance',
      version: 1,
      status: 'confirmed',
      data: {
        builder_id: text(buildProvenance.builder_id),
        build_type: text(buildProvenance.build_type),
        source_ref: text(buildProvenance.source_ref),
        artifact_digest: text(buildProvenance.artifact_digest),
        attestation_uri: text(buildProvenance.attestation_uri),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('prepare_release'),
    },
    {
      id: ids.deploymentRequest,
      type: 'deployment_request',
      version: 1,
      status: 'confirmed',
      data: {
        request_id: text(deploymentRequest.request_id),
        release_id: text(deploymentRequest.release_id),
        environment: text(deploymentRequest.environment),
        status: text(deploymentRequest.status),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('request_deployment', 'role.release_manager'),
    },
    {
      id: ids.record,
      type: 'delivery_record',
      version: 1,
      status: 'confirmed',
      data: { record_type: 'release_readiness', content: run.state.release_record },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('publish_release'),
    },
  ];
  for (const value of objects) await store.appendObject(value);

  const relations: ContextRelation[] = [
    relation(`${base}.relation.work.repository`, 'targets', ids.work, ids.repository, recordedAt, provenance('normalize_intake')),
    relation(`${base}.relation.change.work`, 'implements', ids.change, ids.work, recordedAt, provenance('build_change_set')),
    relation(`${base}.relation.change.repository`, 'belongs_to', ids.change, ids.repository, recordedAt, provenance('build_change_set')),
    relation(`${base}.relation.change.request`, 'proposed_as', ids.change, ids.changeRequest, recordedAt, provenance('open_change_request')),
    ...verifications.map((_, index) => relation(
      `${base}.relation.verification.${index + 1}.change`,
      'validates',
      `${base}.verification.${index + 1}`,
      ids.change,
      recordedAt,
      provenance('quality_gate'),
    )),
    relation(`${base}.relation.code-decision.change`, 'governs', ids.codeDecision, ids.change, recordedAt, provenance('code_review', 'role.code_owner')),
    relation(`${base}.relation.release-decision.release`, 'governs', ids.releaseDecision, ids.release, recordedAt, provenance('release_approval', 'role.release_manager')),
    relation(`${base}.relation.release.change`, 'contains_change', ids.release, ids.change, recordedAt, provenance('prepare_release')),
    relation(`${base}.relation.provenance.release`, 'produces', ids.buildProvenance, ids.release, recordedAt, provenance('prepare_release')),
    relation(`${base}.relation.deployment-request.release`, 'requests_promotion', ids.deploymentRequest, ids.release, recordedAt, provenance('request_deployment', 'role.release_manager')),
    relation(`${base}.relation.record.release`, 'documents', ids.record, ids.release, recordedAt, provenance('publish_release')),
  ];
  for (const value of relations) await store.appendRelation(value);
}

async function projectDeployment(
  store: ContextGraphStore,
  run: CompletedSoftwareDeliveryRun,
): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const releaseId = text(run.state.release_id);
  const version = releaseId.includes('@') ? releaseId.slice(releaseId.lastIndexOf('@') + 1) : 'unknown';
  const healthy = run.state.deployment_healthy === true;
  const priorReleaseId = text(object(run.state.release_context).object_id);
  const ids = {
    release: priorReleaseId || `${base}.release-reference`,
    deployment: `${base}.deployment`,
    incident: `${base}.incident`,
    record: `${base}.record`,
  };
  const provenance = (nodeId: string, actorId = 'system.runtime', sourceIds: string[] = []) => ({
    sourceIds,
    producedByRunId: run.runId,
    producedByNodeId: nodeId,
    actorId,
    recordedAt,
  });
  const objects: ContextObject[] = [
    ...(!priorReleaseId ? [{
      id: ids.release,
      type: 'release',
      version: 1,
      status: 'confirmed',
      data: {
        release_id: releaseId,
        version,
        environment: text(run.state.environment),
        artifact_digest: text(run.state.artifact_digest),
        status: 'observed',
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('assess_deployment'),
    } satisfies ContextObject] : []),
    {
      id: ids.deployment,
      type: 'deployment',
      version: 1,
      status: 'confirmed',
      data: {
        deployment_id: text(run.state.deployment_id),
        release_id: releaseId,
        environment: text(run.state.environment),
        healthy,
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('assess_deployment', 'system.runtime', priorReleaseId ? [priorReleaseId] : []),
    },
    ...(!healthy ? [{
      id: ids.incident,
      type: 'incident',
      version: 1,
      status: 'confirmed',
      data: {
        release_id: releaseId,
        deployment_id: text(run.state.deployment_id),
        status: text(run.state.status),
        rollback_completed: run.state.rollback_completed === true,
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance('escalate_incident', 'role.service_owner'),
    } satisfies ContextObject] : []),
    {
      id: ids.record,
      type: 'delivery_record',
      version: 1,
      status: 'confirmed',
      data: {
        record_type: healthy ? 'deployment_health' : 'deployment_incident',
        content: run.state.deployment_record,
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: provenance(healthy ? 'publish_healthy' : 'publish_failed'),
    },
  ];
  for (const value of objects) await store.appendObject(value);

  const relations: ContextRelation[] = [
    relation(`${base}.relation.deployment.release`, 'promotes', ids.deployment, ids.release, recordedAt, provenance('assess_deployment', 'system.runtime', priorReleaseId ? [priorReleaseId] : [])),
    relation(`${base}.relation.record.deployment`, 'documents', ids.record, ids.deployment, recordedAt, provenance(healthy ? 'publish_healthy' : 'publish_failed')),
    ...(!healthy ? [
      relation(`${base}.relation.incident.deployment`, 'affects', ids.incident, ids.deployment, recordedAt, provenance('escalate_incident', 'role.service_owner')),
      relation(`${base}.relation.record.incident`, 'documents', ids.record, ids.incident, recordedAt, provenance('publish_failed')),
    ] : []),
  ];
  for (const value of relations) await store.appendRelation(value);
}

function relation(
  id: string,
  type: string,
  sourceId: string,
  targetId: string,
  recordedAt: string,
  provenance: ContextRelation['provenance'],
): ContextRelation {
  return {
    id,
    type,
    sourceId,
    targetId,
    version: 1,
    attributes: {},
    validFrom: recordedAt,
    validTo: null,
    provenance,
  };
}
