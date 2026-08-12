import { describe, expect, it } from 'vitest';
import {
  projectQuantitativeFinanceRun,
  quantitativeFinanceHandlers,
  quantitativeFinancePack,
  quantitativeFinanceTools,
} from '@graph-workbench/pack-quantitative-finance';
import {
  compilePack,
  GraphRuntime,
  GraphTriggerDispatcher,
  InMemoryContextGraphStore,
} from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';

describe('Quantitative Finance Governance Pack', () => {
  it('compiles research, simulation and reconciliation graphs with typed boundaries', () => {
    const compiled = compilePack(quantitativeFinancePack);
    expect([...compiled.graphs.keys()]).toEqual([
      'quantitative_finance.strategy_governance',
      'quantitative_finance.backtest_instrument',
      'quantitative_finance.execution_reconciliation',
    ]);
    expect(compiled.manifest.tools).toHaveLength(6);
    expect(compiled.manifest.deliverables.map((item) => item.id)).toEqual([
      'strategy_execution_record', 'reconciliation_record',
    ]);
  });

  it('passes release, rejection, matched-fill and exception fixtures without keys', async () => {
    const results = await runAllPackFixtures(quantitativeFinancePack, quantitativeFinanceHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('pauses at three accountable gates before submitting order intent', async () => {
    const fixture = quantitativeFinancePack.fixtures.find((item) => item.id === 'market_neutral_research')!;
    const graph = compilePack(quantitativeFinancePack).graphs.get(fixture.graphId)!;
    const runtime = new GraphRuntime(graph, { pack: quantitativeFinancePack, handlers: quantitativeFinanceHandlers });
    const risk = await runtime.run(fixture.input, { runId: 'run-finance-risk' });
    expect(risk).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['risk_approval'] } });
    expect(risk.state.order_intent).toBeUndefined();

    const compliance = await runtime.run(fixture.input, { runId: 'run-finance-compliance', decisions: { risk_approval: true } });
    expect(compliance).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['compliance_approval'] } });

    const execution = await runtime.run(fixture.input, { runId: 'run-finance-execution', decisions: { risk_approval: true, compliance_approval: true } });
    expect(execution).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['execution_approval'] } });
    expect(execution.state.execution_request).toBeUndefined();
  });

  it('dispatches fill events and records escalation plus residual cancellation', async () => {
    const fixture = quantitativeFinancePack.fixtures.find((item) => item.id === 'fill_mismatch_exception')!;
    const dispatcher = new GraphTriggerDispatcher(compilePack(quantitativeFinancePack), { handlers: quantitativeFinanceHandlers });
    const [triggered] = await dispatcher.dispatchEvent({
      id: 'fill-event-1002', type: 'execution.fills_received', correlationKey: 'exec-1002',
      payload: { ...fixture.input, execution_id: undefined }, occurredAt: '2026-08-11T20:05:00.000Z',
    });
    expect(triggered?.result).toMatchObject({
      status: 'completed', state: { execution_id: 'exec-1002', reconciliation_matched: false, residual_cancelled: true },
    });
    expect(triggered?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'trigger.accepted', 'escalation.raised', 'compensation.completed',
    ]));
  });

  it('projects governed strategy and execution exceptions into connected context', async () => {
    const compiled = compilePack(quantitativeFinancePack);
    const strategyFixture = quantitativeFinancePack.fixtures.find((item) => item.id === 'market_neutral_research')!;
    const strategy = await new GraphRuntime(compiled.graphs.get(strategyFixture.graphId)!, {
      pack: quantitativeFinancePack, handlers: quantitativeFinanceHandlers,
    }).run(strategyFixture.input, { runId: 'run-finance-context', decisions: strategyFixture.decisions });
    const strategyStore = new InMemoryContextGraphStore(quantitativeFinancePack);
    await projectQuantitativeFinanceRun(strategyStore, strategy);
    expect((await strategyStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'strategy_mandate', 'research_hypothesis', 'backtest_evidence', 'portfolio_proposal',
      'risk_assessment', 'approval_decision', 'order_intent', 'execution', 'finance_record',
    ]));
    expect((await strategyStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'governs_strategy', 'tests_hypothesis', 'supports_portfolio', 'evaluates_portfolio',
      'authorizes_intent', 'implements_portfolio', 'submitted_as', 'documents_finance_work',
    ]));

    const exceptionFixture = quantitativeFinancePack.fixtures.find((item) => item.id === 'fill_mismatch_exception')!;
    const exception = await new GraphRuntime(compiled.graphs.get(exceptionFixture.graphId)!, {
      pack: quantitativeFinancePack, handlers: quantitativeFinanceHandlers,
    }).run(exceptionFixture.input, { runId: 'run-finance-exception-context' });
    const exceptionStore = new InMemoryContextGraphStore(quantitativeFinancePack);
    await projectQuantitativeFinanceRun(exceptionStore, exception);
    expect((await exceptionStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'execution', 'fill', 'reconciliation', 'execution_exception', 'finance_record',
    ]));
    expect((await exceptionStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining([
      'fills_execution', 'reconciles_execution', 'raises_exception', 'documents_finance_work',
    ]));
  });

  it('ships deterministic typed reference connectors', async () => {
    expect(await quantitativeFinanceTools.order_submit!.execute({
      idempotency_key: 'run-1:submit', account_id: 'paper.us-equities', orders: [],
    }, { nodeId: 'test', runId: 'run-test', secrets: {}, signal: new AbortController().signal })).toEqual({
      execution_id: 'execution-run-1-submit', status: 'accepted',
    });
  });
});
