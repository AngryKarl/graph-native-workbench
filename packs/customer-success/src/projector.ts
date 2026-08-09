import type { ContextObject, ContextRelation, GraphEvent } from '@graphwork/contracts';
import type { ContextGraphStore, GraphState } from '@graphwork/core';

interface CompletedRun {
  readonly runId: string;
  readonly state: GraphState;
  readonly events?: readonly GraphEvent[];
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function projectCustomerSuccessRun(store: ContextGraphStore, run: CompletedRun): Promise<void> {
  if (run.state.approved !== true || typeof run.state.deliverable !== 'string') {
    throw new Error('Only an approved renewal run with a deliverable can be confirmed.');
  }
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const provenance = (nodeId: string, sourceIds: string[] = [], actorId = 'system.runtime') => ({
    sourceIds, producedByRunId: run.runId, producedByNodeId: nodeId, actorId, recordedAt,
  });
  const signalValues = list<{ kind: string; value: string; trend: string; source: string }>(run.state.health_signals);
  const actionValues = list<{ owner: string; action: string; due_in_days: number; success_measure: string }>(run.state.intervention_plan);
  const accountId = `${base}.account`;
  const riskId = `${base}.risk`;
  const decisionId = `${base}.decision`;
  const planId = `${base}.plan`;
  const signalIds = signalValues.map((_, index) => `${base}.signal.${index + 1}`);
  const actionIds = actionValues.map((_, index) => `${base}.intervention.${index + 1}`);
  const objects: ContextObject[] = [
    { id: accountId, type: 'account_profile', version: 1, status: 'confirmed', data: {
      name: run.state.account_name, segment: run.state.segment, renewal_date: run.state.renewal_date, arr_usd: run.state.arr_usd,
    }, validFrom: recordedAt, validTo: null, provenance: provenance('normalize_account') },
    ...signalValues.map((signal, index): ContextObject => ({ id: signalIds[index]!, type: 'health_signal', version: 1, status: 'confirmed', data: signal, validFrom: recordedAt, validTo: null, provenance: provenance('product_health') })),
    { id: riskId, type: 'renewal_risk', version: 1, status: 'confirmed', data: run.state.renewal_risk as Record<string, unknown>, validFrom: recordedAt, validTo: null, provenance: provenance('assess_risk', signalIds) },
    ...actionValues.map((action, index): ContextObject => ({ id: actionIds[index]!, type: 'intervention', version: 1, status: 'confirmed', data: action, validFrom: recordedAt, validTo: null, provenance: provenance('build_plan', [riskId], 'role.customer_success_manager') })),
    { id: decisionId, type: 'decision', version: 1, status: 'confirmed', data: { approved: true, rationale: run.state.review_status }, validFrom: recordedAt, validTo: null, provenance: provenance('approval', [riskId, ...actionIds], 'role.revenue_owner') },
    { id: planId, type: 'success_plan', version: 1, status: 'confirmed', data: { title: `Renewal success plan — ${String(run.state.account_name)}`, content: run.state.deliverable }, validFrom: recordedAt, validTo: null, provenance: provenance('publish', [riskId, decisionId, ...actionIds]) },
  ];
  for (const object of objects) await store.appendObject(object);
  let index = 0;
  const relation = (type: ContextRelation['type'], sourceId: string, targetId: string, nodeId: string): ContextRelation => ({
    id: `${base}.relation.${++index}`, type, sourceId, targetId, version: 1, attributes: {}, validFrom: recordedAt, validTo: null, provenance: provenance(nodeId, [sourceId, targetId]),
  });
  const relations = [
    ...signalIds.map((id) => relation('signal_about', id, accountId, 'product_health')),
    ...signalIds.map((id) => relation('risk_supported_by', riskId, id, 'assess_risk')),
    ...actionIds.map((id) => relation('intervention_addresses', id, riskId, 'build_plan')),
    relation('decision_governs', decisionId, planId, 'approval'),
    ...actionIds.map((id) => relation('plan_includes', planId, id, 'publish')),
  ];
  for (const item of relations) await store.appendRelation(item);
}
