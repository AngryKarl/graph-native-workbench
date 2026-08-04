import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ContextObject, ContextRelation, GraphNode } from '@graph-native/contracts';
import type { ContextGraphStore, GraphState, HandlerRegistry } from '@graph-native/core';
import { inspectInstalledPack, type InstalledPackFiles } from './package.js';

const workerPath = fileURLToPath(new URL('./isolated-worker.mjs', import.meta.url));

export interface IsolatedPackPolicy {
  readonly filesystemRead?: readonly string[];
  readonly filesystemWrite?: readonly string[];
  readonly allowChildProcess?: boolean;
  readonly allowNetwork?: boolean;
  readonly environment?: Readonly<Record<string, string>>;
  readonly maxExecutionMs?: number;
}

export interface IsolatedInstalledPack extends InstalledPackFiles {
  readonly handlers: HandlerRegistry;
  readonly isolated: true;
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
  return args;
}

function runWorker(
  entry: string,
  request: Record<string, unknown>,
  policy: IsolatedPackPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new Error('Isolated Pack worker was cancelled.'));
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
    const maximum = policy.maxExecutionMs ?? 30_000;
    if (!Number.isFinite(maximum) || maximum < 1 || maximum > 5 * 60_000) {
      child.kill();
      reject(new Error('Isolated Pack maxExecutionMs must be between 1 and 300000.'));
      return;
    }
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
  policy: IsolatedPackPolicy = {},
): Promise<IsolatedInstalledPack> {
  const inspected = await inspectInstalledPack(id, root);
  assertPolicy(inspected, policy);
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
  }, policy, context.signal) as Promise<GraphState>]));
  const hasProjector = inspected.descriptor.permissions.includes('context.write');
  return {
    ...inspected,
    handlers,
    isolated: true,
    ...(hasProjector ? {
      projector: async (
        store: ContextGraphStore,
        run: { readonly runId: string; readonly state: GraphState },
      ) => {
        const projection = await runWorker(inspected.source, { operation: 'projector', run }, policy) as {
          readonly objects: readonly ContextObject[];
          readonly relations: readonly ContextRelation[];
        };
        for (const object of projection.objects) await store.appendObject(object);
        for (const relation of projection.relations) await store.appendRelation(relation);
      },
    } : {}),
  };
}
