import type { HandlerRegistry } from '@graph-workbench/core';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = <T = unknown>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export const roboticsFleetHandlers: HandlerRegistry = {
  'robotics_fleet.normalize_task': ({ state }) => ({
    task_request: { task_id: text(state.task_id), task_type: text(state.task_type), pickup: object(state.pickup), dropoff: object(state.dropoff), payload: object(state.payload), priority: text(state.priority), requested_at: text(state.requested_at) },
  }),
  'robotics_fleet.prepare_bids': ({ state }) => {
    const fleet = items<Record<string, unknown>>(state.fleet_snapshot);
    if (fleet.length === 0) throw new Error('Task allocation requires at least one available fleet candidate.');
    return { bid_requests: fleet.map((robot) => ({ task_id: text(state.task_id), robot, pickup: object(state.pickup), dropoff: object(state.dropoff), payload: object(state.payload) })) };
  },
  'robotics_fleet.calculate_bid': ({ state }) => {
    const request = object(state.bid_request); const robot = object(request.robot);
    const battery = number(robot.battery_percent); const capacity = number(robot.payload_capacity_kg);
    const payload = number(object(request.payload).weight_kg);
    const eligible = text(robot.status) === 'available' && battery >= 30 && capacity >= payload;
    return { result: { robot_id: text(robot.robot_id), fleet_id: text(robot.fleet_id), eligible, battery_percent: battery, eta_seconds: eligible ? Math.max(30, 300 - battery * 2) : 9999, score: eligible ? battery - payload : -1, reason: eligible ? 'available within battery and payload constraints' : 'fails availability, battery or payload constraint' } };
  },
  'robotics_fleet.select_bid': ({ state }) => {
    const eligible = items<Record<string, unknown>>(state.bid_results).filter((bid) => bid.eligible === true).sort((a, b) => number(b.score) - number(a.score));
    if (!eligible[0]) throw new Error('No robot satisfies the declared allocation constraints.');
    return { selected_bid: eligible[0], allocation_plan: { task_id: text(state.task_id), selected_robot_id: text(eligible[0].robot_id), selected_fleet_id: text(eligible[0].fleet_id), eta_seconds: number(eligible[0].eta_seconds), alternatives_considered: items(state.bid_results).length } };
  },
  'robotics_fleet.plan_mission': ({ state }) => ({
    mission_plan: { task_id: text(state.task_id), robot_id: text(object(state.selected_bid).robot_id), route: [object(state.pickup), object(state.dropoff)], reservations: items(state.required_resources), safety_constraints: items(state.safety_constraints), recovery: 'stop-safe and request reassignment' },
  }),
  'robotics_fleet.reserve_resources': ({ state }) => ({
    resource_reservation: { reservation_id: `reservation-${text(state.task_id)}`, resources: items(state.required_resources), status: 'reserved', authority: 'reference-openrmf-adapter' },
  }),
  'robotics_fleet.dispatch_mission': ({ state, runId }) => ({
    dispatch_receipt: { dispatch_id: `dispatch-${runId}`, task_id: text(state.task_id), robot_id: text(object(state.selected_bid).robot_id), status: 'accepted', idempotency_key: `${runId}:dispatch` },
  }),
  'robotics_fleet.publish_dispatch': ({ state }) => ({
    dispatch_record: [
      `# Governed fleet dispatch — ${text(state.task_id)}`, '',
      `Robot: ${text(object(state.selected_bid).robot_id)}`,
      `Fleet: ${text(object(state.selected_bid).fleet_id)}`,
      `Reservation: ${text(object(state.resource_reservation).reservation_id)}`,
      `Dispatch: ${text(object(state.dispatch_receipt).dispatch_id)} (${text(object(state.dispatch_receipt).status)})`,
      'Safety and resource approval: approved',
      'Real-time motion, obstacle avoidance and emergency stop remain device-side authorities.',
    ].join('\n'),
  }),
  'robotics_fleet.record_rejection': () => ({ rejection_reason: 'Fleet supervisor rejected resource or safety authorization.' }),
  'robotics_fleet.assess_telemetry': ({ state }) => {
    const signals = items<Record<string, unknown>>(state.telemetry_signals);
    const healthy = signals.length > 0 && signals.every((signal) => ['healthy', 'ok', 'normal'].includes(text(signal.status)));
    return { mission_healthy: healthy, mission_complete: state.task_status === 'completed', telemetry_assessment: { task_id: text(state.task_id), robot_id: text(state.robot_id), healthy, mission_complete: state.task_status === 'completed', signals } };
  },
  'robotics_fleet.advance_replan': ({ state }) => {
    const attempt = number(state.replan_attempt) + 1;
    return { replan_attempt: attempt, continue_replan: attempt < 2, replanned_route: { attempt, route_ref: `reference://fleet/replan/${encodeURIComponent(text(state.task_id))}/${attempt}`, status: 'planned' } };
  },
  'robotics_fleet.request_replan': ({ state }) => ({
    replan_request: { task_id: text(state.task_id), robot_id: text(state.robot_id), attempt: number(state.replan_attempt), route: object(state.replanned_route), status: 'accepted' },
  }),
  'robotics_fleet.create_maintenance': ({ state }) => ({
    maintenance_created: true,
    maintenance_reference: `reference://maintenance/${encodeURIComponent(text(state.robot_id))}/${encodeURIComponent(text(state.task_id))}`,
  }),
  'robotics_fleet.publish_observation': ({ state }) => ({
    mission_observation_record: [
      `# Fleet mission observation — ${text(state.task_id)}`, '',
      `Robot: ${text(state.robot_id)}`,
      `Mission status: ${text(state.task_status)}`,
      `Telemetry health: ${state.mission_healthy === true ? 'healthy' : 'degraded'}`,
      `Mission complete: ${String(state.mission_complete === true)}`,
      ...(state.mission_healthy === true ? [] : [`Replan attempts: ${String(state.replan_attempt ?? 0)}`, `Maintenance: ${text(state.maintenance_reference)}`]),
    ].join('\n'),
  }),
  'robotics_fleet.initialize_replan': () => ({ replan_attempt: 0, continue_replan: true }),
};
