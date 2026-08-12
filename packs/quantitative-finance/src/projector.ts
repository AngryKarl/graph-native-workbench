import type { ContextObject, ContextRelation, GraphEvent } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface CompletedFinanceRun {
  readonly runId: string;
  readonly state: GraphState;
  readonly events?: readonly GraphEvent[];
}

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function number(value: unknown): number { return typeof value === 'number' ? value : 0; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function items<T = unknown>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

export async function projectQuantitativeFinanceRun(store: ContextGraphStore, run: CompletedFinanceRun): Promise<void> {
  if (typeof run.state.strategy_execution_record === 'string') return projectStrategy(store, run);
  if (typeof run.state.reconciliation_record === 'string') return projectReconciliation(store, run);
  throw new Error('Quantitative Finance context requires a strategy governance or reconciliation record.');
}

function provenance(run: CompletedFinanceRun, nodeId: string, recordedAt: string, actorId = 'system.runtime') {
  return { sourceIds: [], producedByRunId: run.runId, producedByNodeId: nodeId, actorId, recordedAt };
}

function relation(id: string, type: string, sourceId: string, targetId: string, recordedAt: string, source: ReturnType<typeof provenance>): ContextRelation {
  return { id, type, sourceId, targetId, version: 1, attributes: {}, validFrom: recordedAt, validTo: null, provenance: source };
}

async function append(store: ContextGraphStore, objects: ContextObject[], relations: ContextRelation[]) {
  for (const value of objects) await store.appendObject(value);
  for (const value of relations) await store.appendRelation(value);
}

async function projectStrategy(store: ContextGraphStore, run: CompletedFinanceRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const hypothesis = object(run.state.hypothesis);
  const risk = object(run.state.risk_assessment);
  const intent = object(run.state.order_intent);
  const execution = object(run.state.execution_request);
  const evidence = items<Record<string, unknown>>(run.state.backtest_results);
  const ids = { mandate: `${base}.mandate`, hypothesis: `${base}.hypothesis`, portfolio: `${base}.portfolio`, risk: `${base}.risk`, intent: `${base}.intent`, execution: `${base}.execution`, record: `${base}.record` };
  const objects: ContextObject[] = [
    { id: ids.mandate, type: 'strategy_mandate', version: 1, status: 'confirmed', data: { strategy_id: text(run.state.strategy_id), objective: text(run.state.objective), benchmark: text(run.state.benchmark), as_of: text(run.state.as_of) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'normalize_mandate', recordedAt) },
    { id: ids.hypothesis, type: 'research_hypothesis', version: 1, status: 'confirmed', data: { statement: text(hypothesis.statement), signal_family: text(hypothesis.signal_family), falsification: text(hypothesis.falsification) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'formulate_hypothesis', recordedAt, 'role.quant_researcher') },
    ...evidence.map((item, index): ContextObject => ({ id: `${base}.backtest.${index + 1}`, type: 'backtest_evidence', version: 1, status: 'confirmed', data: { instrument: text(item.instrument), sharpe: number(item.sharpe), max_drawdown: number(item.max_drawdown), evidence_uri: text(item.evidence_uri) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'run_backtests', recordedAt, 'role.quant_researcher') })),
    { id: ids.portfolio, type: 'portfolio_proposal', version: 1, status: 'confirmed', data: { strategy_id: text(run.state.strategy_id), targets: items(run.state.target_portfolio) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'construct_portfolio', recordedAt, 'role.portfolio_manager') },
    { id: ids.risk, type: 'risk_assessment', version: 1, status: 'confirmed', data: { passed: risk.passed === true, stress_loss_99: number(risk.stress_loss_99), model_risk: text(risk.model_risk) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'assess_risk', recordedAt, 'role.risk_manager') },
    ...['risk', 'compliance', 'execution'].map((gate): ContextObject => ({ id: `${base}.approval.${gate}`, type: 'approval_decision', version: 1, status: 'confirmed', data: { gate, approved: run.state[`${gate}_approved`] === true }, validFrom: recordedAt, validTo: null, provenance: provenance(run, `${gate}_approval`, recordedAt, `role.${gate === 'execution' ? 'execution_trader' : `${gate}_${gate === 'risk' ? 'manager' : 'officer'}`}`) })),
    { id: ids.intent, type: 'order_intent', version: 1, status: 'confirmed', data: { strategy_id: text(intent.strategy_id), account_id: text(intent.account_id), orders: items(intent.orders) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'prepare_order_intent', recordedAt, 'role.execution_trader') },
    { id: ids.execution, type: 'execution', version: 1, status: 'confirmed', data: { execution_id: text(execution.request_id), account_id: text(run.state.account_id), status: text(execution.status) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'submit_orders', recordedAt, 'role.execution_trader') },
    { id: ids.record, type: 'finance_record', version: 1, status: 'confirmed', data: { record_type: 'strategy_governance', content: run.state.strategy_execution_record }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'publish_strategy', recordedAt) },
  ];
  const relations: ContextRelation[] = [
    relation(`${base}.rel.mandate.hypothesis`, 'governs_strategy', ids.mandate, ids.hypothesis, recordedAt, provenance(run, 'formulate_hypothesis', recordedAt)),
    ...evidence.flatMap((_, index) => [
      relation(`${base}.rel.backtest.${index + 1}.hypothesis`, 'tests_hypothesis', `${base}.backtest.${index + 1}`, ids.hypothesis, recordedAt, provenance(run, 'aggregate_research', recordedAt)),
      relation(`${base}.rel.backtest.${index + 1}.portfolio`, 'supports_portfolio', `${base}.backtest.${index + 1}`, ids.portfolio, recordedAt, provenance(run, 'construct_portfolio', recordedAt)),
    ]),
    relation(`${base}.rel.risk.portfolio`, 'evaluates_portfolio', ids.risk, ids.portfolio, recordedAt, provenance(run, 'assess_risk', recordedAt)),
    ...['risk', 'compliance', 'execution'].map((gate) => relation(`${base}.rel.approval.${gate}.intent`, 'authorizes_intent', `${base}.approval.${gate}`, ids.intent, recordedAt, provenance(run, `${gate}_approval`, recordedAt))),
    relation(`${base}.rel.intent.portfolio`, 'implements_portfolio', ids.intent, ids.portfolio, recordedAt, provenance(run, 'prepare_order_intent', recordedAt)),
    relation(`${base}.rel.intent.execution`, 'submitted_as', ids.intent, ids.execution, recordedAt, provenance(run, 'submit_orders', recordedAt)),
    relation(`${base}.rel.record.mandate`, 'documents_finance_work', ids.record, ids.mandate, recordedAt, provenance(run, 'publish_strategy', recordedAt)),
  ];
  await append(store, objects, relations);
}

async function projectReconciliation(store: ContextGraphStore, run: CompletedFinanceRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const reconciliation = object(run.state.reconciliation);
  const fills = items<Record<string, unknown>>(run.state.fills);
  const executionId = `${base}.execution`;
  const reconciliationId = `${base}.reconciliation`;
  const recordId = `${base}.record`;
  const objects: ContextObject[] = [
    { id: executionId, type: 'execution', version: 1, status: 'confirmed', data: { execution_id: text(run.state.execution_id), account_id: text(run.state.account_id), status: reconciliation.matched === true ? 'reconciled' : 'exception' }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'normalize_execution', recordedAt) },
    ...fills.map((fill, index): ContextObject => ({ id: `${base}.fill.${index + 1}`, type: 'fill', version: 1, status: 'confirmed', data: { instrument: text(fill.instrument), notional_usd: number(fill.notional_usd), status: text(fill.status) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'normalize_execution', recordedAt) })),
    { id: reconciliationId, type: 'reconciliation', version: 1, status: 'confirmed', data: { matched: reconciliation.matched === true, variance_usd: number(reconciliation.variance_usd) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'reconcile', recordedAt, 'role.operations_analyst') },
    ...(reconciliation.matched === true ? [] : [{ id: `${base}.exception`, type: 'execution_exception', version: 1, status: 'confirmed', data: { execution_id: text(run.state.execution_id), residual_cancelled: run.state.residual_cancelled === true, evidence_uri: text(run.state.cancellation_reference) }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'cancel_residual', recordedAt, 'role.operations_analyst') } satisfies ContextObject]),
    { id: recordId, type: 'finance_record', version: 1, status: 'confirmed', data: { record_type: 'execution_reconciliation', content: run.state.reconciliation_record }, validFrom: recordedAt, validTo: null, provenance: provenance(run, 'publish_reconciliation', recordedAt) },
  ];
  const relations: ContextRelation[] = [
    ...fills.map((_, index) => relation(`${base}.rel.fill.${index + 1}.execution`, 'fills_execution', `${base}.fill.${index + 1}`, executionId, recordedAt, provenance(run, 'normalize_execution', recordedAt))),
    relation(`${base}.rel.reconciliation.execution`, 'reconciles_execution', reconciliationId, executionId, recordedAt, provenance(run, 'reconcile', recordedAt)),
    ...(reconciliation.matched === true ? [] : [relation(`${base}.rel.reconciliation.exception`, 'raises_exception', reconciliationId, `${base}.exception`, recordedAt, provenance(run, 'escalate_exception', recordedAt))]),
    relation(`${base}.rel.record.reconciliation`, 'documents_finance_work', recordId, reconciliationId, recordedAt, provenance(run, 'publish_reconciliation', recordedAt)),
  ];
  await append(store, objects, relations);
}
