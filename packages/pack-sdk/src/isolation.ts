import { randomUUID } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ContextObject, ContextRelation, GraphNode } from '@graphwork/contracts';
import type { ContextGraphStore, GraphState, HandlerRegistry } from '@graphwork/core';
import { inspectInstalledPack, type InstalledPackFiles } from './package.js';

const workerPath = fileURLToPath(new URL('./isolated-worker.mjs', import.meta.url));

export interface IsolatedPackPolicy {
  readonly filesystemRead?: readonly string[];
  readonly filesystemWrite?: readonly string[];
  readonly allowChildProcess?: boolean;
  readonly allowNetwork?: boolean;
  readonly environment?: Readonly<Record<string, string>>;
  readonly maxExecutionMs?: number;
  /**
   * Runs executable Pack code as the current OS user. This is only for reviewed
   * development fixtures; Node's permission model is not a malicious-code sandbox.
   */
  readonly unsafeProcessIsolation?: boolean;
  readonly container?: {
    readonly runtime?: 'docker' | 'podman';
    readonly image?: string;
    readonly network?: string;
    readonly memoryMb?: number;
    readonly cpus?: number;
    readonly pidsLimit?: number;
  };
}

export interface IsolatedInstalledPack extends InstalledPackFiles {
  readonly handlers: HandlerRegistry;
  readonly isolated: true;
  readonly isolationMode: 'container' | 'unsafe-process';
  readonly projector?: (
    store: ContextGraphStore,
    run: { readonly runId: string; readonly state: GraphState },
  ) => Promise<void>;
}

interface WorkerResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

function permissionArguments(entry: string, policy: IsolatedPackPolicy): string[] {
  const args = [
    '--permission',
    `--allow-fs-read=${dirname(entry)}`,
    `--allow-fs-read=${dirname(workerPath)}`,
  ];
  for (const path of policy.filesystemRead ?? []) args.push(`--allow-fs-read=${resolve(path)}`);
  for (const path of policy.filesystemWrite ?? []) args.push(`--allow-fs-write=${resolve(path)}`);
  if (policy.allowChildProcess) args.push('--allow-child-process');
  if (policy.allowNetwork && process.allowedNodeEnvironmentFlags.has('--allow-net')) args.push('--allow-net');
  return args;
}

export interface ContainerIsolationCommand {
  readonly command: 'docker' | 'podman';
  readonly args: readonly string[];
  readonly environmentKeys: readonly string[];
}

export function createContainerIsolationCommand(
  entry: string,
  policy: IsolatedPackPolicy,
  nonce: string = randomUUID(),
): ContainerIsolationCommand {
  const container = policy.container;
  if (!container) throw new Error('Container isolation configuration is required.');
  if ((policy.filesystemRead?.length ?? 0) > 0 || (policy.filesystemWrite?.length ?? 0) > 0) {
    throw new Error('Container isolation does not accept host filesystem roots; package required files inside the Pack artifact.');
  }
  if (policy.allowChildProcess) throw new Error('Container-isolated Packs cannot request child-process access.');
  const image = container.image ?? 'node:24-alpine';
  const network = container.network ?? 'none';
  const memoryMb = container.memoryMb ?? 256;
  const cpus = container.cpus ?? 1;
  const pidsLimit = container.pidsLimit ?? 64;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/.test(image)) throw new Error('Container image is invalid.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network)) throw new Error('Container network is invalid.');
  if (network !== 'none' && !policy.allowNetwork) {
    throw new Error('Container network access requires allowNetwork approval.');
  }
  if (!Number.isInteger(memoryMb) || memoryMb < 64 || memoryMb > 4096) {
    throw new Error('Container memoryMb must be an integer between 64 and 4096.');
  }
  if (!Number.isFinite(cpus) || cpus < 0.1 || cpus > 16) {
    throw new Error('Container cpus must be between 0.1 and 16.');
  }
  if (!Number.isInteger(pidsLimit) || pidsLimit < 16 || pidsLimit > 1024) {
    throw new Error('Container pidsLimit must be an integer between 16 and 1024.');
  }
  const environmentKeys = Object.keys(policy.environment ?? {});
  if (environmentKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new Error('Container environment variable names must be valid identifiers.');
  }
  const packDirectory = dirname(resolve(entry));
  const args = [
    'run', '--rm', '--interactive',
    `--name=graphwork-pack-${nonce}`,
    `--network=${network}`,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=65532:65532',
    `--memory=${memoryMb}m`,
    `--cpus=${cpus}`,
    `--pids-limit=${pidsLimit}`,
    '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
    `--volume=${resolve(workerPath)}:/graphwork/isolated-worker.mjs:ro`,
    `--volume=${packDirectory}:/graphwork/pack:ro`,
    ...environmentKeys.flatMap((key) => ['--env', key]),
    image,
    'node', '--permission',
    '--allow-fs-read=/graphwork',
    '/graphwork/isolated-worker.mjs',
  ];
  return { command: container.runtime ?? 'docker', args, environmentKeys };
}

function executionLimit(policy: IsolatedPackPolicy): number {
  const maximum = policy.maxExecutionMs ?? 30_000;
  if (!Number.isFinite(maximum) || maximum < 1 || maximum > 5 * 60_000) {
    throw new Error('Isolated Pack maxExecutionMs must be between 1 and 300000.');
  }
  return maximum;
}

function runContainerWorker(
  entry: string,
  request: Record<string, unknown>,
  policy: IsolatedPackPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  const invocation = createContainerIsolationCommand(entry, policy);
  const maximum = executionLimit(policy);
  const containerEntry = `/graphwork/pack/${basename(entry)}`;
  const payload = JSON.stringify({ ...request, entry: `file://${containerEntry}`, nonce: randomUUID() });
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(invocation.command, [...invocation.args], {
      env: { ...process.env, ...policy.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timeout = setTimeout(() => finish(new Error(`Isolated Pack container exceeded ${maximum}ms.`)), maximum);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolvePromise(value);
    };
    const cancel = () => finish(new Error('Isolated Pack container was cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString('utf8').slice(0, 4 * 1024 * 1024 - stdout.length);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length);
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signalName) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(`Isolated Pack container exited (${signalName ?? code ?? 'unknown'}).${stderr.trim() ? ` ${stderr.trim()}` : ''}`));
        return;
      }
      try {
        const response = JSON.parse(stdout) as WorkerResponse;
        if (!response.ok) finish(new Error(response.error ?? 'Isolated Pack container failed.'));
        else finish(undefined, response.result);
      } catch {
        finish(new Error('Isolated Pack container returned an invalid response.'));
      }
    });
    child.stdin.end(payload);
  });
}

function runWorker(
  entry: string,
  request: Record<string, unknown>,
  policy: IsolatedPackPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new Error('Isolated Pack worker was cancelled.'));
  if (policy.container) return runContainerWorker(entry, request, policy, signal);
  if (!policy.unsafeProcessIsolation) {
    return Promise.reject(new Error(
      'Third-party Pack execution requires container isolation. ' +
      'Use unsafeProcessIsolation only for reviewed development fixtures.',
    ));
  }
  const maximum = executionLimit(policy);
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stderr = '';
    const child = fork(workerPath, [], {
      cwd: dirname(entry),
      env: { NODE_ENV: 'production', ...policy.environment },
      execArgv: ['--max-old-space-size=128', ...permissionArguments(entry, policy)],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const timeout = setTimeout(() => {
      finish(new Error(`Isolated Pack worker exceeded ${maximum}ms.`));
    }, maximum);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      const complete = () => {
        if (error) reject(error);
        else resolvePromise(value);
      };
      if (child.exitCode !== null || child.signalCode !== null) {
        complete();
        return;
      }
      child.once('exit', complete);
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill();
    };
    const cancel = () => finish(new Error('Isolated Pack worker was cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length);
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signalName) => {
      if (!settled) {
        const detail = stderr.trim() ? ` ${stderr.trim()}` : '';
        finish(new Error(`Isolated Pack worker exited (${signalName ?? code ?? 'unknown'}).${detail}`));
      }
    });
    child.once('message', (message: WorkerResponse) => {
      if (!message.ok) finish(new Error(message.error ?? 'Isolated Pack worker failed.'));
      else finish(undefined, message.result);
    });
    child.send({ ...request, entry: pathToFileURL(entry).href, nonce: randomUUID() });
  });
}

function assertPolicy(inspected: InstalledPackFiles, policy: IsolatedPackPolicy): void {
  const permissions = inspected.descriptor.permissions;
  if (permissions.includes('network') && !policy.allowNetwork) {
    throw new Error('Pack declares network access; isolated execution requires allowNetwork approval.');
  }
  if (policy.container?.network && policy.container.network !== 'none' && !policy.allowNetwork) {
    throw new Error('Container network access requires allowNetwork approval.');
  }
  if (policy.container?.network && policy.container.network !== 'none' && !permissions.includes('network')) {
    throw new Error('Container network access requires the Pack to declare network permission.');
  }
  if (policy.container && permissions.includes('filesystem')) {
    throw new Error('Container-isolated Packs must package required files inside the signed artifact.');
  }
  if (
    permissions.includes('filesystem')
    && (policy.filesystemRead?.length ?? 0) === 0
    && (policy.filesystemWrite?.length ?? 0) === 0
  ) {
    throw new Error('Pack declares filesystem access; isolated execution requires explicit filesystem roots.');
  }
}

export async function loadInstalledPackIsolated(
  id: string,
  root = '.graphwork/packs',
  policy: IsolatedPackPolicy = { container: {} },
): Promise<IsolatedInstalledPack> {
  const effectivePolicy = policy.container || policy.unsafeProcessIsolation
    ? policy
    : { ...policy, container: {} };
  const inspected = await inspectInstalledPack(id, root);
  assertPolicy(inspected, effectivePolicy);
  const handlerIds = new Set(
    inspected.pack.graphs.flatMap((graph) => graph.nodes.map((node) => node.handler).filter(Boolean)),
  );
  const handlers = Object.fromEntries([...handlerIds].map((handlerId) => [handlerId, async (context: {
    readonly runId: string;
    readonly node: GraphNode;
    readonly state: Readonly<GraphState>;
    readonly signal: AbortSignal;
  }) => runWorker(inspected.source, {
    operation: 'handler',
    handlerId,
    context: { runId: context.runId, node: context.node, state: context.state },
  }, effectivePolicy, context.signal) as Promise<GraphState>]));
  const hasProjector = inspected.descriptor.permissions.includes('context.write');
  return {
    ...inspected,
    handlers,
    isolated: true,
    isolationMode: effectivePolicy.container ? 'container' : 'unsafe-process',
    ...(hasProjector ? {
      projector: async (
        store: ContextGraphStore,
        run: { readonly runId: string; readonly state: GraphState },
      ) => {
        const projection = await runWorker(inspected.source, { operation: 'projector', run }, effectivePolicy) as {
          readonly objects: readonly ContextObject[];
          readonly relations: readonly ContextRelation[];
        };
        for (const object of projection.objects) await store.appendObject(object);
        for (const relation of projection.relations) await store.appendRelation(relation);
      },
    } : {}),
  };
}
