import { describe, expect, it } from 'vitest';
import { WorkbenchService } from '../apps/workbench/src/service.js';

describe('Workbench service', () => {
  it('exposes the Architecture Pack and starts from its real fixture input', () => {
    const description = new WorkbenchService().describePack();
    expect(description).toMatchObject({
      id: 'architecture',
      graph: { id: 'architecture.concept_workflow' },
      input: { project_name: '长宁街区更新', output_language: 'zh-CN' },
    });
    expect(description.graph.nodes.some((node) => node.id === 'approval')).toBe(true);
  });

  it('runs to human review and projects an approved result into the context graph', async () => {
    const service = new WorkbenchService();
    const input = service.describePack().input;
    const paused = await service.start(input);
    expect(paused.status).toBe('paused');
    expect(paused.state.concept_directions).toHaveLength(2);
    expect(paused.events.some((event) => event.type === 'human.requested')).toBe(true);

    const completed = await service.decide(paused.runId, true);
    expect(completed.status).toBe('completed');
    expect(completed.state.deliverable).toContain('# 概念设计简报');
    expect(completed.context?.objects.some((object) => object.type === 'deliverable')).toBe(true);
    expect(completed.context?.relations.some((relation) => relation.type === 'decision_governs')).toBe(true);
    expect(service.get(paused.runId)).toEqual(completed);
  });

  it('records a rejected review without publishing a deliverable', async () => {
    const service = new WorkbenchService();
    const paused = await service.start(service.describePack().input);
    const rejected = await service.decide(paused.runId, false);
    expect(rejected.status).toBe('completed');
    expect(rejected.state.deliverable).toBeUndefined();
    expect(rejected.state.rejection_reason).toBeTypeOf('string');
    expect(rejected.context).toBeUndefined();
  });
});
