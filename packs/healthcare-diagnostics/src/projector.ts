import type { ContextObject, ContextRelation, GraphEvent } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface Run { readonly runId: string; readonly state: GraphState; readonly events?: readonly GraphEvent[] }
const text = (value: unknown) => typeof value === 'string' ? value : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = <T = unknown>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const provenance = (run: Run, nodeId: string, recordedAt: string, actorId = 'system.runtime') => ({ sourceIds: [], producedByRunId: run.runId, producedByNodeId: nodeId, actorId, recordedAt });
const relation = (id: string, type: string, sourceId: string, targetId: string, recordedAt: string, source: ReturnType<typeof provenance>): ContextRelation => ({ id, type, sourceId, targetId, version: 1, attributes: {}, validFrom: recordedAt, validTo: null, provenance: source });

export async function projectHealthcareDiagnosticsRun(store: ContextGraphStore, run: Run): Promise<void> {
  if (typeof run.state.diagnostic_coordination_record === 'string') return projectDiagnostic(store, run);
  if (typeof run.state.followup_record === 'string') return projectFollowup(store, run);
  throw new Error('Healthcare context requires a completed diagnostic or follow-up record.');
}

async function append(store: ContextGraphStore, objects: ContextObject[], relations: ContextRelation[]) {
  for (const value of objects) await store.appendObject(value);
  for (const value of relations) await store.appendRelation(value);
}

async function projectDiagnostic(store: ContextGraphStore, run: Run) {
  const at = new Date().toISOString(); const base = run.runId;
  const request = object(run.state.service_request); const consent = object(run.state.consent_check);
  const report = object(run.state.diagnostic_report); const plan = object(run.state.followup_plan);
  const analyses = items<Record<string, unknown>>(run.state.study_analyses);
  const ids = { request: `${base}.request`, consent: `${base}.consent`, report: `${base}.report`, plan: `${base}.plan`, decision: `${base}.decision`, record: `${base}.record` };
  const objects: ContextObject[] = [
    { id: ids.request, type: 'service_request', version: 1, status: 'confirmed', data: { request_id: text(request.request_id), service_code: text(request.service_code), reason: text(request.reason) }, validFrom: at, validTo: null, provenance: provenance(run, 'normalize_request', at) },
    { id: ids.consent, type: 'consent_record', version: 1, status: 'confirmed', data: { consent_id: text(consent.consent_id), status: text(consent.status), purpose_of_use: text(consent.purpose_of_use) }, validFrom: at, validTo: null, provenance: provenance(run, 'verify_consent', at, 'role.privacy_officer') },
    ...analyses.flatMap((analysis, index): ContextObject[] => {
      const studyId = `${base}.study.${index + 1}`; const observationId = `${base}.observation.${index + 1}`;
      return [
        { id: studyId, type: 'study', version: 1, status: 'confirmed', data: { study_id: text(analysis.study_id), modality: text(analysis.modality), evidence_uri: text(analysis.evidence_uri) }, validFrom: at, validTo: null, provenance: provenance(run, 'analyze_studies', at) },
        { id: observationId, type: 'observation', version: 1, status: 'confirmed', data: { study_id: text(analysis.study_id), summary: text(analysis.summary), advisory_only: true }, validFrom: at, validTo: null, provenance: provenance(run, 'synthesize_findings', at, 'role.diagnostic_assistant') },
      ];
    }),
    { id: ids.decision, type: 'practitioner_decision', version: 1, status: 'confirmed', data: { gate: 'specialist_report', approved: true }, validFrom: at, validTo: null, provenance: provenance(run, 'specialist_review', at, 'role.clinical_specialist') },
    { id: ids.report, type: 'diagnostic_report', version: 1, status: 'confirmed', data: { report_id: text(report.report_id), status: text(report.status), conclusion: text(report.conclusion) }, validFrom: at, validTo: null, provenance: provenance(run, 'prepare_report', at, 'role.clinical_specialist') },
    { id: ids.plan, type: 'followup_plan', version: 1, status: 'confirmed', data: { case_id: text(plan.case_id), priority: text(plan.priority), next_step: text(plan.next_step) }, validFrom: at, validTo: null, provenance: provenance(run, 'prepare_report', at, 'role.clinical_specialist') },
    { id: ids.record, type: 'diagnostic_record', version: 1, status: 'confirmed', data: { record_type: 'diagnostic_coordination', content: run.state.diagnostic_coordination_record }, validFrom: at, validTo: null, provenance: provenance(run, 'publish_report', at) },
  ];
  const relations: ContextRelation[] = [
    relation(`${base}.rel.request.consent`, 'authorized_by', ids.request, ids.consent, at, provenance(run, 'access_approval', at)),
    ...analyses.flatMap((_, index) => [
      relation(`${base}.rel.study.${index + 1}.request`, 'fulfills_request', `${base}.study.${index + 1}`, ids.request, at, provenance(run, 'analyze_studies', at)),
      relation(`${base}.rel.observation.${index + 1}.study`, 'derived_from_study', `${base}.observation.${index + 1}`, `${base}.study.${index + 1}`, at, provenance(run, 'synthesize_findings', at)),
      relation(`${base}.rel.report.observation.${index + 1}`, 'includes_observation', ids.report, `${base}.observation.${index + 1}`, at, provenance(run, 'prepare_report', at)),
    ]),
    relation(`${base}.rel.decision.report`, 'governs_report', ids.decision, ids.report, at, provenance(run, 'specialist_review', at)),
    relation(`${base}.rel.report.request`, 'responds_to_request', ids.report, ids.request, at, provenance(run, 'prepare_report', at)),
    relation(`${base}.rel.report.plan`, 'defines_followup', ids.report, ids.plan, at, provenance(run, 'prepare_report', at)),
    relation(`${base}.rel.record.report`, 'documents_diagnostic_work', ids.record, ids.report, at, provenance(run, 'publish_report', at)),
  ];
  await append(store, objects, relations);
}

async function projectFollowup(store: ContextGraphStore, run: Run) {
  const at = new Date().toISOString(); const base = run.runId;
  const assessment = object(run.state.followup_assessment);
  const observationId = `${base}.followup`; const planId = `${base}.plan`; const recordId = `${base}.record`;
  const objects: ContextObject[] = [
    { id: planId, type: 'followup_plan', version: 1, status: 'confirmed', data: { case_id: text(run.state.case_id), priority: run.state.followup_expected === true ? 'routine' : 'urgent', next_step: run.state.followup_expected === true ? 'Continue approved plan' : 'Specialist reassessment' }, validFrom: at, validTo: null, provenance: provenance(run, 'assess_followup', at) },
    { id: observationId, type: 'followup_observation', version: 1, status: 'confirmed', data: { case_id: text(run.state.case_id), expected: assessment.expected === true }, validFrom: at, validTo: null, provenance: provenance(run, 'assess_followup', at) },
    ...(run.state.review_scheduled === true ? [{ id: `${base}.review`, type: 'clinical_review', version: 1, status: 'confirmed', data: { case_id: text(run.state.case_id), scheduled: true, reference: text(run.state.review_reference) }, validFrom: at, validTo: null, provenance: provenance(run, 'schedule_review', at, 'role.care_coordinator') } satisfies ContextObject] : []),
    { id: recordId, type: 'diagnostic_record', version: 1, status: 'confirmed', data: { record_type: 'followup', content: run.state.followup_record }, validFrom: at, validTo: null, provenance: provenance(run, 'publish_followup', at) },
  ];
  const relations: ContextRelation[] = [
    relation(`${base}.rel.observation.plan`, 'observes_plan', observationId, planId, at, provenance(run, 'assess_followup', at)),
    ...(run.state.review_scheduled === true ? [relation(`${base}.rel.observation.review`, 'triggers_review', observationId, `${base}.review`, at, provenance(run, 'escalate_review', at))] : []),
    relation(`${base}.rel.record.observation`, 'documents_diagnostic_work', recordId, observationId, at, provenance(run, 'publish_followup', at)),
  ];
  await append(store, objects, relations);
}
