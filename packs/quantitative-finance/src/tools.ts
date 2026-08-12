import type { ToolAdapterRegistry } from '@graph-workbench/core';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function reference(prefix: string, value: string): string {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'record'}`;
}

export const quantitativeFinanceTools: ToolAdapterRegistry = {
  market_data_read: {
    execute: (input) => ({
      snapshot_id: reference('market', text(record(input).as_of)),
      status: 'point-in-time-ready',
    }),
  },
  backtest_execute: {
    execute: (input) => {
      const instrument = text(record(input).instrument);
      return {
        run_id: reference('backtest', instrument),
        evidence_uri: `reference://backtest/${encodeURIComponent(instrument)}`,
      };
    },
  },
  risk_engine_read: {
    execute: (input) => ({
      risk_snapshot_id: reference('risk', text(record(input).strategy_id)),
      status: 'calculated',
    }),
  },
  order_submit: {
    execute: (input) => ({
      execution_id: reference('execution', text(record(input).idempotency_key)),
      status: 'accepted',
    }),
  },
  fill_read: {
    execute: () => ({ fills: [] }),
  },
  reconciliation_write: {
    execute: (input) => ({
      record_id: reference('reconciliation', text(record(input).idempotency_key)),
      status: 'recorded',
    }),
  },
};
