import { createReadStream } from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inspectPackArtifact, installPackArtifact } from '@graph-workbench/pack-sdk';
import { defaultToolPolicy, parseToolPolicy, type ToolPolicy } from '@graph-workbench/core';
import { bundledPackCatalog, discoverInstalledPackRuntimes } from './catalog.js';
import { WorkbenchService } from './service.js';
import { WorkbenchRegistryService } from './registry-service.js';
import {
  applyWorkbenchSecurityHeaders,
  createWorkbenchHttpSecurity,
  enforceWorkbenchRequestSecurity,
  HttpSecurityError,
  requireContentType,
} from './http-security.js';
import {
  applyLegacyWorkbenchEnvironment,
  migrateLegacyWorkbenchDirectory,
} from './environment.js';

const appDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const workspaceDirectory = resolve(appDirectory, '..', '..');
applyLegacyWorkbenchEnvironment();
await migrateLegacyWorkbenchDirectory(workspaceDirectory);
const port = Number(process.env.GRAPH_WORKBENCH_PORT ?? 4310);
const host = process.env.GRAPH_WORKBENCH_HOST ?? '127.0.0.1';
const dataFile = process.env.GRAPH_WORKBENCH_DATA
  ?? resolve(workspaceDirectory, '.graph-workbench/workbench.json');
const packRoot = process.env.GRAPH_WORKBENCH_PACKS
  ?? resolve(workspaceDirectory, '.graph-workbench/packs');
const trustFile = process.env.GRAPH_WORKBENCH_TRUST
  ?? resolve(workspaceDirectory, '.graph-workbench/trust.json');
const policyFile = process.env.GRAPH_WORKBENCH_POLICY
  ?? resolve(workspaceDirectory, '.graph-workbench/policy.json');
const httpSecurity = createWorkbenchHttpSecurity(host, process.env.GRAPH_WORKBENCH_AUTH_TOKEN);
const discovery = await discoverInstalledPackRuntimes(packRoot);
const service = new WorkbenchService({ dataFile, toolPolicy: await loadToolPolicy(policyFile) });
const registryService = await WorkbenchRegistryService.fromConfigFile(trustFile, packRoot);
const clientDirectory = resolve(appDirectory, 'dist/client');

async function loadToolPolicy(path: string): Promise<ToolPolicy> {
  try {
    return parseToolPolicy(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultToolPolicy;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid tool policy at ${path}: ${message}`);
  }
}

const mediaTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  requireContentType(request, ['application/json']);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error('Request body exceeds 2 MB.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
}

async function artifactBody(request: IncomingMessage): Promise<Buffer> {
  requireContentType(request, [
    'application/vnd.graph-workbench.gpack',
    'application/vnd.graphwork.gpack',
    'application/octet-stream',
  ]);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 25 * 1024 * 1024) throw new Error('Pack artifact exceeds the 25 MB limit.');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('Pack artifact is empty.');
  return Buffer.concat(chunks);
}

async function withTemporaryArtifact<T>(request: IncomingMessage, operation: (path: string) => Promise<T> | T): Promise<T> {
  const temporary = resolve(tmpdir(), `graph-workbench-${randomUUID()}.gpack`);
  await writeFile(temporary, await artifactBody(request));
  try {
    return await operation(temporary);
  } finally {
    await rm(temporary, { force: true });
  }
}

function artifactPreview(filePath: string) {
  const inspection = inspectPackArtifact(filePath);
  return {
    id: inspection.manifest.id,
    name: inspection.manifest.name,
    version: inspection.manifest.version,
    description: inspection.manifest.description,
    license: inspection.manifest.license,
    bytes: inspection.bytes,
    checksum: inspection.checksum,
    compatible: inspection.compatible,
    compatibilityCode: inspection.compatibility.code,
    compatibilityMessage: inspection.compatibility.message,
    engineRange: inspection.descriptor.engine['graph-workbench'],
    permissions: inspection.descriptor.permissions,
  };
}

async function api(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (request.method === 'GET' && pathname === '/api/health') {
    json(response, 200, { status: 'ok' });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/workbench') {
    json(response, 200, service.describeWorkbench());
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/model-provider') {
    const payload = await body(request) as {
      providerId?: unknown;
      model?: unknown;
      baseUrl?: unknown;
    };
    if (typeof payload.providerId !== 'string' || typeof payload.model !== 'string') {
      throw new Error('Model provider configuration requires providerId and model.');
    }
    json(response, 200, service.configureModelProvider({
      providerId: payload.providerId,
      model: payload.model,
      ...(typeof payload.baseUrl === 'string' && payload.baseUrl.trim()
        ? { baseUrl: payload.baseUrl }
        : {}),
    }));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/model-provider/test') {
    json(response, 200, await service.testModelProvider());
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/registries') {
    json(response, 200, await registryService.catalog());
    return true;
  }
  const registryInstall = pathname.match(/^\/api\/registries\/([^/]+)\/packs\/([^/]+)\/([^/]+)\/install$/);
  if (request.method === 'POST' && registryInstall) {
    const registryId = decodeURIComponent(registryInstall[1]!);
    const packId = decodeURIComponent(registryInstall[2]!);
    const version = decodeURIComponent(registryInstall[3]!);
    await registryService.install(registryId, packId, version);
    const refreshed = await discoverInstalledPackRuntimes(packRoot);
    const runtime = bundledPackCatalog.get(packId);
    if (!runtime || runtime.manifest.version !== version) {
      throw new Error(refreshed.errors.find((error) => error.includes(packId))
        ?? `Installed Pack "${packId}@${version}" could not be loaded.`);
    }
    service.install(packId);
    json(response, 201, service.activate(packId));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/packs/artifact/inspect') {
    json(response, 200, await withTemporaryArtifact(request, artifactPreview));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/packs/artifact/install') {
    if (
      request.headers['x-graph-workbench-trust'] !== 'true'
      && request.headers['x-graphwork-trust'] !== 'true'
    ) {
      throw new Error('Executable Pack installation requires explicit trust confirmation.');
    }
    const next = await withTemporaryArtifact(request, async (filePath) => {
      const preview = artifactPreview(filePath);
      if (!preview.compatible) throw new Error(`Pack requires Graph Workbench ${preview.engineRange}.`);
      installPackArtifact(filePath, { root: packRoot, trust: true });
      const refreshed = await discoverInstalledPackRuntimes(packRoot);
      const runtime = bundledPackCatalog.get(preview.id);
      if (!runtime || runtime.manifest.version !== preview.version) {
        throw new Error(refreshed.errors.find((error) => error.includes(preview.id))
          ?? `Installed Pack "${preview.id}@${preview.version}" could not be loaded.`);
      }
      service.install(preview.id);
      return service.activate(preview.id);
    });
    json(response, 201, next);
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/pack') {
    json(response, 200, service.describePack());
    return true;
  }
  const pack = pathname.match(/^\/api\/packs\/([^/]+)$/);
  if (request.method === 'GET' && pack) {
    json(response, 200, service.describePack(decodeURIComponent(pack[1]!)));
    return true;
  }
  const install = pathname.match(/^\/api\/packs\/([^/]+)\/install$/);
  if (request.method === 'POST' && install) {
    json(response, 200, service.install(decodeURIComponent(install[1]!)));
    return true;
  }
  if (request.method === 'DELETE' && install) {
    json(response, 200, service.uninstall(decodeURIComponent(install[1]!)));
    return true;
  }
  const activate = pathname.match(/^\/api\/packs\/([^/]+)\/activate$/);
  if (request.method === 'POST' && activate) {
    json(response, 200, service.activate(decodeURIComponent(activate[1]!)));
    return true;
  }
  const draft = pathname.match(/^\/api\/packs\/([^/]+)\/graphs\/([^/]+)\/draft$/);
  if (request.method === 'PUT' && draft) {
    const payload = await body(request) as {
      graph?: Parameters<WorkbenchService['saveDraft']>[1];
      positions?: Parameters<WorkbenchService['saveDraft']>[2];
    };
    if (!payload.graph || !payload.positions) throw new Error('Draft requires graph and positions.');
    if (payload.graph.id !== decodeURIComponent(draft[2]!)) throw new Error('Graph id does not match the request path.');
    json(response, 200, service.saveDraft(decodeURIComponent(draft[1]!), payload.graph, payload.positions));
    return true;
  }
  if (request.method === 'DELETE' && draft) {
    json(response, 200, service.resetDraft(
      decodeURIComponent(draft[1]!),
      decodeURIComponent(draft[2]!),
    ));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/graphs/validate') {
    const payload = await body(request) as {
      packId?: string;
      graph?: Parameters<WorkbenchService['validateGraph']>[1];
    };
    if (!payload.packId || !payload.graph) throw new Error('Validation requires packId and graph.');
    json(response, 200, service.validateGraph(payload.packId, payload.graph));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/runs') {
    const payload = await body(request) as {
      input?: Record<string, unknown>;
      packId?: string;
      graphId?: string;
    };
    if (!payload.input) throw new Error('Request must include an input object.');
    json(response, 201, await service.start(payload.input, {
      ...(payload.packId ? { packId: payload.packId } : {}),
      ...(payload.graphId ? { graphId: payload.graphId } : {}),
    }));
    return true;
  }
  const decision = pathname.match(/^\/api\/runs\/([^/]+)\/decision$/);
  if (request.method === 'POST' && decision) {
    const payload = await body(request) as { approved?: unknown };
    if (typeof payload.approved !== 'boolean') throw new Error('Decision must include boolean approved.');
    json(response, 200, await service.decide(decodeURIComponent(decision[1]!), payload.approved));
    return true;
  }
  const audit = pathname.match(/^\/api\/runs\/([^/]+)\/audit$/);
  if (request.method === 'GET' && audit) {
    const runId = decodeURIComponent(audit[1]!);
    const bundle = service.exportAudit(runId);
    response.writeHead(200, {
      'content-type': 'application/vnd.graph-workbench.audit+json; charset=utf-8',
      'content-disposition': `attachment; filename="${runId}.audit.json"`,
      'cache-control': 'no-store',
    });
    response.end(`${JSON.stringify(bundle, null, 2)}\n`);
    return true;
  }
  const run = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === 'GET' && run) {
    const snapshot = service.get(decodeURIComponent(run[1]!));
    if (!snapshot) {
      json(response, 404, { error: 'Run not found.' });
    } else {
      json(response, 200, snapshot);
    }
    return true;
  }
  return false;
}

async function staticFile(response: ServerResponse, pathname: string): Promise<void> {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = resolve(clientDirectory, requested);
  if (!resolved.startsWith(clientDirectory)) {
    json(response, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    await access(resolved);
    response.writeHead(200, { 'content-type': mediaTypes[extname(resolved)] ?? 'application/octet-stream' });
    createReadStream(resolved).pipe(response);
  } catch {
    try {
      const index = await readFile(resolve(clientDirectory, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(index);
    } catch {
      json(response, 404, { error: 'Workbench client is not built. Run pnpm workbench for development.' });
    }
  }
}

function openWorkbench(url: string): void {
  const command = platform() === 'win32' ? 'explorer.exe' : platform() === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.once('error', () => undefined);
    child.unref();
  } catch {
    // The URL remains visible in the terminal when no desktop opener is available.
  }
}

const server = createServer(async (request, response) => {
  applyWorkbenchSecurityHeaders(response);
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    enforceWorkbenchRequestSecurity(request, url.pathname, httpSecurity);
    if (await api(request, response, url.pathname)) return;
    if (url.pathname.startsWith('/api/')) {
      json(response, 404, { error: 'API route not found.' });
      return;
    }
    await staticFile(response, url.pathname);
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    if (resolved instanceof HttpSecurityError && resolved.challenge) {
      response.setHeader('www-authenticate', 'Basic realm="Graph Workbench", charset="UTF-8"');
    }
    json(response, resolved instanceof HttpSecurityError ? resolved.status : 400, { error: resolved.message });
  }
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.maxHeadersCount = 100;
server.listen(port, host, () => {
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  console.log(`Graph Workbench: ${url}`);
  if (discovery.loaded > 0) console.log(`Loaded ${discovery.loaded} trusted Pack(s) from ${packRoot}`);
  for (const error of discovery.errors) console.warn(`Skipped installed Pack: ${error}`);
  if (process.env.GRAPH_WORKBENCH_OPEN === 'true') openWorkbench(url);
});
