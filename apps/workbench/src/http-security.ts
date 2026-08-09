import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export interface WorkbenchHttpSecurity {
  readonly listenHost: string;
  readonly authToken?: string;
}

export class HttpSecurityError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 415 | 421,
    readonly challenge = false,
  ) {
    super(message);
    this.name = 'HttpSecurityError';
  }
}

function hostname(value: string): string | undefined {
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.host.toLowerCase() !== value.toLowerCase()) return undefined;
    return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(value: string): boolean {
  return loopbackHosts.has(value.replace(/^\[|\]$/g, '').toLowerCase());
}

export function createWorkbenchHttpSecurity(
  listenHost: string,
  rawAuthToken?: string,
): WorkbenchHttpSecurity {
  const authToken = rawAuthToken?.trim();
  if (authToken && authToken.length < 32) {
    throw new Error('GRAPHWORK_AUTH_TOKEN must contain at least 32 characters.');
  }
  if (!isLoopbackHost(listenHost) && !authToken) {
    throw new Error('Non-loopback Workbench listeners require GRAPHWORK_AUTH_TOKEN.');
  }
  return { listenHost, ...(authToken ? { authToken } : {}) };
}

function matchesSecret(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function authorizationToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (bearer) return bearer;
  const encoded = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header)?.[1];
  if (!encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator >= 0 ? decoded.slice(separator + 1) : undefined;
}

function enforceOrigin(request: IncomingMessage, hostHeader: string): void {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new HttpSecurityError('Cross-site Workbench requests are forbidden.', 403);
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpSecurityError('Request Origin is invalid.', 403);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== hostHeader.toLowerCase()) {
    throw new HttpSecurityError('Cross-origin Workbench requests are forbidden.', 403);
  }
}

export function enforceWorkbenchRequestSecurity(
  request: IncomingMessage,
  pathname: string,
  security: WorkbenchHttpSecurity,
): void {
  const hostHeader = request.headers.host;
  const requestHostname = hostHeader ? hostname(hostHeader) : undefined;
  if (!hostHeader || !requestHostname) throw new HttpSecurityError('Request Host is invalid.', 421);
  if (isLoopbackHost(security.listenHost) && !isLoopbackHost(requestHostname)) {
    throw new HttpSecurityError('Request Host is not permitted for a loopback Workbench.', 421);
  }
  enforceOrigin(request, hostHeader);
  if (pathname === '/api/health' || !security.authToken) return;
  const candidate = authorizationToken(request.headers.authorization);
  if (!candidate || !matchesSecret(candidate, security.authToken)) {
    throw new HttpSecurityError('Workbench authentication is required.', 401, true);
  }
}

export function requireContentType(request: IncomingMessage, allowed: readonly string[]): void {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (!mediaType || !allowed.includes(mediaType)) {
    throw new HttpSecurityError(`Content-Type must be ${allowed.join(' or ')}.`, 415);
  }
}

export function applyWorkbenchSecurityHeaders(response: ServerResponse): void {
  response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'");
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}
