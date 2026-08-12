import type { ContextObject, ContextRelation, GraphEvent } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface Run { readonly runId: string; readonly state: GraphState; readonly events?: readonly GraphEvent[] }
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' ? value : 0;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = <T = unknown>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const provenance = (run: Run, nodeId: string, at: string, actorId = 'system.runtime') => ({ sourceIds: [], producedByRunId: run.runId, producedByNodeId: nodeId, actorId, recordedAt: at });
const relation = (id: string, type: string, sourceId: string, targetId: string, at: string, source: ReturnType<typeof provenance>): ContextRelation => ({ id, type, sourceId, targetId, version: 1, attributes: {}, validFrom: at, validTo: null, provenance: source });

export async function projectRoboticsFleetRun(store: ContextGraphStore, run: Run): Promise<void> {
  if (typeof run.state.dispatch_record === 'string') return projectDispatch(store, run);
  if (typeof run.state.mission_observation_record === 'string') return projectObservation(store, run);
  throw new Error('Robotics Fleet context requires a completed dispatch or mission observation record.');
}

async function append(store: ContextGraphStore, objects: ContextObject[], relations: ContextRelation[]) {
  for (const value of objects) await store.appendObject(value);
  for (const value of relations) await store.appendRelation(value);
}

async function projectDispatch(store: ContextGraphStore, run: Run) {
  const at = new Date().toISOString(); const base = run.runId;
  const bids = items<Record<string, unknown>>(run.state.bid_results); const selected = object(run.state.selected_bid);
  const plan = object(run.state.mission_plan); const reservation = object(run.state.resource_reservation); const dispatch = object(run.state.dispatch_receipt);
  const ids = { task: `${base}.task`, robot: `${base}.robot`, mission: `${base}.mission`, reservation: `${base}.reservation`, decision: `${base}.decision`, dispatch: `${base}.dispatch`, record: `${base}.record` };
  const objects: ContextObject[] = [
    { id: ids.task, type: 'fleet_task', version: 1, status: 'confirmed', data: { task_id: text(run.state.task_id), task_type: text(run.state.task_type), priority: text(run.state.priority) }, validFrom: at, validTo: null, provenance: provenance(run, 'normalize_task', at) },
    { id: ids.robot, type: 'robot', version: 1, status: 'confirmed', data: { robot_id: text(selected.robot_id), fleet_id: text(selected.fleet_id), status: 'allocated' }, validFrom: at, validTo: null, provenance: provenance(run, 'select_bid', at) },
    ...bids.map((bid, index): ContextObject => ({ id: `${base}.bid.${index + 1}`, type: 'bid', version: 1, status: 'confirmed', data: { robot_id: text(bid.robot_id), eligible: bid.eligible === true, score: number(bid.score) }, validFrom: at, validTo: null, provenance: provenance(run, 'calculate_bids', at) })),
    { id: ids.mission, type: 'mission_plan', version: 1, status: 'confirmed', data: { task_id: text(plan.task_id), robot_id: text(plan.robot_id), recovery: text(plan.recovery) }, validFrom: at, validTo: null, provenance: provenance(run, 'plan_mission', at, 'role.fleet_planner') },
    { id: ids.reservation, type: 'resource_reservation', version: 1, status: 'confirmed', data: { reservation_id: text(reservation.reservation_id), status: text(reservation.status) }, validFrom: at, validTo: null, provenance: provenance(run, 'reserve_resources', at, 'role.resource_manager') },
    { id: ids.decision, type: 'safety_decision', version: 1, status: 'confirmed', data: { approved: true, gate: 'dispatch_safety' }, validFrom: at, validTo: null, provenance: provenance(run, 'safety_approval', at, 'role.safety_supervisor') },
    { id: ids.dispatch, type: 'dispatch', version: 1, status: 'confirmed', data: { dispatch_id: text(dispatch.dispatch_id), task_id: text(dispatch.task_id), status: text(dispatch.status) }, validFrom: at, validTo: null, provenance: provenance(run, 'dispatch_mission', at, 'role.fleet_operator') },
    { id: ids.record, type: 'fleet_record', version: 1, status: 'confirmed', data: { record_type: 'dispatch', content: run.state.dispatch_record }, validFrom: at, validTo: null, provenance: provenance(run, 'publish_dispatch', at) },
  ];
  const relations: ContextRelation[] = [
    ...bids.flatMap((_, index) => [relation(`${base}.rel.bid.${index + 1}.task`, 'bids_for_task', `${base}.bid.${index + 1}`, ids.task, at, provenance(run, 'calculate_bids', at)), relation(`${base}.rel.bid.${index + 1}.robot`, 'offered_by', `${base}.bid.${index + 1}`, ids.robot, at, provenance(run, 'calculate_bids', at))]),
    relation(`${base}.rel.mission.robot`, 'allocates_robot', ids.mission, ids.robot, at, provenance(run, 'select_bid', at)), relation(`${base}.rel.mission.task`, 'plans_task', ids.mission, ids.task, at, provenance(run, 'plan_mission', at)),
    relation(`${base}.rel.reservation.mission`, 'reserves_for_mission', ids.reservation, ids.mission, at, provenance(run, 'reserve_resources', at)), relation(`${base}.rel.decision.dispatch`, 'authorizes_dispatch', ids.decision, ids.dispatch, at, provenance(run, 'safety_approval', at)),
    relation(`${base}.rel.dispatch.mission`, 'dispatches_mission', ids.dispatch, ids.mission, at, provenance(run, 'dispatch_mission', at)), relation(`${base}.rel.record.dispatch`, 'documents_fleet_work', ids.record, ids.dispatch, at, provenance(run, 'publish_dispatch', at)),
  ];
  await append(store, objects, relations);
}

async function projectObservation(store: ContextGraphStore, run: Run) {
  const at = new Date().toISOString(); const base = run.runId;
  const replan = object(run.state.replan_request); const healthy = run.state.mission_healthy === true;
  const ids = { task: `${base}.task`, robot: `${base}.robot`, observation: `${base}.observation`, record: `${base}.record` };
  const objects: ContextObject[] = [
    { id: ids.task, type: 'fleet_task', version: 1, status: 'confirmed', data: { task_id: text(run.state.task_id), task_type: 'observed_mission', priority: 'operational' }, validFrom: at, validTo: null, provenance: provenance(run, 'assess_telemetry', at) },
    { id: ids.robot, type: 'robot', version: 1, status: 'confirmed', data: { robot_id: text(run.state.robot_id), fleet_id: 'observed-fleet', status: healthy ? 'healthy' : 'maintenance-required' }, validFrom: at, validTo: null, provenance: provenance(run, 'assess_telemetry', at) },
    { id: ids.observation, type: 'telemetry_observation', version: 1, status: 'confirmed', data: { task_id: text(run.state.task_id), robot_id: text(run.state.robot_id), healthy }, validFrom: at, validTo: null, provenance: provenance(run, 'assess_telemetry', at, 'role.fleet_operator') },
    ...(!healthy ? [{ id: `${base}.replan`, type: 'replan', version: 1, status: 'confirmed', data: { task_id: text(run.state.task_id), attempt: number(run.state.replan_attempt), status: text(replan.status) }, validFrom: at, validTo: null, provenance: provenance(run, 'request_replan', at, 'role.fleet_planner') }, { id: `${base}.maintenance`, type: 'maintenance_action', version: 1, status: 'confirmed', data: { robot_id: text(run.state.robot_id), reference: text(run.state.maintenance_reference), status: 'open' }, validFrom: at, validTo: null, provenance: provenance(run, 'create_maintenance', at, 'role.maintenance_coordinator') }] as ContextObject[] : []),
    { id: ids.record, type: 'fleet_record', version: 1, status: 'confirmed', data: { record_type: 'mission_observation', content: run.state.mission_observation_record }, validFrom: at, validTo: null, provenance: provenance(run, 'publish_observation', at) },
  ];
  const relations: ContextRelation[] = [
    relation(`${base}.rel.observation.robot`, 'observes_robot', ids.observation, ids.robot, at, provenance(run, 'assess_telemetry', at)),
    ...(!healthy ? [relation(`${base}.rel.replan.task`, 'replans_task', `${base}.replan`, ids.task, at, provenance(run, 'request_replan', at)), relation(`${base}.rel.maintenance.robot`, 'maintains_robot', `${base}.maintenance`, ids.robot, at, provenance(run, 'create_maintenance', at))] : []),
    relation(`${base}.rel.record.observation`, 'documents_fleet_work', ids.record, ids.observation, at, provenance(run, 'publish_observation', at)),
  ];
  await append(store, objects, relations);
}
