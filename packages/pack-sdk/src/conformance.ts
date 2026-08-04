import { isDeepStrictEqual } from 'node:util';
import type {
  FixtureExpectation,
  IndustryPackManifest,
  PackFixtureDefinition,
} from '@graph-native/contracts';
import {
  compilePack,
  GraphRuntime,
  type GraphState,
  type HandlerRegistry,
  type RunResult,
} from '@graph-native/core';

export interface FixtureExpectationResult {
  readonly expectation: FixtureExpectation;
  readonly passed: boolean;
  readonly actual: unknown;
}

export interface PackFixtureResult {
  readonly fixture: PackFixtureDefinition;
  readonly passed: boolean;
  readonly status: RunResult['status'];
  readonly state: GraphState;
  readonly expectations: readonly FixtureExpectationResult[];
  readonly error?: string;
}

function expectationPasses(expectation: FixtureExpectation, actual: unknown): boolean {
  switch (expectation.operator) {
    case 'equals':
      return isDeepStrictEqual(actual, expectation.value);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'includes':
      return typeof actual === 'string'
        ? actual.includes(String(expectation.value))
        : Array.isArray(actual) && actual.some((item) => isDeepStrictEqual(item, expectation.value));
    case 'min_items':
      return Array.isArray(actual) && actual.length >= Number(expectation.value);
  }
}

export async function runPackFixture(
  packInput: IndustryPackManifest,
  handlers: HandlerRegistry,
  fixtureId: string,
): Promise<PackFixtureResult> {
  const compiled = compilePack(packInput);
  const fixture = compiled.manifest.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error(`Pack "${compiled.manifest.id}" has no fixture "${fixtureId}".`);
  const graph = compiled.graphs.get(fixture.graphId);
  if (!graph) throw new Error(`Fixture "${fixture.id}" references an unavailable graph.`);

  const result = await new GraphRuntime(graph, { handlers, pack: compiled.manifest }).run(
    fixture.input,
    { decisions: fixture.decisions },
  );
  const expectations = fixture.expectations.map((expectation) => ({
    expectation,
    actual: result.state[expectation.field],
    passed: expectationPasses(expectation, result.state[expectation.field]),
  }));
  const error = result.status === 'failed' ? result.error.message : undefined;
  return {
    fixture,
    status: result.status,
    state: result.state,
    expectations,
    passed: result.status === 'completed' && expectations.every((item) => item.passed),
    ...(error ? { error } : {}),
  };
}

export async function runAllPackFixtures(
  pack: IndustryPackManifest,
  handlers: HandlerRegistry,
): Promise<readonly PackFixtureResult[]> {
  const compiled = compilePack(pack);
  return Promise.all(
    compiled.manifest.fixtures.map((fixture) => runPackFixture(compiled.manifest, handlers, fixture.id)),
  );
}

export function formatFixtureResult(result: PackFixtureResult): string {
  const lines = [
    `${result.passed ? 'PASS' : 'FAIL'} ${result.fixture.id} (${result.status})`,
    ...result.expectations.map(
      ({ expectation, passed }) => `  ${passed ? 'PASS' : 'FAIL'} ${expectation.description}`,
    ),
  ];
  if (result.error) lines.push(`  Error: ${result.error}`);
  return lines.join('\n');
}
