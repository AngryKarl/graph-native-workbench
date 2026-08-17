import type { GraphDefinition, IndustryPackManifest } from '@graph-workbench/contracts';

const budget = { maxSteps: 80, maxDurationMs: 60_000, maxConcurrency: 8 };

const dispatchGraph: GraphDefinition = {
  id: 'robotics_fleet.task_dispatch', version: 1, name: 'Fleet task allocation and dispatch',
  description: 'Accepts a task, runs parallel robot bids, plans resources, requests safety approval and dispatches through an external fleet authority.',
  trigger: { type: 'event', eventType: 'fleet.task_requested', correlationField: 'task_id' },
  state: { fields: {
    task_id: { type: 'string', required: true, description: 'Task identifier.' }, task_type: { type: 'string', required: true, description: 'Task type.' },
    pickup: { type: 'object', required: true, description: 'Pickup waypoint.' }, dropoff: { type: 'object', required: true, description: 'Drop-off waypoint.' },
    payload: { type: 'object', required: true, description: 'Payload constraints.' }, priority: { type: 'string', required: true, description: 'Task priority.' },
    requested_at: { type: 'string', required: true, description: 'Request timestamp.' }, fleet_snapshot: { type: 'array', required: true, description: 'External fleet snapshot.' },
    required_resources: { type: 'array', required: true, description: 'Resource reservations.' }, safety_constraints: { type: 'array', required: true, description: 'Safety policy constraints.' },
    task_request: { type: 'object', required: false, description: 'Normalized task.' }, bid_requests: { type: 'array', required: false, description: 'Per-robot bid requests.' },
    bid_results: { type: 'array', required: false, description: 'Bid evidence.' }, selected_bid: { type: 'object', required: false, description: 'Selected robot bid.' },
    allocation_plan: { type: 'object', required: false, description: 'Allocation decision.' }, mission_plan: { type: 'object', required: false, description: 'Route, resources and recovery plan.' },
    resource_reservation: { type: 'object', required: false, description: 'Resource reservation receipt.' }, safety_approved: { type: 'boolean', required: false, description: 'Supervisor decision.' },
    dispatch_receipt: { type: 'object', required: false, description: 'External dispatch receipt.' }, dispatch_record: { type: 'string', required: false, description: 'Governed dispatch record.' },
    rejection_reason: { type: 'string', required: false, description: 'Stopped task reason.' },
  } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Task request', description: 'Accept an event-correlated fleet task.', reads: ['task_id', 'task_type', 'pickup', 'dropoff', 'payload', 'priority', 'requested_at', 'fleet_snapshot', 'required_resources', 'safety_constraints'], writes: [], config: {} },
    { id: 'normalize_task', kind: 'function', label: 'Normalize task', description: 'Create a stable task and payload boundary.', handler: 'robotics_fleet.normalize_task', reads: ['task_id', 'task_type', 'pickup', 'dropoff', 'payload', 'priority', 'requested_at'], writes: ['task_request'], config: { roleId: 'fleet_operator' } },
    { id: 'prepare_bids', kind: 'function', label: 'Prepare robot bids', description: 'Fan allocation out across the current fleet snapshot.', handler: 'robotics_fleet.prepare_bids', reads: ['task_id', 'pickup', 'dropoff', 'payload', 'fleet_snapshot'], writes: ['bid_requests'], config: { roleId: 'fleet_planner', toolIds: ['fleet_state_read'] } },
    { id: 'calculate_bids', kind: 'map', label: 'Calculate bids', description: 'Evaluate robot eligibility and ETA concurrently.', reads: ['bid_requests'], writes: ['bid_results'], config: { graphId: 'robotics_fleet.calculate_bid', itemsField: 'bid_requests', itemField: 'bid_request', resultField: 'result', outputField: 'bid_results', inputMapping: {}, maxItems: 500, maxConcurrency: 16 } },
    { id: 'select_bid', kind: 'agent', label: 'Select allocation', description: 'Choose the highest eligible bid with explainable constraints.', handler: 'robotics_fleet.select_bid', reads: ['task_request', 'bid_results'], writes: ['selected_bid', 'allocation_plan'], config: { roleId: 'fleet_planner' } },
    { id: 'plan_mission', kind: 'agent', label: 'Plan mission envelope', description: 'Plan waypoints, reservations, safety constraints and recovery.', handler: 'robotics_fleet.plan_mission', reads: ['task_id', 'pickup', 'dropoff', 'selected_bid', 'required_resources', 'safety_constraints'], writes: ['mission_plan'], config: { roleId: 'fleet_planner' } },
    { id: 'reserve_resources', kind: 'function', label: 'Reserve shared resources', description: 'Request OpenRMF-style doors, lifts or zones.', handler: 'robotics_fleet.reserve_resources', reads: ['task_id', 'required_resources', 'mission_plan'], writes: ['resource_reservation'], config: { roleId: 'resource_manager', toolIds: ['resource_reserve'] } },
    { id: 'safety_approval', kind: 'human', label: 'Approve safety envelope', description: 'Require accountable approval before external dispatch.', reads: ['task_request', 'allocation_plan', 'mission_plan', 'resource_reservation'], writes: ['safety_approved'], config: { decisionField: 'safety_approved', roleId: 'safety_supervisor', evaluationId: 'dispatch_safety' } },
    { id: 'safety_route', kind: 'router', label: 'Route safety decision', description: 'Dispatch only approved work.', reads: ['safety_approved'], writes: [], config: {} },
    { id: 'dispatch_mission', kind: 'function', label: 'Dispatch to fleet authority', description: 'Submit the approved mission through an external adapter.', handler: 'robotics_fleet.dispatch_mission', reads: ['task_id', 'selected_bid', 'mission_plan', 'resource_reservation'], writes: ['dispatch_receipt'], config: { roleId: 'fleet_operator', toolIds: ['mission_dispatch'] } },
    { id: 'publish_dispatch', kind: 'function', label: 'Publish dispatch record', description: 'Preserve allocation, approval and external receipt.', handler: 'robotics_fleet.publish_dispatch', reads: ['task_id', 'selected_bid', 'resource_reservation', 'safety_approved', 'dispatch_receipt'], writes: ['dispatch_record'], config: {} },
    { id: 'record_rejection', kind: 'function', label: 'Record stopped task', description: 'Preserve rejected safety authorization.', handler: 'robotics_fleet.record_rejection', reads: ['safety_approved'], writes: ['rejection_reason'], config: {} },
  ],
  edges: [
    { id: 'start.normalize', source: 'start', target: 'normalize_task', on: 'success' }, { id: 'normalize.prepare', source: 'normalize_task', target: 'prepare_bids', on: 'success' },
    { id: 'prepare.calculate', source: 'prepare_bids', target: 'calculate_bids', on: 'success' }, { id: 'calculate.select', source: 'calculate_bids', target: 'select_bid', on: 'success' },
    { id: 'select.plan', source: 'select_bid', target: 'plan_mission', on: 'success' }, { id: 'plan.reserve', source: 'plan_mission', target: 'reserve_resources', on: 'success' },
    { id: 'reserve.approval', source: 'reserve_resources', target: 'safety_approval', on: 'success' }, { id: 'approval.route', source: 'safety_approval', target: 'safety_route', on: 'success' },
    { id: 'route.dispatch', source: 'safety_route', target: 'dispatch_mission', on: 'success', condition: { field: 'safety_approved', operator: 'equals', value: true } },
    { id: 'route.reject', source: 'safety_route', target: 'record_rejection', on: 'success', condition: { field: 'safety_approved', operator: 'equals', value: false } },
    { id: 'dispatch.publish', source: 'dispatch_mission', target: 'publish_dispatch', on: 'success' },
  ], budget,
};

const bidGraph: GraphDefinition = {
  id: 'robotics_fleet.calculate_bid', version: 1, name: 'Robot bid calculation', description: 'Evaluates one robot against task, battery and payload constraints.',
  state: { fields: { bid_request: { type: 'object', required: true, description: 'Robot bid request.' }, result: { type: 'object', required: false, description: 'Bid result.' } } },
  nodes: [{ id: 'start', kind: 'trigger', label: 'Bid request', description: 'Accept one robot candidate.', reads: ['bid_request'], writes: [], config: {} }, { id: 'calculate', kind: 'function', label: 'Calculate eligibility', description: 'Return deterministic eligibility, ETA and score.', handler: 'robotics_fleet.calculate_bid', reads: ['bid_request'], writes: ['result'], config: { roleId: 'fleet_planner' } }],
  edges: [{ id: 'start.calculate', source: 'start', target: 'calculate', on: 'success' }], budget,
};

const replanGraph: GraphDefinition = {
  id: 'robotics_fleet.replan_step', version: 1, name: 'Bounded mission replanning step', description: 'Produces one traceable replan proposal.',
  state: { fields: { task_id: { type: 'string', required: true, description: 'Task.' }, replan_attempt: { type: 'number', required: true, description: 'Attempt.' }, continue_replan: { type: 'boolean', required: true, description: 'Continue flag.' }, replanned_route: { type: 'object', required: false, description: 'Replanned route.' } } },
  nodes: [{ id: 'start', kind: 'trigger', label: 'Replan state', description: 'Accept bounded replan state.', reads: [], writes: [], config: {} }, { id: 'advance', kind: 'function', label: 'Advance replan', description: 'Produce one external-planner proposal.', handler: 'robotics_fleet.advance_replan', reads: ['task_id', 'replan_attempt'], writes: ['replan_attempt', 'continue_replan', 'replanned_route'], config: { roleId: 'fleet_planner' } }],
  edges: [{ id: 'start.advance', source: 'start', target: 'advance', on: 'success' }], budget,
};

const observationGraph: GraphDefinition = {
  id: 'robotics_fleet.mission_observation', version: 1, name: 'Telemetry observation, replanning and maintenance',
  description: 'Correlates mission telemetry and drives bounded replanning, escalation and maintenance without controlling the robot.',
  trigger: { type: 'event', eventType: 'fleet.telemetry_observed', correlationField: 'task_id' },
  state: { fields: {
    task_id: { type: 'string', required: true, description: 'Task.' }, robot_id: { type: 'string', required: true, description: 'Robot.' }, task_status: { type: 'string', required: true, description: 'Mission status.' },
    telemetry_signals: { type: 'array', required: true, description: 'Telemetry evidence.' }, telemetry_assessment: { type: 'object', required: false, description: 'Health assessment.' },
    mission_healthy: { type: 'boolean', required: false, description: 'Health result.' }, mission_complete: { type: 'boolean', required: false, description: 'Completion result.' },
    replan_attempt: { type: 'number', required: false, description: 'Replan count.' }, continue_replan: { type: 'boolean', required: false, description: 'Loop flag.' },
    replanned_route: { type: 'object', required: false, description: 'Latest route.' }, replan_request: { type: 'object', required: false, description: 'External planner receipt.' },
    maintenance_created: { type: 'boolean', required: false, description: 'Maintenance work status.' }, maintenance_reference: { type: 'string', required: false, description: 'Maintenance evidence.' },
    mission_observation_record: { type: 'string', required: false, description: 'Portable observation record.' },
  } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Telemetry event', description: 'Accept correlated mission telemetry.', reads: ['task_id', 'robot_id', 'task_status', 'telemetry_signals'], writes: [], config: {} },
    { id: 'assess_telemetry', kind: 'function', label: 'Assess mission health', description: 'Interpret task status and telemetry evidence.', handler: 'robotics_fleet.assess_telemetry', reads: ['task_id', 'robot_id', 'task_status', 'telemetry_signals'], writes: ['mission_healthy', 'mission_complete', 'telemetry_assessment'], config: { roleId: 'fleet_operator', toolIds: ['telemetry_read'], evaluationId: 'mission_health' } },
    { id: 'health_route', kind: 'router', label: 'Route mission health', description: 'Separate healthy progress from degraded response.', reads: ['mission_healthy'], writes: [], config: {} },
    { id: 'initialize_replan', kind: 'function', label: 'Initialize bounded replan', description: 'Create explicit loop state.', handler: 'robotics_fleet.initialize_replan', reads: [], writes: ['replan_attempt', 'continue_replan'], config: {} },
    { id: 'replan_loop', kind: 'loop', label: 'Bounded replanning', description: 'Request no more than two traceable route proposals.', reads: ['task_id', 'replan_attempt', 'continue_replan'], writes: ['replan_attempt', 'continue_replan', 'replanned_route'], config: { graphId: 'robotics_fleet.replan_step', inputMapping: { task_id: 'task_id', replan_attempt: 'replan_attempt', continue_replan: 'continue_replan' }, outputMapping: { replan_attempt: 'replan_attempt', continue_replan: 'continue_replan', replanned_route: 'replanned_route' }, conditionField: 'continue_replan', conditionValue: true, maxIterations: 2 } },
    { id: 'request_replan', kind: 'function', label: 'Request external replan', description: 'Submit the chosen route proposal to the fleet authority.', handler: 'robotics_fleet.request_replan', reads: ['task_id', 'robot_id', 'replan_attempt', 'replanned_route'], writes: ['replan_request'], config: { roleId: 'fleet_planner', toolIds: ['mission_replan'] } },
    { id: 'escalate_fault', kind: 'escalation', label: 'Escalate degraded mission', description: 'Raise accountable operator and safety response.', reads: ['task_id', 'robot_id', 'telemetry_assessment'], writes: [], config: { reason: 'Mission telemetry is degraded; external safe-state and operator response are required.', severity: 'critical', roleId: 'safety_supervisor' } },
    { id: 'create_maintenance', kind: 'function', label: 'Create maintenance work', description: 'Open a maintenance record without commanding the robot.', handler: 'robotics_fleet.create_maintenance', reads: ['task_id', 'robot_id', 'telemetry_assessment'], writes: ['maintenance_created', 'maintenance_reference'], config: { roleId: 'maintenance_coordinator', toolIds: ['maintenance_create'] } },
    { id: 'response_join', kind: 'join', label: 'Join degraded response', description: 'Wait for replan, escalation and maintenance evidence.', reads: ['replan_request', 'maintenance_created', 'maintenance_reference'], writes: [], config: { mode: 'all' } },
    { id: 'publish_observation', kind: 'function', label: 'Publish mission observation', description: 'Preserve normal or degraded response evidence.', handler: 'robotics_fleet.publish_observation', reads: ['task_id', 'robot_id', 'task_status', 'mission_healthy', 'mission_complete', 'replan_attempt', 'replan_request', 'maintenance_created', 'maintenance_reference'], writes: ['mission_observation_record'], config: {} },
  ],
  edges: [
    { id: 'start.assess', source: 'start', target: 'assess_telemetry', on: 'success' }, { id: 'assess.route', source: 'assess_telemetry', target: 'health_route', on: 'success' },
    { id: 'route.publish', source: 'health_route', target: 'publish_observation', on: 'success', condition: { field: 'mission_healthy', operator: 'equals', value: true } },
    { id: 'route.initialize', source: 'health_route', target: 'initialize_replan', on: 'success', condition: { field: 'mission_healthy', operator: 'equals', value: false } },
    { id: 'initialize.loop', source: 'initialize_replan', target: 'replan_loop', on: 'success' }, { id: 'loop.request', source: 'replan_loop', target: 'request_replan', on: 'success' },
    { id: 'route.escalate', source: 'health_route', target: 'escalate_fault', on: 'success', condition: { field: 'mission_healthy', operator: 'equals', value: false } },
    { id: 'route.maintenance', source: 'health_route', target: 'create_maintenance', on: 'success', condition: { field: 'mission_healthy', operator: 'equals', value: false } },
    { id: 'request.join', source: 'request_replan', target: 'response_join', on: 'success' }, { id: 'escalate.join', source: 'escalate_fault', target: 'response_join', on: 'success' },
    { id: 'maintenance.join', source: 'create_maintenance', target: 'response_join', on: 'success' }, { id: 'join.publish', source: 'response_join', target: 'publish_observation', on: 'success' },
  ], budget,
};

const requiredString = (description: string) => ({ type: 'string' as const, required: true, description });
export const roboticsFleetPack: IndustryPackManifest = {
  id: 'robotics_fleet', version: '0.6.0', name: 'Robotics and Fleet Operations Pack', license: 'MIT',
  description: 'A governed task-to-dispatch and telemetry-to-recovery Pack. It preserves bids, allocation, resource and safety decisions, dispatch receipts, telemetry, replans and maintenance while leaving ROS 2/OpenRMF, resource locks, motion control and safety controllers as external authorities.',
  ontology: {
    objectTypes: [
      { id: 'fleet_task', label: 'Fleet task', description: 'Requested operational task.', fields: { task_id: requiredString('Task.'), task_type: requiredString('Type.'), priority: requiredString('Priority.') } },
      { id: 'robot', label: 'Robot', description: 'Fleet resource selected for work.', fields: { robot_id: requiredString('Robot.'), fleet_id: requiredString('Fleet.'), status: requiredString('Status.') } },
      { id: 'bid', label: 'Allocation bid', description: 'Robot eligibility and score evidence.', fields: { robot_id: requiredString('Robot.'), eligible: { type: 'boolean', required: true, description: 'Eligibility.' }, score: { type: 'number', required: true, description: 'Score.' } } },
      { id: 'mission_plan', label: 'Mission plan', description: 'Waypoints, resources and safe recovery.', fields: { task_id: requiredString('Task.'), robot_id: requiredString('Robot.'), recovery: requiredString('Recovery policy.') } },
      { id: 'resource_reservation', label: 'Resource reservation', description: 'External shared-resource reservation.', fields: { reservation_id: requiredString('Reservation.'), status: requiredString('Status.') } },
      { id: 'safety_decision', label: 'Safety decision', description: 'Accountable dispatch authorization.', fields: { approved: { type: 'boolean', required: true, description: 'Decision.' }, gate: requiredString('Gate.') } },
      { id: 'dispatch', label: 'Dispatch', description: 'External fleet dispatch receipt.', fields: { dispatch_id: requiredString('Dispatch.'), task_id: requiredString('Task.'), status: requiredString('Status.') } },
      { id: 'telemetry_observation', label: 'Telemetry observation', description: 'Mission status and health evidence.', fields: { task_id: requiredString('Task.'), robot_id: requiredString('Robot.'), healthy: { type: 'boolean', required: true, description: 'Health.' } } },
      { id: 'replan', label: 'Mission replan', description: 'Bounded external route proposal.', fields: { task_id: requiredString('Task.'), attempt: { type: 'number', required: true, description: 'Attempt.' }, status: requiredString('Status.') } },
      { id: 'maintenance_action', label: 'Maintenance action', description: 'Maintenance work raised from evidence.', fields: { robot_id: requiredString('Robot.'), reference: requiredString('Work order.'), status: requiredString('Status.') } },
      { id: 'fleet_record', label: 'Fleet operations record', description: 'Portable dispatch or observation record.', fields: { record_type: requiredString('Type.'), content: requiredString('Content.') } },
    ],
    relationTypes: [
      { id: 'bids_for_task', label: 'Bids for task', description: 'Bid evaluates task.', sourceTypes: ['bid'], targetTypes: ['fleet_task'] },
      { id: 'offered_by', label: 'Offered by', description: 'Bid belongs to robot.', sourceTypes: ['bid'], targetTypes: ['robot'] },
      { id: 'allocates_robot', label: 'Allocates robot', description: 'Mission allocates robot.', sourceTypes: ['mission_plan'], targetTypes: ['robot'] },
      { id: 'plans_task', label: 'Plans task', description: 'Mission plans task.', sourceTypes: ['mission_plan'], targetTypes: ['fleet_task'] },
      { id: 'reserves_for_mission', label: 'Reserves for mission', description: 'Reservation supports mission.', sourceTypes: ['resource_reservation'], targetTypes: ['mission_plan'] },
      { id: 'authorizes_dispatch', label: 'Authorizes dispatch', description: 'Safety decision authorizes dispatch.', sourceTypes: ['safety_decision'], targetTypes: ['dispatch'] },
      { id: 'dispatches_mission', label: 'Dispatches mission', description: 'Dispatch sends mission.', sourceTypes: ['dispatch'], targetTypes: ['mission_plan'] },
      { id: 'observes_robot', label: 'Observes robot', description: 'Telemetry observes robot.', sourceTypes: ['telemetry_observation'], targetTypes: ['robot'] },
      { id: 'replans_task', label: 'Replans task', description: 'Replan changes task route.', sourceTypes: ['replan'], targetTypes: ['fleet_task'] },
      { id: 'maintains_robot', label: 'Maintains robot', description: 'Maintenance targets robot.', sourceTypes: ['maintenance_action'], targetTypes: ['robot'] },
      { id: 'documents_fleet_work', label: 'Documents fleet work', description: 'Record documents work.', sourceTypes: ['fleet_record'], targetTypes: ['fleet_task', 'dispatch', 'telemetry_observation'] },
    ],
  },
  roles: [
    { id: 'fleet_operator', label: 'Fleet operator', mission: 'Coordinate task intake, dispatch and mission observation.', allowedTools: ['mission_dispatch', 'telemetry_read'], forbiddenActions: ['Override device safety controller'] },
    { id: 'fleet_planner', label: 'Fleet planner', mission: 'Evaluate bids and propose mission envelopes.', allowedTools: ['fleet_state_read', 'mission_replan'], forbiddenActions: ['Command actuators directly'] },
    { id: 'resource_manager', label: 'Resource manager', mission: 'Reserve shared doors, lifts and zones.', allowedTools: ['resource_reserve'], forbiddenActions: ['Bypass external resource authority'] },
    { id: 'safety_supervisor', label: 'Safety supervisor', mission: 'Approve dispatch envelope and own degraded-response escalation.', allowedTools: [], forbiddenActions: ['Disable emergency stop'] },
    { id: 'maintenance_coordinator', label: 'Maintenance coordinator', mission: 'Create attributable maintenance work from telemetry evidence.', allowedTools: ['maintenance_create'], forbiddenActions: ['Rewrite telemetry history'] },
  ],
  tools: [
    { id: 'fleet_state_read', label: 'Fleet state query', risk: 'read', description: 'Read an external fleet snapshot.', operation: 'query', inputSchema: { type: 'object', properties: { fleet_id: { type: 'string' } }, required: ['fleet_id'], additionalProperties: false }, outputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, status: { type: 'string' } }, required: ['snapshot_id', 'status'], additionalProperties: false }, idempotency: 'intrinsic' },
    { id: 'resource_reserve', label: 'OpenRMF resource reservation', risk: 'external', description: 'Reserve shared resources.', operation: 'command', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string' }, resources: { type: 'array' } }, required: ['idempotency_key', 'resources'], additionalProperties: false }, outputSchema: { type: 'object', properties: { reservation_id: { type: 'string' }, status: { type: 'string' } }, required: ['reservation_id', 'status'], additionalProperties: false }, idempotency: 'keyed', idempotencyKeyField: 'idempotency_key' },
    { id: 'mission_dispatch', label: 'Fleet mission dispatcher', risk: 'external', description: 'Dispatch an approved mission.', operation: 'command', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string' }, mission: { type: 'object' } }, required: ['idempotency_key', 'mission'], additionalProperties: false }, outputSchema: { type: 'object', properties: { dispatch_id: { type: 'string' }, status: { type: 'string' } }, required: ['dispatch_id', 'status'], additionalProperties: false }, idempotency: 'keyed', idempotencyKeyField: 'idempotency_key' },
    { id: 'telemetry_read', label: 'Telemetry query', risk: 'read', description: 'Read mission telemetry.', operation: 'query', inputSchema: { type: 'object', properties: { robot_id: { type: 'string' } }, required: ['robot_id'], additionalProperties: false }, outputSchema: { type: 'object', properties: { robot_id: { type: 'string' }, status: { type: 'string' } }, required: ['robot_id', 'status'], additionalProperties: false }, idempotency: 'intrinsic' },
    { id: 'mission_replan', label: 'Fleet planner request', risk: 'external', description: 'Submit a bounded route proposal.', operation: 'command', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string' }, route: { type: 'object' } }, required: ['idempotency_key', 'route'], additionalProperties: false }, outputSchema: { type: 'object', properties: { replan_id: { type: 'string' }, status: { type: 'string' } }, required: ['replan_id', 'status'], additionalProperties: false }, idempotency: 'keyed', idempotencyKeyField: 'idempotency_key' },
    { id: 'maintenance_create', label: 'Maintenance work-order writer', risk: 'write', description: 'Create maintenance work.', operation: 'command', inputSchema: { type: 'object', properties: { idempotency_key: { type: 'string' }, robot_id: { type: 'string' } }, required: ['idempotency_key', 'robot_id'], additionalProperties: false }, outputSchema: { type: 'object', properties: { work_order_id: { type: 'string' }, status: { type: 'string' } }, required: ['work_order_id', 'status'], additionalProperties: false }, idempotency: 'keyed', idempotencyKeyField: 'idempotency_key' },
  ],
  graphs: [dispatchGraph, bidGraph, observationGraph, replanGraph],
  evaluations: [
    { id: 'dispatch_safety', label: 'Dispatch safety', description: 'Requires resource and safety authorization before dispatch.', blocking: true },
    { id: 'mission_health', label: 'Mission health', description: 'Requires attributable task and telemetry evidence.', blocking: true },
  ],
  deliverables: [
    { id: 'dispatch_record', label: 'Fleet dispatch record', description: 'Task, bids, allocation, resources, approval and dispatch receipt.', graphId: dispatchGraph.id, stateField: 'dispatch_record', mediaType: 'text/markdown', artifactType: 'fleet_dispatch_record', evidenceFields: ['bid_results', 'allocation_plan', 'mission_plan', 'resource_reservation', 'dispatch_receipt'], approvalField: 'safety_approved' },
    { id: 'mission_observation_record', label: 'Mission observation record', description: 'Telemetry, replanning, escalation and maintenance evidence.', graphId: observationGraph.id, stateField: 'mission_observation_record', mediaType: 'text/markdown', artifactType: 'fleet_observation_record', evidenceFields: ['telemetry_assessment', 'replan_request'] },
  ],
  fixtures: [
    { id: 'hospital_delivery_dispatch', label: 'Hospital material delivery', description: 'Exercises event intake, parallel bidding, resource reservation and safety approval.', graphId: dispatchGraph.id, input: { task_id: 'task-1001', task_type: 'delivery', pickup: { map: 'L1', waypoint: 'pharmacy' }, dropoff: { map: 'L3', waypoint: 'ward-3' }, payload: { weight_kg: 8, category: 'sealed-medication' }, priority: 'high', requested_at: '2026-08-11T09:00:00.000Z', fleet_snapshot: [{ robot_id: 'robot-a', fleet_id: 'hospital-amr', status: 'available', battery_percent: 82, payload_capacity_kg: 20 }, { robot_id: 'robot-b', fleet_id: 'hospital-amr', status: 'available', battery_percent: 55, payload_capacity_kg: 12 }, { robot_id: 'robot-c', fleet_id: 'hospital-amr', status: 'charging', battery_percent: 25, payload_capacity_kg: 30 }], required_resources: ['lift-2', 'door-ward-3'], safety_constraints: ['sealed payload', 'yield to emergency traffic'] }, decisions: { safety_approval: true }, expectations: [
      { field: 'bid_results', operator: 'min_items', value: 3, description: 'Evaluates all robot candidates.' }, { field: 'dispatch_receipt', operator: 'exists', description: 'Creates external dispatch receipt.' }, { field: 'dispatch_record', operator: 'includes', value: 'Real-time motion', description: 'Preserves control boundary.' },
    ] },
    { id: 'dispatch_rejected', label: 'Safety-rejected dispatch', description: 'Proves rejected safety envelope cannot reach fleet dispatch.', graphId: dispatchGraph.id, input: { task_id: 'task-1002', task_type: 'delivery', pickup: { map: 'yard', waypoint: 'dock-a' }, dropoff: { map: 'yard', waypoint: 'dock-b' }, payload: { weight_kg: 50, category: 'oversize' }, priority: 'routine', requested_at: '2026-08-11T09:05:00.000Z', fleet_snapshot: [{ robot_id: 'forklift-a', fleet_id: 'yard', status: 'available', battery_percent: 70, payload_capacity_kg: 100 }], required_resources: ['crossing-1'], safety_constraints: ['human spotter required'] }, decisions: { safety_approval: false }, expectations: [
      { field: 'safety_approved', operator: 'equals', value: false, description: 'Preserves safety rejection.' }, { field: 'rejection_reason', operator: 'includes', value: 'rejected', description: 'Stops before dispatch.' },
    ] },
    { id: 'healthy_mission_completion', label: 'Healthy mission completion', description: 'Exercises normal telemetry completion.', graphId: observationGraph.id, input: { task_id: 'task-1001', robot_id: 'robot-a', task_status: 'completed', telemetry_signals: [{ name: 'battery', status: 'healthy', value: 61 }, { name: 'localization', status: 'ok', value: 0.97 }] }, decisions: {}, expectations: [
      { field: 'mission_healthy', operator: 'equals', value: true, description: 'Confirms healthy telemetry.' }, { field: 'mission_complete', operator: 'equals', value: true, description: 'Confirms task completion.' }, { field: 'mission_observation_record', operator: 'includes', value: 'healthy', description: 'Publishes normal evidence.' },
    ] },
    { id: 'degraded_mission_recovery', label: 'Degraded mission recovery', description: 'Exercises bounded replanning, escalation and maintenance creation.', graphId: observationGraph.id, input: { task_id: 'task-1003', robot_id: 'robot-b', task_status: 'blocked', telemetry_signals: [{ name: 'localization', status: 'degraded', value: 0.41 }, { name: 'motor_temperature', status: 'warning', value: 88 }] }, decisions: {}, expectations: [
      { field: 'mission_healthy', operator: 'equals', value: false, description: 'Detects degraded mission.' }, { field: 'replan_attempt', operator: 'equals', value: 2, description: 'Bounds replanning attempts.' }, { field: 'maintenance_created', operator: 'equals', value: true, description: 'Creates maintenance evidence.' }, { field: 'mission_observation_record', operator: 'includes', value: 'degraded', description: 'Publishes degraded response.' },
    ] },
  ],
};
