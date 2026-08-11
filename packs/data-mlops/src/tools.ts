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

export const dataMlopsTools: ToolAdapterRegistry = {
  catalog_asset_read: {
    execute: (input) => {
      const assetId = text(record(input).asset_id);
      return { asset_id: assetId, status: 'registered', owner: 'reference-data-team' };
    },
  },
  orchestrator_run_read: {
    execute: (input) => {
      const runId = text(record(input).run_id);
      return { run_id: runId, status: 'success', logical_date: '2026-08-11T00:00:00.000Z' };
    },
  },
  lineage_read: {
    execute: (input) => ({
      asset_id: text(record(input).asset_id),
      upstream: ['reference://asset/source-a'],
    }),
  },
  registry_publish: {
    execute: (input) => {
      const request = record(input);
      const key = text(request.idempotency_key);
      return { registry_id: reference('registry', key), status: 'published' };
    },
  },
  backfill_create: {
    execute: (input) => {
      const request = record(input);
      const key = text(request.idempotency_key);
      return { backfill_id: reference('backfill', key), status: 'accepted' };
    },
  },
  model_alias_set: {
    execute: (input) => {
      const request = record(input);
      return {
        model_name: text(request.model_name),
        alias: text(request.alias),
        version: text(request.version),
        status: 'assigned',
      };
    },
  },
};
