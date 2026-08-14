#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { industryPackJsonSchema, type GraphEvent } from '@graph-workbench/contracts';
import {
  compilePack,
  createPolicyToolAuthorizer,
  createRunAuditBundle,
  defaultToolPolicy,
  GraphRuntime,
  InMemoryContextGraphStore,
  parseToolPolicy,
  PostgresRunQueue,
  PostgresRunStore,
  SQLiteRunStore,
  type RunStore,
  verifyRunAuditBundle,
} from '@graph-workbench/core';
import {
  researchHandlers,
  researchPack,
} from '@graph-workbench/pack-research';
import {
  projectSoftwareDeliveryRun,
  softwareDeliveryHandlers,
  softwareDeliveryPack,
} from '@graph-workbench/pack-software-delivery';
import {
  activateInstalledPack,
  buildPackArtifact,
  buildPackRegistryRelease,
  formatArtifactInspection,
  formatFixtureResult,
  formatPackInspection,
  GRAPH_WORKBENCH_ENGINE_VERSION,
  inspectPack,
  inspectPackArtifact,
  installPackArtifact,
  installPackFromSignedRegistry,
  listInstalledPacks,
  loadInstalledPackIsolated,
  loadPackModule,
  fetchSignedPackRegistry,
  signPackRegistry,
  verifySignedPackRegistry,
  rollbackInstalledPack,
  runAllPackFixtures,
  runPackFixture,
  scaffoldPack,
  uninstallInstalledPack,
  validatePackHandlerCoverage,
  type IsolatedPackPolicy,
} from '@graph-workbench/pack-sdk';
import {
  applyLegacyWorkbenchEnvironment,
  migrateLegacyWorkbenchDirectory,
} from '../../workbench/src/environment.js';

const args = process.argv.slice(2);
declare const __GRAPH_WORKBENCH_PACKAGED__: boolean;
declare const __GRAPH_WORKBENCH_VERSION__: string;
const packagedDistribution = typeof __GRAPH_WORKBENCH_PACKAGED__ !== 'undefined' && __GRAPH_WORKBENCH_PACKAGED__;
const graphWorkbenchVersion = typeof __GRAPH_WORKBENCH_VERSION__ === 'undefined' ? 'development' : __GRAPH_WORKBENCH_VERSION__;
applyLegacyWorkbenchEnvironment();

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

function booleanAssignments(flag: string): Record<string, boolean> {
  const values = assignments(flag);
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'boolean') throw new Error(`${flag} expects ${key}=true or ${key}=false.`);
  }
  return values as Record<string, boolean>;
}

async function toolAuthorizer() {
  const policyPath = valueAfter('--policy');
  const policy = policyPath
    ? parseToolPolicy(JSON.parse(await readFile(resolve(policyPath), 'utf8')) as unknown)
    : defaultToolPolicy;
  return createPolicyToolAuthorizer(policy);
}

type ClosableRunStore = RunStore & { close(): void | Promise<void> };

function isPostgresTarget(target: string): boolean {
  return /^postgres(?:ql)?:\/\//i.test(target);
}

function openRunStore(target: string): ClosableRunStore {
  return isPostgresTarget(target)
    ? new PostgresRunStore(target)
    : new SQLiteRunStore(resolve(target));
}

function postgresTarget(): string {
  const target = valueAfter('--database') ?? process.env.GRAPH_WORKBENCH_POSTGRES_URL;
  if (!target || !isPostgresTarget(target)) {
    throw new Error('Distributed execution requires a PostgreSQL URL via --database or GRAPH_WORKBENCH_POSTGRES_URL.');
  }
  return target;
}

function usage(): string {
  return [
    'Graph Workbench',
    '',
    'Usage:',
    '  graph-workbench workbench [--port 4311] [--policy .graph-workbench/policy.json] [--no-open]',
    '  graph-workbench demo [--pause]',
    '  graph-workbench audit export --database <runs.sqlite-or-postgres-url> --run <run-id> [--output run.audit.json]',
    '  graph-workbench audit verify <run.audit.json>',
    '  graph-workbench pack init <pack-id> [directory]',
    '  graph-workbench pack validate [module-or-json]',
    '  graph-workbench pack inspect [module-or-json-or-gpack]',
    '  graph-workbench pack test [module] [--fixture fixture-id]',
    '  graph-workbench pack demo [module] [--fixture fixture-id]',
    `  graph-workbench pack build <module> [--output pack.gpack] [--engine ^${GRAPH_WORKBENCH_ENGINE_VERSION}]`,
    '  graph-workbench pack install <pack.gpack> --trust [--root .graph-workbench/packs]',
    '  graph-workbench pack registry build <release.json> --artifact-base-url https://... [--output-dir registry-dist]',
    '  graph-workbench pack registry sign <payload.json> --key-id publisher --private-key key.pem --output registry.json',
    '  graph-workbench pack registry verify <registry.json-or-url> --key publisher=public.pem [--allow-http]',
    '  graph-workbench pack registry install <pack-id>@<version> --registry https://... --key publisher=public.pem',
    '  graph-workbench pack list [--root .graph-workbench/packs]',
    '  graph-workbench pack activate <pack-id>@<version> [--root .graph-workbench/packs]',
    '  graph-workbench pack rollback <pack-id> [--root .graph-workbench/packs]',
    '  graph-workbench pack uninstall <pack-id> [--version 0.1.0] [--root .graph-workbench/packs]',
    '  graph-workbench pack run <module> --set topic=hello [--decision approval=true] [--policy policy.json] [--database runs.sqlite]',
    '  graph-workbench pack enqueue <module-or-pack-id> --database <postgres-url> --set topic=hello [--installed]',
    '  graph-workbench pack run <pack-id> --installed --set topic=hello [--root .graph-workbench/packs]',
    '  graph-workbench pack resume <module-or-pack-id> --run <run-id> --database runs.sqlite [--tool-approval id=true] [--installed]',
    '  graph-workbench worker start <module-or-pack-id> --database <postgres-url> [--concurrency 4] [--installed] [--container]',
    '  graph-workbench pack schema [output.json]',
    '',
    'Repeat --set/--decision/--permission for more values. --input/--decisions also accept JSON or @file.json.',
    'Installed Pack execution uses a network-denied container by default. --unsafe-process-isolation is only for reviewed development fixtures.',
    'Executable local .gpack artifacts require explicit --trust. Signed registries require a configured publisher key.',
  ].join('\n');
}

function printEvent(event: GraphEvent): void {
  console.log(`${String(event.seq).padStart(2, '0')}  ${event.type}${event.nodeId ? ` ${event.nodeId}` : ''}`);
}

async function demo(): Promise<void> {
  const pauseForApproval = args.includes('--pause');
  const compiledPack = compilePack(softwareDeliveryPack);
  const graph = compiledPack.graphs.get('software_delivery.change_to_release');
  if (!graph) throw new Error('Software Delivery workflow was not compiled.');
  const fixture = softwareDeliveryPack.fixtures.find((item) => item.id === 'standard_feature_release');
  if (!fixture) throw new Error('Software Delivery sample fixture is missing.');

  console.log(`Pack: ${compiledPack.manifest.name} v${compiledPack.manifest.version}`);
  console.log(`Graph: ${graph.definition.name}`);
  console.log(`Mode: ${pauseForApproval ? 'pause at human gate' : 'approve and finish'}\n`);
  const runtime = new GraphRuntime(graph, {
    handlers: softwareDeliveryHandlers,
    pack: compiledPack.manifest,
  });
  const result = await runtime.run(
    fixture.input,
    {
      ...(pauseForApproval ? {} : { decisions: fixture.decisions }),
      onEvent: printEvent,
    },
  );

  console.log('');
  if (result.status === 'completed') {
    const contextGraph = new InMemoryContextGraphStore(compiledPack.manifest);
    await projectSoftwareDeliveryRun(contextGraph, result);
    const deliverableField = compiledPack.manifest.deliverables.find((item) => item.graphId === graph.definition.id)?.stateField;
    console.log(String((deliverableField ? result.state[deliverableField] : undefined) ?? result.state.rejection_reason));
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

async function auditCommand(): Promise<void> {
  const action = args[1];
  if (action === 'verify') {
    const subject = args[2];
    if (!subject) throw new Error('Audit verification requires a bundle path.');
    const bundle = verifyRunAuditBundle(JSON.parse(await readFile(resolve(subject), 'utf8')) as unknown);
    console.log(`✓ Verified audit bundle for ${bundle.run.runId}`);
    console.log(`  SHA-256 ${bundle.integrity.digest}`);
    console.log(`  ${bundle.events.length} event(s)`);
    return;
  }
  if (action === 'export') {
    const databasePath = valueAfter('--database');
    const runId = valueAfter('--run');
    if (!databasePath || !runId) throw new Error('Audit export requires --database and --run.');
    const store = openRunStore(databasePath);
    try {
      const run = await store.getRun(runId);
      if (!run) throw new Error(`Run "${runId}" does not exist.`);
      const [events, checkpoint] = await Promise.all([
        store.listEvents(runId),
        store.getCheckpoint(runId),
      ]);
      const bundle = createRunAuditBundle({
        run,
        events,
        ...(checkpoint ? { checkpoint } : {}),
      });
      const output = resolve(valueAfter('--output') ?? `${runId}.audit.json`);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      console.log(`✓ Exported audit bundle for ${runId}`);
      console.log(`  ${output}`);
      console.log(`  SHA-256 ${bundle.integrity.digest}`);
    } finally {
      await store.close();
    }
    return;
  }
  throw new Error(`Unknown audit command "${action ?? ''}".\n\n${usage()}`);
}

async function workbench(): Promise<void> {
  const port = Number(valueAfter('--port') ?? 4311);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Workbench port must be an integer between 1 and 65535.');
  const workspace = process.cwd();
  await migrateLegacyWorkbenchDirectory(workspace);
  process.env.GRAPH_WORKBENCH_PORT = String(port);
  process.env.GRAPH_WORKBENCH_DATA ??= resolve(workspace, '.graph-workbench/workbench.json');
  process.env.GRAPH_WORKBENCH_PACKS ??= resolve(workspace, '.graph-workbench/packs');
  process.env.GRAPH_WORKBENCH_TRUST ??= resolve(workspace, '.graph-workbench/trust.json');
  const policyPath = valueAfter('--policy');
  if (policyPath) process.env.GRAPH_WORKBENCH_POLICY = resolve(policyPath);
  process.env.GRAPH_WORKBENCH_OPEN = args.includes('--no-open') ? 'false' : 'true';
  const server = packagedDistribution
    ? new URL('./workbench-server.mjs', import.meta.url)
    : new URL('../../workbench/src/server.ts', import.meta.url);
  await import(server.href);
}

async function resolvePack(path: string | undefined) {
  if (!path) return { pack: researchPack, handlers: researchHandlers, source: 'built-in:research' };
  return loadPackModule(path);
}

async function resolveRunnablePack(subject: string) {
  if (!args.includes('--installed') && subject === 'research') {
    return { pack: researchPack, handlers: researchHandlers, source: 'built-in:research' };
  }
  return args.includes('--installed')
    ? loadInstalledPackIsolated(subject, valueAfter('--root'), isolationPolicy())
    : loadPackModule(subject);
}

function isolationPolicy(): IsolatedPackPolicy {
  if (args.includes('--unsafe-process-isolation')) {
    if (args.includes('--container')) throw new Error('--unsafe-process-isolation cannot be combined with --container.');
    return {
      unsafeProcessIsolation: true,
      allowNetwork: args.includes('--allow-network'),
    };
  }
  const runtime = valueAfter('--container-runtime') ?? 'docker';
  if (runtime !== 'docker' && runtime !== 'podman') throw new Error('--container-runtime must be docker or podman.');
  return {
    allowNetwork: args.includes('--allow-network'),
    container: {
      runtime,
      image: valueAfter('--container-image') ?? 'node:24-alpine',
      network: valueAfter('--container-network') ?? 'none',
    },
  };
}

async function trustedRegistryKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const value of valuesAfter('--key')) {
    const separator = value.indexOf('=');
    if (separator < 1) throw new Error('--key expects <key-id>=<public-key.pem>.');
    const id = value.slice(0, separator);
    const path = value.slice(separator + 1);
    keys[id] = await readFile(resolve(path), 'utf8');
  }
  if (Object.keys(keys).length === 0) throw new Error('At least one trusted publisher --key is required.');
  return keys;
}

async function registryCommand(): Promise<void> {
  const action = args[2];
  const subject = args[3];
  if (action === 'build') {
    if (!subject) throw new Error('Missing Registry release config path.');
    const artifactBaseUrl = valueAfter('--artifact-base-url');
    if (!artifactBaseUrl) throw new Error('Registry build requires --artifact-base-url <https-url>.');
    const outputDirectory = resolve(valueAfter('--output-dir') ?? 'registry-dist');
    const expiresInDays = Number(valueAfter('--expires-in-days') ?? 30);
    const configPath = resolve(subject);
    const release = await buildPackRegistryRelease(
      JSON.parse(await readFile(configPath, 'utf8')) as unknown,
      {
        configDirectory: dirname(configPath),
        outputDirectory,
        artifactBaseUrl,
        expiresInDays,
      },
    );
    const payloadPath = resolve(valueAfter('--output') ?? resolve(outputDirectory, 'registry-payload.json'));
    await mkdir(dirname(payloadPath), { recursive: true });
    await writeFile(payloadPath, `${JSON.stringify(release.payload, null, 2)}\n`, 'utf8');
    console.log(`✓ Built Registry payload ${release.payload.registry.id}`);
    console.log(`  Packs: ${release.artifacts.length}`);
    console.log(`  ${payloadPath}`);
    return;
  }
  if (action === 'sign') {
    if (!subject) throw new Error('Missing registry payload JSON path.');
    const keyId = valueAfter('--key-id');
    const privateKeyPath = valueAfter('--private-key');
    const output = valueAfter('--output');
    if (!keyId || !privateKeyPath || !output) {
      throw new Error('Registry signing requires --key-id, --private-key and --output.');
    }
    const payload = JSON.parse(await readFile(resolve(subject), 'utf8')) as Parameters<typeof signPackRegistry>[0];
    const signed = signPackRegistry(payload, keyId, await readFile(resolve(privateKeyPath), 'utf8'));
    await writeFile(resolve(output), `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
    console.log(`✓ Signed registry ${signed.payload.registry.id} with ${signed.signature.keyId}`);
    console.log(`  ${resolve(output)}`);
    return;
  }
  if (action === 'verify') {
    if (!subject) throw new Error('Missing registry JSON path or URL.');
    const trustedKeys = await trustedRegistryKeys();
    const verified = /^https?:\/\//i.test(subject)
      ? await fetchSignedPackRegistry(subject, { trustedKeys, allowInsecureHttp: args.includes('--allow-http') })
      : verifySignedPackRegistry(JSON.parse(await readFile(resolve(subject), 'utf8')) as unknown, { trustedKeys });
    console.log(`✓ Verified ${verified.payload.registry.name}`);
    console.log(`  Publisher: ${verified.publisherKeyId}`);
    console.log(`  Packs: ${verified.payload.packs.length}`);
    console.log(`  Expires: ${verified.payload.expiresAt}`);
    return;
  }
  if (action === 'install') {
    if (!subject) throw new Error('Expected <pack-id>@<version>.');
    const separator = subject.lastIndexOf('@');
    if (separator < 1) throw new Error('Expected <pack-id>@<version>.');
    const registry = valueAfter('--registry');
    if (!registry) throw new Error('Signed registry installation requires --registry <url>.');
    const trustedKeys = await trustedRegistryKeys();
    const root = valueAfter('--root');
    const installed = await installPackFromSignedRegistry(
      registry,
      subject.slice(0, separator),
      subject.slice(separator + 1),
      {
        trustedKeys,
        allowInsecureHttp: args.includes('--allow-http'),
        ...(root ? { root } : {}),
        activate: !args.includes('--no-activate'),
      },
    );
    console.log(`✓ Installed signed Pack ${subject}`);
    console.log(`  Publisher: ${installed.trustSource?.mode === 'signed-registry' ? installed.trustSource.publisherKeyId : 'unknown'}`);
    return;
  }
  throw new Error(`Unknown registry command "${action ?? ''}".\n\n${usage()}`);
}

async function packCommand(): Promise<void> {
  const action = args[1];
  const subject = args[2];
  if (action === 'registry') return registryCommand();
  if (action === 'validate') {
    const loaded = await resolvePack(subject);
    const compiled = compilePack(loaded.pack);
    const handlerCoverage = validatePackHandlerCoverage(loaded.pack, loaded.handlers);
    console.log(`✓ ${compiled.manifest.id}@${compiled.manifest.version} is valid (${loaded.source})`);
    console.log(`  ${compiled.graphs.size} graph(s), ${compiled.manifest.ontology.objectTypes.length} context object type(s)`);
    console.log(`  ${handlerCoverage.required.length} executable handler binding(s)`);
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
    if (!subject) throw new Error('Missing pack id. Example: graph-workbench pack init customer-success');
    const directory = args[3] ?? resolve('packs', subject);
    const result = await scaffoldPack(subject, directory, { standalone: packagedDistribution });
    console.log(`✓ Created ${result.id} at ${result.directory}`);
    for (const file of result.files) console.log(`  ${file}`);
    const sourceFile = result.files.find((file) => file.startsWith('src/index.'))!;
    const modulePath = relative(process.cwd(), resolve(result.directory, sourceFile)).replaceAll('\\', '/');
    const runner = packagedDistribution ? 'npx graph-workbench' : 'pnpm graph-workbench';
    console.log(`\nNext: ${runner} pack test "${modulePath}"`);
    console.log(`Then: ${runner} pack run "${modulePath}" --set topic=hello`);
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
  if (action === 'enqueue') {
    if (!subject) throw new Error('Missing Pack module path or installed Pack id.');
    const loaded = await resolveRunnablePack(subject);
    const compiled = compilePack(loaded.pack);
    const graphId = valueAfter('--graph') ?? compiled.manifest.graphs[0]?.id;
    const graph = graphId ? compiled.graphs.get(graphId) : undefined;
    if (!graph) throw new Error(`Graph "${graphId ?? ''}" does not exist in Pack "${compiled.manifest.id}".`);
    const queue = new PostgresRunQueue(postgresTarget(), {
      queueName: valueAfter('--queue-name') ?? 'graph-workbench-runs',
    });
    const runId = valueAfter('--run-id') ?? `run-${randomUUID()}`;
    try {
      const jobId = await queue.enqueue({
        formatVersion: 1,
        runId,
        packId: compiled.manifest.id,
        graphId: graph.definition.id,
        graphVersion: graph.definition.version,
        input: {
          ...await recordInput(valueAfter('--input'), '--input'),
          ...assignments('--set'),
        },
        submittedAt: new Date().toISOString(),
      });
      console.log(`✓ Enqueued ${runId}`);
      console.log(`  Job: ${jobId}`);
      console.log(`  Queue: ${queue.queueName}`);
    } finally {
      await queue.close();
    }
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
    const store = databasePath ? openRunStore(databasePath) : undefined;
    try {
      const runId = valueAfter('--run-id');
      const result = await new GraphRuntime(graph, {
        handlers: loaded.handlers,
        pack: compiled.manifest,
        authorizeTool: await toolAuthorizer(),
      }).run(input, {
        decisions,
        toolApprovals: booleanAssignments('--tool-approval'),
        onEvent: printEvent,
        ...(runId ? { runId } : {}),
        ...(store ? { store } : {}),
      });
      console.log(JSON.stringify({ status: result.status, runId: result.runId, state: result.state }, null, 2));
      if (result.status === 'failed') throw result.error;
    } finally {
      await store?.close();
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
    const store = openRunStore(databasePath);
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
        authorizeTool: await toolAuthorizer(),
      }).resumeStored(runId, store, {
        decisions,
        toolApprovals: booleanAssignments('--tool-approval'),
        onEvent: printEvent,
      });
      console.log(JSON.stringify({ status: result.status, runId: result.runId, state: result.state }, null, 2));
      if (result.status === 'failed') throw result.error;
    } finally {
      await store.close();
    }
    return;
  }
  throw new Error(`Unknown pack command "${action ?? ''}".\n\n${usage()}`);
}

async function workerCommand(): Promise<void> {
  const action = args[1];
  const subject = args[2];
  if (action !== 'start' || !subject) throw new Error(`Worker requires start <module-or-pack-id>.\n\n${usage()}`);
  const loaded = await resolveRunnablePack(subject);
  const compiled = compilePack(loaded.pack);
  const database = postgresTarget();
  const concurrency = Number(valueAfter('--concurrency') ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error('Worker concurrency must be an integer between 1 and 64.');
  }
  const store = new PostgresRunStore(database);
  const queue = new PostgresRunQueue(database, {
    queueName: valueAfter('--queue-name') ?? 'graph-workbench-runs',
  });
  const authorizeTool = await toolAuthorizer();
  try {
    await queue.work(async (request) => {
      if (request.packId !== compiled.manifest.id) {
        throw new Error(`Worker for Pack "${compiled.manifest.id}" cannot execute Pack "${request.packId}".`);
      }
      const graph = compiled.graphs.get(request.graphId);
      if (!graph || graph.definition.version !== request.graphVersion) {
        throw new Error(`Worker does not have graph "${request.graphId}" version ${request.graphVersion}.`);
      }
      const runtime = new GraphRuntime(graph, {
        handlers: loaded.handlers,
        pack: compiled.manifest,
        authorizeTool,
      });
      const existing = await store.getRun(request.runId);
      if (existing && ['completed', 'paused', 'cancelled'].includes(existing.status)) {
        return { runId: existing.runId, status: existing.status };
      }
      const result = existing
        ? await runtime.resumeStored(request.runId, store)
        : await runtime.run(request.input, { runId: request.runId, store });
      if (result.status === 'failed') throw result.error;
      return { runId: result.runId, status: result.status };
    }, { concurrency });
    console.log(`✓ Worker ready for ${compiled.manifest.id}@${compiled.manifest.version}`);
    console.log(`  Queue: ${queue.queueName}`);
    console.log(`  Concurrency: ${concurrency}`);
    console.log('  Press Ctrl+C to stop gracefully.');
    await new Promise<void>((resolveShutdown) => {
      process.once('SIGINT', resolveShutdown);
      process.once('SIGTERM', resolveShutdown);
    });
  } finally {
    await queue.close();
    await store.close();
  }
}

async function main(): Promise<void> {
  const command = args[0] ?? (packagedDistribution ? 'workbench' : 'demo');
  if (command === 'workbench') return workbench();
  if (command === 'demo') return demo();
  if (command === 'audit') return auditCommand();
  if (command === 'pack') return packCommand();
  if (command === 'worker') return workerCommand();
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(graphWorkbenchVersion);
    return;
  }
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
