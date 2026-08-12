import type { ToolAdapterRegistry } from '@graph-workbench/core';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const ref = (prefix: string, value: string) => `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export const healthcareDiagnosticsTools: ToolAdapterRegistry = {
  fhir_request_read: { execute: (input) => ({ resource_type: 'ServiceRequest', resource_id: text(record(input).request_id), status: 'active' }) },
  study_metadata_read: { execute: (input) => ({ study_id: text(record(input).study_id), status: 'available' }) },
  diagnostic_ai_infer: { execute: (input) => ({ inference_id: ref('inference', text(record(input).study_id)), advisory_only: true }) },
  diagnostic_report_write: { execute: (input) => ({ report_id: ref('report', text(record(input).idempotency_key)), status: 'final' }) },
  clinical_review_schedule: { execute: (input) => ({ appointment_id: ref('appointment', text(record(input).idempotency_key)), status: 'booked' }) },
};
