import { performance } from 'node:perf_hooks';
import { compilePack, GraphRuntime, InMemoryContextGraphStore } from '@graph-native/core';
import { projectResearchRun, researchHandlers, researchPack } from '@graph-native/pack-research';

interface Measurement {
  readonly name: string;
  readonly unit: 'ms';
  readonly samples: number;
  readonly median: number;
  readonly p95: number;
  readonly budgetP95: number;
}

const budgets = {
  compilePackMs: 20,
  deterministicRunMs: 150,
  contextProjectionMs: 50,
} as const;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function measure(
  name: string,
  samples: number,
  budgetP95: number,
  operation: () => unknown | Promise<unknown>,
): Promise<Measurement> {
  for (let index = 0; index < 3; index += 1) await operation();
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await operation();
    durations.push(performance.now() - started);
  }
  return {
    name,
    unit: 'ms',
    samples,
    median: Number(percentile(durations, 0.5).toFixed(2)),
    p95: Number(percentile(durations, 0.95).toFixed(2)),
    budgetP95,
  };
}

const compiled = compilePack(researchPack);
const graph = compiled.graphs.get('research.workflow');
if (!graph) throw new Error('Research workflow is missing.');
const runtime = new GraphRuntime(graph, { handlers: researchHandlers, pack: researchPack });
const completed = await runtime.run(
  { goal: 'Measure the stable reference workflow.' },
  { decisions: { approval: true } },
);
if (completed.status !== 'completed') throw new Error('Reference workflow did not complete.');

const results = [
  await measure('compile Research Pack', 100, budgets.compilePackMs, () => compilePack(researchPack)),
  await measure('run deterministic Research workflow', 20, budgets.deterministicRunMs, async () => {
    const result = await runtime.run(
      { goal: 'Measure deterministic execution.' },
      { decisions: { approval: true } },
    );
    if (result.status !== 'completed') throw new Error(`Benchmark run ended ${result.status}.`);
  }),
  await measure('project Research context graph', 30, budgets.contextProjectionMs, async () => {
    const context = new InMemoryContextGraphStore(researchPack);
    await projectResearchRun(context, completed);
  }),
];

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
const exceeded = results.filter((result) => result.p95 > result.budgetP95);
if (exceeded.length > 0) {
  throw new Error(`Performance budget exceeded: ${exceeded.map((item) => item.name).join(', ')}.`);
}
