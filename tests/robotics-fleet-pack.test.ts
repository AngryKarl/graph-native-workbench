import { describe, expect, it } from 'vitest';
import { projectRoboticsFleetRun, roboticsFleetHandlers, roboticsFleetPack } from '@graph-workbench/pack-robotics-fleet';
import { compilePack, GraphRuntime, GraphTriggerDispatcher, InMemoryContextGraphStore } from '@graph-workbench/core';
import { runAllPackFixtures } from '@graph-workbench/pack-sdk';

describe('Robotics and Fleet Operations Pack', () => {
  it('compiles dispatch, bid, observation and bounded-replan graphs', () => {
    const compiled = compilePack(roboticsFleetPack);
    expect([...compiled.graphs.keys()]).toEqual(['robotics_fleet.task_dispatch', 'robotics_fleet.calculate_bid', 'robotics_fleet.mission_observation', 'robotics_fleet.replan_step']);
    expect(compiled.manifest.tools).toHaveLength(6);
  });
  it('passes dispatch, rejection, healthy and degraded mission fixtures without keys', async () => {
    const results = await runAllPackFixtures(roboticsFleetPack, roboticsFleetHandlers);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.passed)).toBe(true);
  });
  it('requires safety approval before external dispatch', async () => {
    const fixture = roboticsFleetPack.fixtures[0]!;
    const graph = compilePack(roboticsFleetPack).graphs.get(fixture.graphId)!;
    const result = await new GraphRuntime(graph, { pack: roboticsFleetPack, handlers: roboticsFleetHandlers }).run(fixture.input, { runId: 'run-fleet-safety' });
    expect(result).toMatchObject({ status: 'paused', checkpoint: { readyNodeIds: ['safety_approval'] } });
    expect(result.state.dispatch_receipt).toBeUndefined();
  });
  it('dispatches degraded telemetry into bounded replanning, escalation and maintenance', async () => {
    const fixture = roboticsFleetPack.fixtures.find((item) => item.id === 'degraded_mission_recovery')!;
    const dispatcher = new GraphTriggerDispatcher(compilePack(roboticsFleetPack), { handlers: roboticsFleetHandlers });
    const [triggered] = await dispatcher.dispatchEvent({ id: 'telemetry-task-1003', type: 'fleet.telemetry_observed', correlationKey: 'task-1003', payload: { robot_id: fixture.input.robot_id, task_status: fixture.input.task_status, telemetry_signals: fixture.input.telemetry_signals }, occurredAt: '2026-08-11T10:00:00.000Z' });
    expect(triggered?.result).toMatchObject({ status: 'completed', state: { task_id: 'task-1003', mission_healthy: false, replan_attempt: 2, maintenance_created: true } });
    expect(triggered?.result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['loop.iteration', 'escalation.raised']));
  });
  it('projects allocation and degraded mission information flows into connected context', async () => {
    const compiled = compilePack(roboticsFleetPack);
    const dispatchFixture = roboticsFleetPack.fixtures[0]!;
    const dispatch = await new GraphRuntime(compiled.graphs.get(dispatchFixture.graphId)!, { pack: roboticsFleetPack, handlers: roboticsFleetHandlers }).run(dispatchFixture.input, { runId: 'run-fleet-context', decisions: dispatchFixture.decisions });
    const dispatchStore = new InMemoryContextGraphStore(roboticsFleetPack); await projectRoboticsFleetRun(dispatchStore, dispatch);
    expect((await dispatchStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining(['fleet_task', 'robot', 'bid', 'mission_plan', 'resource_reservation', 'safety_decision', 'dispatch', 'fleet_record']));
    expect((await dispatchStore.listRelations()).map((item) => item.type)).toEqual(expect.arrayContaining(['bids_for_task', 'offered_by', 'allocates_robot', 'plans_task', 'reserves_for_mission', 'authorizes_dispatch', 'dispatches_mission', 'documents_fleet_work']));
    const degradedFixture = roboticsFleetPack.fixtures.find((item) => item.id === 'degraded_mission_recovery')!;
    const degraded = await new GraphRuntime(compiled.graphs.get(degradedFixture.graphId)!, { pack: roboticsFleetPack, handlers: roboticsFleetHandlers }).run(degradedFixture.input, { runId: 'run-fleet-degraded-context' });
    const degradedStore = new InMemoryContextGraphStore(roboticsFleetPack); await projectRoboticsFleetRun(degradedStore, degraded);
    expect((await degradedStore.listObjects()).map((item) => item.type)).toEqual(expect.arrayContaining(['telemetry_observation', 'replan', 'maintenance_action']));
  });
});
