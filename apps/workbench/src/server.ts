import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbenchService } from './service.js';

const port = Number(process.env.GRAPH_WORKBENCH_PORT ?? 4310);
const service = new WorkbenchService();
const appDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const clientDirectory = resolve(appDirectory, 'dist/client');

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

async function api(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (request.method === 'GET' && pathname === '/api/pack') {
    json(response, 200, service.describePack());
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/runs') {
    const payload = await body(request) as { input?: Record<string, unknown> };
    if (!payload.input) throw new Error('Request must include an input object.');
    json(response, 201, await service.start(payload.input));
    return true;
  }
  const decision = pathname.match(/^\/api\/runs\/([^/]+)\/decision$/);
  if (request.method === 'POST' && decision) {
    const payload = await body(request) as { approved?: unknown };
    if (typeof payload.approved !== 'boolean') throw new Error('Decision must include boolean approved.');
    json(response, 200, await service.decide(decodeURIComponent(decision[1]!), payload.approved));
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

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  try {
    if (await api(request, response, url.pathname)) return;
    if (url.pathname.startsWith('/api/')) {
      json(response, 404, { error: 'API route not found.' });
      return;
    }
    await staticFile(response, url.pathname);
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    json(response, 400, { error: resolved.message });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Graph Native Workbench API: http://127.0.0.1:${port}`);
});
