import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { industryPackJsonSchema } from '@graph-native/contracts';
import { compilePack, GraphRuntime } from '@graph-native/core';
import {
  formatPackInspection,
  inspectPack,
  loadPackModule,
  scaffoldPack,
} from '@graph-native/pack-sdk';
import { researchPack } from '@graph-native/pack-research';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const paths = temporaryDirectories.splice(0);
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

describe('Pack SDK', () => {
  it('exports an editor-compatible JSON Schema for Pack manifests', () => {
    expect(industryPackJsonSchema).toHaveProperty('$schema');
    expect(industryPackJsonSchema).toHaveProperty('properties.graphs');
    expect(industryPackJsonSchema).toHaveProperty('properties.deliverables');
    expect(industryPackJsonSchema).toHaveProperty('properties.fixtures');
  });

  it('returns a concise, stable inspection of a Pack', () => {
    const inspection = inspectPack(researchPack);
    expect(inspection.graphs[0]).toMatchObject({ id: 'research.workflow', nodes: 11, edges: 11 });
    expect(formatPackInspection(inspection)).toContain('human:1');
    expect(inspection.deliverables).toEqual(['approved_research']);
    expect(inspection.fixtures).toEqual(['graph_native_question']);
  });

  it('scaffolds a valid Pack that can be loaded and run without kernel changes', async () => {
    const directory = await mkdtemp(resolve('tests', '.tmp-pack-'));
    temporaryDirectories.push(directory);
    const scaffold = await scaffoldPack('customer_success', directory);
    expect(scaffold.files).toContain('src/index.ts');
    expect(await readFile(resolve(directory, 'package.json'), 'utf8')).toContain('"license": "MIT"');

    const loaded = await loadPackModule(resolve(directory, 'src/index.ts'));
    const graph = compilePack(loaded.pack).graphs.get('customer_success.workflow');
    if (!graph) throw new Error('Generated graph is missing.');
    const result = await new GraphRuntime(graph, {
      handlers: loaded.handlers,
      pack: loaded.pack,
    }).run({ topic: 'renewal risk' });
    expect(result.status).toBe('completed');
    expect(result.state.result).toBe('Pack customer_success processed: renewal risk');
  });
});
