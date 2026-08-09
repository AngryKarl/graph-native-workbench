import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  createWorkbenchHttpSecurity,
  enforceWorkbenchRequestSecurity,
  requireContentType,
} from '../apps/workbench/src/http-security.js';

function request(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('Workbench HTTP security', () => {
  it('requires a long authentication token for non-loopback listeners', () => {
    expect(() => createWorkbenchHttpSecurity('0.0.0.0')).toThrow(/require GRAPHWORK_AUTH_TOKEN/);
    expect(() => createWorkbenchHttpSecurity('0.0.0.0', 'short')).toThrow(/at least 32 characters/);
    expect(createWorkbenchHttpSecurity('127.0.0.1')).toEqual({ listenHost: '127.0.0.1' });
  });

  it('rejects DNS-rebinding hosts and cross-origin browser requests on loopback', () => {
    const security = createWorkbenchHttpSecurity('127.0.0.1');
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: 'attacker.example:4311' }),
      '/api/workbench',
      security,
    )).toThrow(/Host is not permitted/);
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: '127.0.0.1:4311/path' }),
      '/api/workbench',
      security,
    )).toThrow(/Host is invalid/);
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: '127.0.0.1:4311', origin: 'https://attacker.example' }),
      '/api/workbench',
      security,
    )).toThrow(/Cross-origin/);
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: '127.0.0.1:4311', 'sec-fetch-site': 'cross-site' }),
      '/api/workbench',
      security,
    )).toThrow(/Cross-site/);
  });

  it('accepts bearer or basic authentication and leaves health checks credential-free', () => {
    const token = 'a-secure-workbench-token-with-32-characters';
    const security = createWorkbenchHttpSecurity('0.0.0.0', token);
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: 'workbench.example' }),
      '/api/workbench',
      security,
    )).toThrow(/authentication is required/);
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: 'workbench.example', authorization: `Bearer ${token}` }),
      '/api/workbench',
      security,
    )).not.toThrow();
    const basic = Buffer.from(`graphwork:${token}`).toString('base64');
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: 'workbench.example', authorization: `Basic ${basic}` }),
      '/',
      security,
    )).not.toThrow();
    expect(() => enforceWorkbenchRequestSecurity(
      request({ host: '127.0.0.1:4311' }),
      '/api/health',
      security,
    )).not.toThrow();
  });

  it('rejects simple cross-site media types for JSON and Pack uploads', () => {
    expect(() => requireContentType(request({ 'content-type': 'text/plain' }), ['application/json']))
      .toThrow(/Content-Type/);
    expect(() => requireContentType(
      request({ 'content-type': 'application/json; charset=utf-8' }),
      ['application/json'],
    )).not.toThrow();
    expect(() => requireContentType(
      request({ 'content-type': 'application/vnd.graphwork.gpack' }),
      ['application/vnd.graphwork.gpack', 'application/octet-stream'],
    )).not.toThrow();
  });
});
