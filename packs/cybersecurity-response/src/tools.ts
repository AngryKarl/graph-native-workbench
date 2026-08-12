import type { ToolAdapterRegistry } from '@graph-workbench/core';

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function reference(prefix: string, value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  return `${prefix}-${slug}`;
}

export const cybersecurityResponseTools: ToolAdapterRegistry = {
  siem_signal_read: {
    execute: (input) => ({
      signal_id: text(record(input).signal_id), status: 'open', source: 'reference-siem',
    }),
  },
  asset_inventory_read: {
    execute: (input) => ({
      asset_id: text(record(input).asset_id), criticality: 'high', owner: 'reference-service-owner',
    }),
  },
  identity_context_read: {
    execute: (input) => ({
      identity_id: text(record(input).identity_id), status: 'active', privileged: true,
    }),
  },
  evidence_preserve: {
    execute: (input) => {
      const request = record(input);
      return {
        evidence_id: reference('evidence', text(request.idempotency_key)),
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'preserved',
      };
    },
  },
  containment_execute: {
    execute: (input) => ({
      action_id: reference('containment', text(record(input).idempotency_key)), status: 'completed',
    }),
  },
  notification_publish: {
    execute: (input) => ({
      notification_id: reference('notification', text(record(input).idempotency_key)), status: 'sent',
    }),
  },
  recovery_change_execute: {
    execute: (input) => ({
      recovery_id: reference('recovery', text(record(input).idempotency_key)), status: 'completed',
    }),
  },
  incident_record_upsert: {
    execute: (input) => ({
      incident_id: text(record(input).incident_id), status: 'recorded',
    }),
  },
};
