import { createHash } from 'node:crypto';
import type { HandlerRegistry } from '@graph-workbench/core';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
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

function stableFraction(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  return digest.readUInt16BE(0) / 65_535;
}

export const quantitativeFinanceHandlers: HandlerRegistry = {
  'quantitative_finance.normalize_mandate': ({ state }) => ({
    mandate: {
      strategy_id: text(state.strategy_id),
      objective: text(state.objective),
      universe: items(state.universe),
      benchmark: text(state.benchmark),
      capital_usd: number(state.capital_usd),
      constraints: object(state.constraints),
      as_of: text(state.as_of),
    },
  }),

  'quantitative_finance.formulate_hypothesis': ({ state }) => ({
    hypothesis: {
      statement: `${text(state.objective)} using observable, point-in-time signals`,
      signal_family: 'cross-sectional momentum with volatility scaling',
      falsification: 'Reject when out-of-sample Sharpe is below 0.8 or drawdown exceeds mandate.',
      leakage_controls: ['point-in-time universe', 'lagged features', 'survivorship check'],
      benchmark: text(state.benchmark),
    },
  }),

  'quantitative_finance.prepare_backtests': ({ state }) => {
    const universe = items<string>(state.universe);
    if (universe.length < 2) throw new Error('Strategy research requires at least two instruments.');
    return {
      backtest_requests: universe.map((instrument) => ({
        strategy_id: text(state.strategy_id), instrument, as_of: text(state.as_of),
        lookback_days: 252, benchmark: text(state.benchmark),
      })),
    };
  },

  'quantitative_finance.run_backtest': ({ state }) => {
    const request = object(state.request);
    const instrument = text(request.instrument);
    const fraction = stableFraction(`${text(request.strategy_id)}:${instrument}`);
    const annualReturn = Number((0.09 + fraction * 0.11).toFixed(4));
    const volatility = Number((0.12 + (1 - fraction) * 0.08).toFixed(4));
    const sharpe = Number((annualReturn / volatility).toFixed(3));
    return {
      result: {
        instrument,
        period: '5y point-in-time simulation',
        annual_return: annualReturn,
        volatility,
        sharpe,
        max_drawdown: Number((-0.08 - (1 - fraction) * 0.12).toFixed(4)),
        turnover: Number((0.4 + fraction * 0.8).toFixed(3)),
        evidence_uri: `reference://backtest/${encodeURIComponent(text(request.strategy_id))}/${encodeURIComponent(instrument)}`,
      },
    };
  },

  'quantitative_finance.aggregate_research': ({ state }) => {
    const results = items<Record<string, unknown>>(state.backtest_results);
    if (results.length === 0) throw new Error('Research gate requires backtest evidence.');
    const averageSharpe = results.reduce((sum, result) => sum + number(result.sharpe), 0) / results.length;
    const worstDrawdown = Math.min(...results.map((result) => number(result.max_drawdown)));
    return {
      research_summary: {
        instrument_count: results.length,
        average_sharpe: Number(averageSharpe.toFixed(3)),
        worst_drawdown: Number(worstDrawdown.toFixed(4)),
        evidence_uris: results.map((result) => text(result.evidence_uri)),
        status: averageSharpe >= 0.8 ? 'passed' : 'failed',
      },
    };
  },

  'quantitative_finance.construct_portfolio': ({ state }) => {
    const results = items<Record<string, unknown>>(state.backtest_results);
    const raw = results.map((result) => ({
      instrument: text(result.instrument),
      score: Math.max(0.01, number(result.sharpe) / Math.max(0.01, number(result.volatility))),
    }));
    const total = raw.reduce((sum, item) => sum + item.score, 0);
    return {
      target_portfolio: raw.map((item) => ({
        instrument: item.instrument,
        target_weight: Number((item.score / total).toFixed(4)),
      })),
    };
  },

  'quantitative_finance.assess_risk': ({ state }) => {
    const constraints = object(state.constraints);
    const research = object(state.research_summary);
    const maxDrawdownLimit = Math.abs(number(constraints.max_drawdown));
    const observedDrawdown = Math.abs(number(research.worst_drawdown));
    const grossLimit = number(constraints.max_gross_exposure) || 1;
    const passed = observedDrawdown <= maxDrawdownLimit && grossLimit <= 1.5
      && text(research.status) === 'passed';
    return {
      risk_assessment: {
        passed,
        observed_drawdown: observedDrawdown,
        max_drawdown_limit: maxDrawdownLimit,
        gross_exposure: 1,
        gross_limit: grossLimit,
        stress_loss_99: Number((number(state.capital_usd) * 0.075).toFixed(2)),
        model_risk: 'Reference simulation only; independent production validation required.',
      },
    };
  },

  'quantitative_finance.prepare_order_intent': ({ state }) => ({
    order_intent: {
      strategy_id: text(state.strategy_id),
      account_id: text(state.account_id),
      as_of: text(state.as_of),
      orders: items<Record<string, unknown>>(state.target_portfolio).map((position) => ({
        instrument: text(position.instrument),
        target_weight: number(position.target_weight),
        notional_usd: Number((number(position.target_weight) * number(state.capital_usd)).toFixed(2)),
        order_type: 'market-on-close',
      })),
      status: 'approved_for_submission',
    },
  }),

  'quantitative_finance.submit_orders': ({ state, runId }) => ({
    execution_request: {
      request_id: `execution-${runId}`,
      account_id: text(state.account_id),
      order_count: items(object(state.order_intent).orders).length,
      status: 'accepted_by_reference_oms',
      idempotency_key: `${runId}:submit-orders`,
    },
  }),

  'quantitative_finance.publish_strategy': ({ state }) => {
    const research = object(state.research_summary);
    const risk = object(state.risk_assessment);
    const execution = object(state.execution_request);
    return {
      strategy_execution_record: [
        `# Governed strategy release — ${text(state.strategy_id)}`,
        '',
        `**Objective:** ${text(state.objective)}`,
        `**Benchmark:** ${text(state.benchmark)}`,
        `**As of:** ${text(state.as_of)}`,
        `**Average backtest Sharpe:** ${String(research.average_sharpe ?? '')}`,
        `**Worst drawdown:** ${String(research.worst_drawdown ?? '')}`,
        `**99% stress loss:** $${String(risk.stress_loss_99 ?? '')}`,
        '',
        '## Accountable decisions',
        '- Independent risk approval: approved',
        '- Compliance approval: approved',
        '- Execution authorization: approved',
        '',
        `OMS request: ${text(execution.request_id)} (${text(execution.status)})`,
        'Market simulation, order routing and books-and-records remain external authorities.',
      ].join('\n'),
    };
  },

  'quantitative_finance.record_rejection': ({ state }) => ({
    rejection_reason: state.risk_approved === false
      ? 'Independent risk rejected the strategy evidence or limits.'
      : state.compliance_approved === false
        ? 'Compliance rejected the mandate, restrictions or intended execution.'
        : 'Execution owner did not authorize order submission.',
  }),

  'quantitative_finance.normalize_execution': ({ state }) => ({
    execution_observation: {
      execution_id: text(state.execution_id),
      strategy_id: text(state.strategy_id),
      account_id: text(state.account_id),
      fills: items(state.fills),
      expected_notional_usd: number(state.expected_notional_usd),
      observed_at: text(state.observed_at),
    },
  }),

  'quantitative_finance.reconcile_execution': ({ state }) => {
    const fills = items<Record<string, unknown>>(state.fills);
    const filledNotional = fills.reduce((sum, fill) => sum + number(fill.notional_usd), 0);
    const expected = number(state.expected_notional_usd);
    const variance = Number((filledNotional - expected).toFixed(2));
    const matched = fills.length > 0 && Math.abs(variance) <= Math.max(1, expected * 0.001)
      && fills.every((fill) => text(fill.status) === 'filled');
    return {
      reconciliation_matched: matched,
      reconciliation: {
        matched,
        fill_count: fills.length,
        filled_notional_usd: filledNotional,
        expected_notional_usd: expected,
        variance_usd: variance,
      },
    };
  },

  'quantitative_finance.cancel_residual_orders': ({ state }) => ({
    residual_cancelled: true,
    cancellation_reference: `reference://oms/cancel/${encodeURIComponent(text(state.execution_id))}`,
  }),

  'quantitative_finance.publish_reconciliation': ({ state }) => {
    const reconciliation = object(state.reconciliation);
    return {
      reconciliation_record: [
        `# Execution reconciliation — ${text(state.execution_id)}`,
        '',
        `Strategy: ${text(state.strategy_id)}`,
        `Account: ${text(state.account_id)}`,
        `Fills: ${String(reconciliation.fill_count ?? 0)}`,
        `Expected notional: $${String(reconciliation.expected_notional_usd ?? 0)}`,
        `Filled notional: $${String(reconciliation.filled_notional_usd ?? 0)}`,
        `Variance: $${String(reconciliation.variance_usd ?? 0)}`,
        `Outcome: ${reconciliation.matched === true ? 'matched' : 'exception'}`,
        ...(reconciliation.matched === true ? [] : [
          `Residual cancellation: ${state.residual_cancelled === true ? 'completed' : 'not completed'}`,
          `Evidence: ${text(state.cancellation_reference)}`,
        ]),
      ].join('\n'),
    };
  },
};
