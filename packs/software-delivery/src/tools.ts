import type { ToolAdapterRegistry } from '@graph-workbench/core';

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function referenceId(prefix: string, value: string): string {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}`;
}

export const softwareDeliveryTools: ToolAdapterRegistry = {
  work_item_read: {
    execute: (input) => {
      const issueId = text(record(input).issue_id);
      return { issue_id: issueId, title: `Reference work item ${issueId}`, status: 'ready' };
    },
  },
  repository_read: {
    execute: (input) => {
      const request = record(input);
      return {
        repository: text(request.repository),
        ref: text(request.ref),
        commit_sha: '0000000000000000000000000000000000000000',
      };
    },
  },
  change_request_upsert: {
    execute: (input) => {
      const request = record(input);
      const key = text(request.idempotency_key);
      return {
        change_request_id: referenceId('cr', key),
        url: `reference://change-request/${encodeURIComponent(key)}`,
        status: 'open',
      };
    },
  },
  deployment_execute: {
    execute: (input) => {
      const request = record(input);
      const key = text(request.idempotency_key);
      return {
        deployment_id: referenceId('deployment', key),
        status: 'accepted',
      };
    },
  },
  deployment_rollback: {
    execute: (input) => {
      const request = record(input);
      const deploymentId = text(request.deployment_id);
      return {
        rollback_id: referenceId('rollback', deploymentId),
        status: 'accepted',
      };
    },
  },
};
