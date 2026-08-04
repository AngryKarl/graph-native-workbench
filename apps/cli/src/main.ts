#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { industryPackJsonSchema, type GraphEvent } from '@graph-native/contracts';
import {
  compilePack,
  GraphRuntime,
  InMemoryContextGraphStore,
  SQLiteRunStore,
} from '@graph-native/core';
import {
  projectResearchRun,
  researchHandlers,
  researchPack,
} from '@graph-native/pack-research';
import {
  activateInstalledPack,
  buildPackArtifact,
  formatArtifactInspection,
  formatFixtureResult,
  formatPackInspection,
  inspectPack,
  inspectPackArtifact,
  installPackArtifact,
  listInstalledPacks,
  loadInstalledPack,
  loadPackModule,
  rollbackInstalledPack,
  runAllPackFixtures,
  runPackFixture,
  scaffoldPack,
  uninstallInstalledPack,
} from '@graph-native/pack-sdk';

const args = process.argv.slice(2);

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(flag: string): string[] {
  return args.flatMap((value, index) => (value === flag && args[index + 1] ? [args[index + 1]!] : []));
}

function assignment(value: string, flag: string): Record<string, unknown> {
  const separator = value.indexOf('=');
  if (separator < 1) throw new Error(`${flag} expects key=value; received "${value}".`);
  const key = value.slice(0, separator).trim();
  const raw = value.slice(separator + 1).trim();
  if (!key) throw new Error(`${flag} requires a non-empty key.`);
  try {
    return { [key]: JSON.parse(raw) };
  } catch {
    return { [key]: raw };
  }
}

async function recordInput(value: string | undefined, flag: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  if (value.startsWith('@')) {
    return JSON.parse(await readFile(resolve(value.slice(1)), 'utf8')) as Record<string, unknown>;
  }
  if (value.includes('=') && !value.trimStart().startsWith('{')) return assignment(value, flag);
  return JSON.parse(value) as Record<string, unknown>;
}

function assignments(flag: string): Record<string, unknown> {
  return Object.assign({}, ...valuesAfter(flag).map((value) => assignment(value, flag)));
}

function usage(): string {
  return `Graph Native Workbench\n\nUsage:\n  graphwork demo [--pause]\n  graphwork pack init <pack-id> [directory]\n  graphwork pack validate [module-or-json]\n  graphwork pack inspect [module-or-json-or-gpack]\n  graphwork pack test [module] [--fixture fixture-id]\n  graphwork pack demo [module] [--fixture fixture-id]\n  graphwork pack build <module> [--output pack.gpack] [--engine ^0.1.0]\n  graphwork pack install <pack.gpack> --trust [--root .graphwork/packs]\n  graphwork pack list [--root .graphwork/packs]\n  graphwork pack activate <pack-id>@<version> [--root .graphwork/packs]\n  graphwork pack rollback <pack-id> [--root .graphwork/packs]\n  graphwork pack uninstall <pack-id> [--version 0.1.0] [--root .graphwork/packs]\n  graphwork pack run <module> --set topic=hello [--decision approval=true] [--database runs.sqlite]\n  graphwork pack run <pack-id> --installed --set topic=hello [--root .graphwork/packs]\n  graphwork pack resume <module-or-pack-id> --run <run-id> --database runs.sqlite [--installed]\n  graphwork pack schema [output.json]\n\nRepeat --set/--decision/--permission for more values. --input/--decisions also accept JSON or @file.json.\nExecutable .gpack artifacts require explicit --trust during installation.`;
}

function printEvent(event: GraphEvent): void {
  console.log(`${String(event.seq).padStart(2, '0')}  ${event.type}${event.nodeId ? ` ${event.nodeId}` : ''}`);
}

async function demo(): Promise<void> {
  const pauseForApproval = args.includes('--pause');
  const compiledPack = compilePack(researchPack);
  const graph = compiledPack.graphs.get('research.workflow');
  if (!graph) throw new Error('Research workflow was not compiled.');

  console.log(`Pack: ${compiledPack.manifest.name} v${compiledPack.manifest.version}`);
  console.log(`Graph: ${graph.definition.name}`);
  console.log(`Mode: ${pauseForApproval ? 'pause at human gate' : 'approve and finish'}\n`);
  const runtime = new GraphRuntime(graph, {
    handlers: researchHandlers,
    pack: compiledPack.manifest,
  });
  const result = await runtime.run(
    { goal: 'Can a graph-native workbench become reusable infrastructure for complex industries?' },
    {
      ...(pauseForApproval ? {} : { decisions: { approval: true } }),
      onEvent: printEvent,
    },
  );

  console.log('');
  if (result.status === 'completed') {
    const contextGraph = new InMemoryContextGraphStore(compiledPack.manifest);
    await projectResearchRun(contextGraph, result);
    console.log(String(result.state.deliverable ?? result.state.rejection_reason));
    console.log(
      `\nContext graph: ${(await contextGraph.listObjects()).length} objects, ` +
        `${(await contextGraph.listRelations()).length} typed relations`,
    );
  } else if (result.status === 'paused') {
    console.log('Workflow paused safely. Serializable checkpoint:');
    console.log(JSON.stringify(result.checkpoint, null, 2));
  } else if (result.status === 'cancelled') {
    console.log('Workflow cancelled safely. It can be resumed from its checkpoint.');
  } else {
    throw result.error;
  }
}

async function resolvePack(path: string | undefined) {
  if (!path) return { pack: researchPack, handlers: researchHandlers, source: 'built-in:research' };
  return loadPackModule(path);
}

async function resolveRunnablePack(subject: string) {
  return args.includes('--installed')
    ? loadInstalledPack(subject, valueAfter('--root'))
    : loadPackModule(subject);
}

async function packCommand(): Promise<void> {
  const action = args[1];
  const subject = args[2];
  if (action === 'validate') {
    const loaded = await resolvePack(subject);
    const compiled = compilePack(loaded.pack);
    console.log(`✓ ${compiled.manifest.id}@${compiled.manifest.version} is valid (${loaded.source})`);
    console.log(`  ${compiled.graphs.size} graph(s), ${compiled.manifest.ontology.objectTypes.length} context object type(s)`);
    return;
  }
  if (action === 'inspect') {
    if (subject?.toLowerCase().endsWith('.gpack')) {
      console.log(formatArtifactInspection(inspectPackArtifact(subject)));
      return;
    }
    const loaded = await resolvePack(subject);
    console.log(formatPackInspection(inspectPack(loaded.pack)));
    return;
  }
  if (action === 'test') {
    const loaded = await resolvePack(subject);
    const fixtureId = valueAfter('--fixture');
    const results = fixtureId
      ? [await runPackFixture(loaded.pack, loaded.handlers, fixtureId)]
      : await runAllPackFixtures(loaded.pack, loaded.handlers);
    if (results.length === 0) throw new Error(`Pack "${loaded.pack.id}" does not declare fixtures.`);
    console.log(results.map(formatFixtureResult).join('\n'));
    if (results.some((result) => !result.passed)) process.exitCode = 1;
    return;
  }
  if (action === 'demo') {
    const loaded = await resolvePack(subject);
    const fixtureId = valueAfter('--fixture') ?? loaded.pack.fixtures[0]?.id;
    if (!fixtureId) throw new Error(`Pack "${loaded.pack.id}" does not declare fixtures.`);
    const result = await runPackFixture(loaded.pack, loaded.handlers, fixtureId);
    console.log(formatFixtureResult(result));
    if (!result.passed) {
      process.exitCode = 1;
      return;
    }
    const outputs = loaded.pack.deliverables.filter(
      (deliverable) => deliverable.graphId === result.fixture.graphId,
    );
    for (const output of outputs) {
      console.log(`\n${output.label} (${output.mediaType})\n`);
      const value = result.state[output.stateField];
      console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    return;
  }
  if (action === 'init') {
    if (!subject) throw new Error('Missing pack id. Example: graphwork pack init customer-success');
    const directory = args[3] ?? resolve('packs', subject);
    const result = await scaffoldPack(subject, directory);
    console.log(`✓ Created ${result.id} at ${result.directory}`);
    for (const file of result.files) console.log(`  ${file}`);
    const modulePath = relative(process.cwd(), resolve(result.directory, 'src/index.ts')).replaceAll('\\', '/');
    console.log(`\nNext: pnpm graphwork pack validate ${modulePath}`);
    return;
  }
  if (action === 'schema') {
    const output = JSON.stringify(industryPackJsonSchema, null, 2);
    if (!subject) {
      console.log(output);
      return;
    }
    const outputPath = resolve(subject);
    await writeFile(outputPath, `${output}\n`, 'utf8');
    console.log(`✓ Wrote Industry Pack JSON Schema to ${outputPath}`);
    return;
  }
  if (action === 'build') {
    if (!subject) throw new Error('Missing Pack module path.');
    const permissions = valuesAfter('--permission') as Array<
      'handlers.execute' | 'context.write' | 'network' | 'filesystem'
    >;
    const output = valueAfter('--output');
    const engineRange = valueAfter('--engine');
    const result = await buildPackArtifact({
      source: subject,
      ...(output ? { output } : {}),
      ...(engineRange ? { engineRange } : {}),
      ...(permissions.length > 0 ? { permissions } : {}),
    });
    console.log(`✓ Built ${result.descriptor.pack.id}@${result.descriptor.pack.version}`);
    console.log(`  ${result.artifact}`);
    console.log(`  SHA-256 ${result.checksum}`);
    return;
  }
  if (action === 'install') {
    if (!subject) throw new Error('Missing .gpack artifact path.');
    const root = valueAfter('--root');
    const installed = installPackArtifact(subject, {
      trust: args.includes('--trust'),
      ...(root ? { root } : {}),
      activate: !args.includes('--no-activate'),
    });
    console.log(`✓ Installed ${installed.directory}`);
    console.log(`  Active version: ${installed.version}`);
    return;
  }
  if (action === 'list') {
    const registry = listInstalledPacks(valueAfter('--root'));
    const entries = Object.entries(registry.packs);
    if (entries.length === 0) {
      console.log('No third-party Packs installed.');
      return;
    }
    for (const [id, record] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      const versions = Object.keys(record.versions).sort().map((version) =>
        version === record.activeVersion ? `${version} (active)` : version,
      );
      console.log(`${id}: ${versions.join(', ')}`);
    }
    return;
  }
  if (action === 'activate') {
    if (!subject) throw new Error('Expected <pack-id>@<version>.');
    const separator = subject.lastIndexOf('@');
    if (separator < 1) throw new Error('Expected <pack-id>@<version>.');
    const id = subject.slice(0, separator);
    const version = subject.slice(separator + 1);
    activateInstalledPack(id, version, valueAfter('--root'));
    console.log(`✓ Activated ${id}@${version}`);
    return;
  }
  if (action === 'rollback') {
    if (!subject) throw new Error('Missing Pack id.');
    const installed = rollbackInstalledPack(subject, valueAfter('--root'));
    console.log(`✓ Rolled back ${subject} to ${installed.version}`);
    return;
  }
  if (action === 'uninstall') {
    if (!subject) throw new Error('Missing Pack id.');
    uninstallInstalledPack(subject, valueAfter('--version'), valueAfter('--root'));
    console.log(`✓ Uninstalled ${subject}${valueAfter('--version') ? `@${valueAfter('--version')}` : ''}`);
    return;
  }
  if (action === 'run') {
    if (!subject) throw new Error('Missing Pack module path.');
    const loaded = await resolveRunnablePack(subject);
    const compiled = compilePack(loaded.pack);
    const graphId = valueAfter('--graph') ?? compiled.manifest.graphs[0]?.id;
    const graph = graphId ? compiled.graphs.get(graphId) : undefined;
    if (!graph) throw new Error(`Graph "${graphId ?? ''}" does not exist in Pack "${compiled.manifest.id}".`);
    const input = {
      ...await recordInput(valueAfter('--input'), '--input'),
      ...assignments('--set'),
    };
    const decisions = {
      ...await recordInput(valueAfter('--decisions'), '--decisions'),
      ...assignments('--decision'),
    };
    const databasePath = valueAfter('--database');
    const store = databasePath ? new SQLiteRunStore(resolve(databasePath)) : undefined;
    try {
      const runId = valueAfter('--run-id');
      const result = await new GraphRuntime(graph, {
        handlers: loaded.handlers,
        pack: compiled.manifest,
      }).run(input, {
        decisions,
        onEvent: printEvent,
        ...(runId ? { runId } : {}),
        ...(store ? { store } : {}),
      });
      console.log(JSON.stringify({ status: result.status, runId: result.runId, state: result.state }, null, 2));
      if (result.status === 'failed') throw result.error;
    } finally {
      store?.close();
    }
    return;
  }
  if (action === 'resume') {
    if (!subject) throw new Error('Missing Pack module path.');
    const runId = valueAfter('--run');
    const databasePath = valueAfter('--database');
    if (!runId) throw new Error('Missing --run <run-id>.');
    if (!databasePath) throw new Error('Missing --database <runs.sqlite>.');
    const loaded = await resolveRunnablePack(subject);
    const compiled = compilePack(loaded.pack);
    const store = new SQLiteRunStore(resolve(databasePath));
    try {
      const storedRun = await store.getRun(runId);
      if (!storedRun) throw new Error(`Run "${runId}" does not exist.`);
      const graph = compiled.graphs.get(storedRun.graphId);
      if (!graph) throw new Error(`Pack "${compiled.manifest.id}" does not contain graph "${storedRun.graphId}".`);
      const decisions = {
        ...await recordInput(valueAfter('--decisions'), '--decisions'),
        ...assignments('--decision'),
      };
      const result = await new GraphRuntime(graph, {
        handlers: loaded.handlers,
        pack: compiled.manifest,
      }).resumeStored(runId, store, { decisions, onEvent: printEvent });
      console.log(JSON.stringify({ status: result.status, runId: result.runId, state: result.state }, null, 2));
      if (result.status === 'failed') throw result.error;
    } finally {
      store.close();
    }
    return;
  }
  throw new Error(`Unknown pack command "${action ?? ''}".\n\n${usage()}`);
}

async function main(): Promise<void> {
  const command = args[0] ?? 'demo';
  if (command === 'demo') return demo();
  if (command === 'pack') return packCommand();
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

try {
  await main();
} catch (error) {
  const resolved = error instanceof Error ? error : new Error(String(error));
  console.error(`Error: ${resolved.message}`);
  if (args.includes('--debug')) console.error(resolved.stack);
  process.exitCode = 1;
}
