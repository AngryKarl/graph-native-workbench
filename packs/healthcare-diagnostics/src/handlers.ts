import { createHash } from 'node:crypto';
import type { HandlerRegistry } from '@graph-workbench/core';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = <T = unknown>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export const healthcareDiagnosticsHandlers: HandlerRegistry = {
  'healthcare_diagnostics.normalize_request': ({ state }) => ({
    service_request: {
      request_id: text(state.request_id), case_id: text(state.case_id), service_code: text(state.service_code),
      reason: text(state.reason), requesting_practitioner: text(state.requesting_practitioner), priority: text(state.priority),
    },
  }),
  'healthcare_diagnostics.verify_consent': ({ state }) => {
    const consent = object(state.consent);
    const access = object(state.access_context);
    return {
      consent_check: {
        consent_id: text(consent.consent_id), status: text(consent.status), scope: items(consent.scope),
        practitioner_id: text(access.practitioner_id), purpose_of_use: text(access.purpose_of_use),
        eligible: text(consent.status) === 'active' && text(access.purpose_of_use) === 'treatment',
      },
    };
  },
  'healthcare_diagnostics.prepare_studies': ({ state }) => {
    const studies = items<Record<string, unknown>>(state.studies);
    if (studies.length === 0) throw new Error('Diagnostic coordination requires at least one study reference.');
    return { study_worklist: studies.map((study) => ({ ...study, case_id: text(state.case_id) })) };
  },
  'healthcare_diagnostics.analyze_study': ({ state }) => {
    const study = object(state.study);
    const studyId = text(study.study_id);
    const urgent = study.urgent_marker === true;
    return {
      result: {
        study_id: studyId, modality: text(study.modality), body_site: text(study.body_site),
        summary: urgent ? 'Reference analysis detected a marker requiring urgent specialist review.' : 'Reference analysis found no urgent marker.',
        urgent, confidence: urgent ? 0.91 : 0.78,
        evidence_uri: `reference://diagnostic-study/${encodeURIComponent(studyId)}`,
        digest: createHash('sha256').update(studyId).digest('hex'),
        advisory_only: true,
      },
    };
  },
  'healthcare_diagnostics.synthesize_findings': ({ state }) => {
    const analyses = items<Record<string, unknown>>(state.study_analyses);
    return {
      draft_findings: {
        study_count: analyses.length,
        urgent: analyses.some((analysis) => analysis.urgent === true),
        observations: analyses.map((analysis) => ({ study_id: analysis.study_id, summary: analysis.summary, evidence_uri: analysis.evidence_uri })),
        limitations: ['Reference-only AI assistance', 'Requires specialist interpretation', 'Not a clinical diagnosis'],
      },
      urgent_finding: analyses.some((analysis) => analysis.urgent === true),
    };
  },
  'healthcare_diagnostics.prepare_report': ({ state }) => ({
    diagnostic_report: {
      report_id: `report-${text(state.request_id)}`,
      case_id: text(state.case_id),
      status: 'final',
      conclusion: text(state.clinician_conclusion),
      findings: object(state.draft_findings),
      approved: state.specialist_approved === true,
      issued_at: text(state.observed_at),
    },
    followup_plan: {
      case_id: text(state.case_id),
      priority: state.urgent_finding === true ? 'urgent' : 'routine',
      next_step: state.urgent_finding === true ? 'Specialist-led urgent follow-up' : 'Return to requesting practitioner',
    },
  }),
  'healthcare_diagnostics.publish_report': ({ state }) => {
    const report = object(state.diagnostic_report);
    const plan = object(state.followup_plan);
    return {
      diagnostic_coordination_record: [
        `# Diagnostic coordination record — ${text(state.request_id)}`,
        '',
        `Case: ${text(state.case_id)}`,
        `Service: ${text(state.service_code)}`,
        `Report: ${text(report.report_id)} (${text(report.status)})`,
        `Specialist conclusion: ${text(report.conclusion)}`,
        `Urgent finding: ${String(state.urgent_finding === true)}`,
        `Follow-up: ${text(plan.next_step)}`,
        '',
        'AI-generated material is advisory evidence only. Clinical interpretation and the final report remain the accountable specialist’s decision.',
      ].join('\n'),
    };
  },
  'healthcare_diagnostics.record_rejection': ({ state }) => ({
    rejection_reason: state.access_approved === false
      ? 'Authorized practitioner did not approve consent-scoped access.'
      : 'Clinical specialist rejected the draft findings or requested additional evidence.',
  }),
  'healthcare_diagnostics.assess_followup': ({ state }) => {
    const observations = items<Record<string, unknown>>(state.followup_observations);
    const expected = observations.length > 0 && observations.every((item) => ['stable', 'improved', 'resolved'].includes(text(item.status)));
    return {
      followup_expected: expected,
      followup_assessment: { case_id: text(state.case_id), observation_count: observations.length, expected, observations },
    };
  },
  'healthcare_diagnostics.schedule_review': ({ state }) => ({
    review_scheduled: true,
    review_reference: `reference://clinical-review/${encodeURIComponent(text(state.case_id))}`,
  }),
  'healthcare_diagnostics.publish_followup': ({ state }) => ({
    followup_record: [
      `# Diagnostic follow-up — ${text(state.case_id)}`,
      '',
      `Assessment: ${state.followup_expected === true ? 'expected' : 'unexpected'}`,
      `Specialist review: ${state.review_scheduled === true ? 'scheduled' : 'not required'}`,
      ...(state.review_scheduled === true ? [`Reference: ${text(state.review_reference)}`] : []),
      'No autonomous clinical action was taken.',
    ].join('\n'),
  }),
};
