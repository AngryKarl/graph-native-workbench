import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGitHubSoftwareDeliveryTools,
  createGitHubToolsFromEnvironment,
  GitHubError,
  readGitHubConnectorStatus,
  verifyGitHubWebhookSignature,
  assertGitHubWebhookSignature,
} from '@graph-workbench/connector-github';
import type { ToolExecutionContext } from '@graph-workbench/core';

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

interface StubResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

function transport(responses: readonly StubResponse[]) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    });
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers ?? {},
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, get count() { return index; } };
}

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-test',
    nodeId: 'node-test',
    signal: new AbortController().signal,
    secrets: { GITHUB_TOKEN: 'ghp_secret_value' },
    ...overrides,
  };
}

const waits: number[] = [];
const instantSleep = async (durationMs: number) => { waits.push(durationMs); };

describe('GitHub connector: reading real work', () => {
  it('reads the issue named by a fully qualified work item instead of inventing one', async () => {
    const stub = transport([{ status: 200, body: { number: 42, title: 'Fix billing retry', state: 'open' } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch });

    const result = await tools.work_item_read!.execute({ issue_id: 'acme/billing-api#42' }, context());

    expect(result).toEqual({ issue_id: 'acme/billing-api#42', title: 'Fix billing retry', status: 'open' });
    expect(stub.calls[0]?.url).toBe('https://api.github.com/repos/acme/billing-api/issues/42');
  });

  it('carries the token from the runtime secret boundary, not from the ambient environment', async () => {
    const stub = transport([{ status: 200, body: { number: 1, title: 'T', state: 'open' } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch });

    await tools.work_item_read!.execute(
      { issue_id: 'acme/api#1' },
      context({ secrets: { GITHUB_TOKEN: 'ghp_from_provider' } }),
    );

    expect(stub.calls[0]?.headers.authorization).toBe('Bearer ghp_from_provider');
    // Every adapter must declare the secret so the runtime can refuse to run without it.
    expect(tools.work_item_read!.requiredSecrets).toContain('GITHUB_TOKEN');
  });

  it('resolves an external tracker key by searching issue titles', async () => {
    const stub = transport([{ status: 200, body: { items: [{ number: 7, title: 'PLAT-142 rate limiter', state: 'closed' }] } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, defaultRepository: 'acme/billing-api' });

    const result = await tools.work_item_read!.execute({ issue_id: 'PLAT-142' }, context());

    expect(result).toMatchObject({ title: 'PLAT-142 rate limiter', status: 'closed' });
    expect(stub.calls[0]?.url).toContain('search/issues');
  });

  it('fails loudly when a tracker key matches nothing rather than returning an empty work item', async () => {
    const stub = transport([{ status: 200, body: { items: [] } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, defaultRepository: 'acme/billing-api' });

    await expect(tools.work_item_read!.execute({ issue_id: 'PLAT-999' }, context()))
      .rejects.toThrow(/No issue in acme\/billing-api/);
  });

  it('returns the real commit sha, which the deterministic adapter could never do', async () => {
    const sha = 'a'.repeat(40);
    const stub = transport([{ status: 200, body: { sha } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch });

    const result = await tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context());

    expect(result).toEqual({ repository: 'acme/api', ref: 'main', commit_sha: sha });
    expect(sha).not.toBe('0'.repeat(40));
  });
});

describe('GitHub connector: write safety', () => {
  it('never issues a write request while the connector is in its default read-only mode', async () => {
    const stub = transport([{ status: 200, body: [] }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch });

    const result = await tools.change_request_upsert!.execute(
      { idempotency_key: 'k1', repository: 'acme/api', title: 'Add retry', head: 'fix/retry', base: 'main' },
      context(),
    );

    expect(result).toMatchObject({ status: 'dry_run_would_create' });
    expect(stub.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('reuses an open pull request for the same branches instead of opening a duplicate', async () => {
    const stub = transport([
      { status: 200, body: [{ number: 12, title: 'Add retry', state: 'open', html_url: 'https://github.com/acme/api/pull/12' }] },
      { status: 200, body: { number: 12, title: 'Add retry', state: 'open', html_url: 'https://github.com/acme/api/pull/12' } },
    ]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, write: true });

    const result = await tools.change_request_upsert!.execute(
      { idempotency_key: 'k1', repository: 'acme/api', title: 'Add retry', head: 'fix/retry', base: 'main' },
      context(),
    );

    expect(result).toMatchObject({ change_request_id: '12', status: 'updated' });
    expect(stub.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('creates the pull request only when none exists, and stamps its idempotency key', async () => {
    const stub = transport([
      { status: 200, body: [] },
      { status: 201, body: { number: 31, title: 'Add retry', state: 'open', html_url: 'https://github.com/acme/api/pull/31' } },
    ]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, write: true });

    const result = await tools.change_request_upsert!.execute(
      { idempotency_key: 'key-9', repository: 'acme/api', title: 'Add retry', head: 'fix/retry', base: 'main' },
      context({ idempotencyKey: 'key-9' }),
    );

    expect(result).toMatchObject({ change_request_id: '31', status: 'created' });
    const created = stub.calls.find((call) => call.method === 'POST');
    expect((created?.body as { body?: string } | undefined)?.body).toContain('key-9');
  });

  it('refuses to deploy without a configured repository rather than guessing one', async () => {
    const stub = transport([{ status: 200, body: {} }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, write: true });

    await expect(tools.deployment_execute!.execute(
      { idempotency_key: 'k', release_id: 'v1', environment: 'production', artifact_digest: 'sha256:x' },
      context(),
    )).rejects.toThrow(/GRAPH_WORKBENCH_GITHUB_REPOSITORY/);
  });
});

describe('GitHub connector: failure classification', () => {
  it('waits for the rate-limit reset and then succeeds, instead of failing the run', async () => {
    waits.length = 0;
    const resetSeconds = 1_800_000_030;
    const stub = transport([
      { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) } },
      { status: 200, body: { sha: 'b'.repeat(40) } },
    ]);
    const tools = createGitHubSoftwareDeliveryTools({
      fetch: stub.fetch,
      sleep: instantSleep,
      now: () => 1_800_000_000_000,
    });

    const result = await tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context());

    expect(result).toMatchObject({ commit_sha: 'b'.repeat(40) });
    expect(waits).toEqual([30_000]);
  });

  it('fails fast when the rate-limit reset is further away than the run should wait', async () => {
    const stub = transport([
      { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800003600' } },
    ]);
    const tools = createGitHubSoftwareDeliveryTools({
      fetch: stub.fetch,
      sleep: instantSleep,
      now: () => 1_800_000_000_000,
      maxRateLimitWaitMs: 60_000,
    });

    await expect(tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context()))
      .rejects.toThrow(/longer than this run will wait/);
    expect(stub.count).toBe(1);
  });

  it('does not retry a bad token, so a misconfigured run cannot burn the rate limit', async () => {
    const stub = transport([{ status: 401, body: { message: 'Bad credentials' } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, sleep: instantSleep });

    await expect(tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context()))
      .rejects.toMatchObject({ kind: 'auth' });
    expect(stub.count).toBe(1);
  });

  it('treats a 403 without rate-limit headers as a permission problem, not something to wait out', async () => {
    const stub = transport([{ status: 403, body: { message: 'Resource not accessible by integration' } }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, sleep: instantSleep });

    await expect(tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context()))
      .rejects.toMatchObject({ kind: 'forbidden' });
    expect(stub.count).toBe(1);
  });

  it('retries a GitHub outage and recovers', async () => {
    const stub = transport([
      { status: 502, body: { message: 'Bad gateway' } },
      { status: 200, body: { sha: 'c'.repeat(40) } },
    ]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch, sleep: instantSleep });

    const result = await tools.repository_read!.execute({ repository: 'acme/api', ref: 'main' }, context());

    expect(result).toMatchObject({ commit_sha: 'c'.repeat(40) });
    expect(stub.count).toBe(2);
  });

  it('reports a missing token as a configuration failure before any network call', async () => {
    const stub = transport([{ status: 200, body: {} }]);
    const tools = createGitHubSoftwareDeliveryTools({ fetch: stub.fetch });

    await expect(tools.repository_read!.execute(
      { repository: 'acme/api', ref: 'main' },
      context({ secrets: {} }),
    )).rejects.toBeInstanceOf(GitHubError);
    expect(stub.count).toBe(0);
  });
});

describe('GitHub connector: activation', () => {
  it('stays inactive without a token so the zero-key experience is unchanged', () => {
    expect(createGitHubToolsFromEnvironment({})).toBeUndefined();
    expect(readGitHubConnectorStatus({})).toMatchObject({ configured: false, write: false });
  });

  it('ignores an ambient GITHUB_TOKEN so the zero-key first run never becomes a live call', () => {
    // `gh` and CI both export GITHUB_TOKEN. Inheriting it would silently point
    // the bundled fixture at a repository that does not exist.
    const status = readGitHubConnectorStatus({ GITHUB_TOKEN: 'ghp_ambient' });
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/GRAPH_WORKBENCH_GITHUB_REPOSITORY/);
    expect(createGitHubToolsFromEnvironment({ GITHUB_TOKEN: 'ghp_ambient' })).toBeUndefined();
  });

  it('activates in read-only mode once a repository is named, and explains why writes are off', () => {
    const environment = { GITHUB_TOKEN: 'ghp_x', GRAPH_WORKBENCH_GITHUB_REPOSITORY: 'acme/api' };
    const status = readGitHubConnectorStatus(environment);
    expect(status).toMatchObject({ configured: true, write: false, repository: 'acme/api' });
    expect(status.reason).toMatch(/GRAPH_WORKBENCH_GITHUB_WRITE/);
    expect(createGitHubToolsFromEnvironment(environment)).toBeDefined();
  });

  it('enables writes only on an explicit opt-in', () => {
    const base = { GITHUB_TOKEN: 'ghp_x', GRAPH_WORKBENCH_GITHUB_REPOSITORY: 'acme/api' };
    expect(readGitHubConnectorStatus({ ...base, GRAPH_WORKBENCH_GITHUB_WRITE: 'true' }))
      .toMatchObject({ configured: true, write: true });
    expect(readGitHubConnectorStatus({ ...base, GRAPH_WORKBENCH_GITHUB_WRITE: 'yes' }))
      .toMatchObject({ write: false });
  });
});

describe('GitHub webhook verification', () => {
  const secret = 'webhook-shared-secret';
  const payload = JSON.stringify({ issue_id: 'acme/api#1', title: 'Ship it' });
  const signature = (body: string, key: string) =>
    `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

  it('accepts a delivery signed with the configured secret', () => {
    expect(verifyGitHubWebhookSignature(payload, signature(payload, secret), secret)).toBe(true);
    expect(() => assertGitHubWebhookSignature(payload, signature(payload, secret), secret)).not.toThrow();
  });

  it('rejects a body altered after signing, which is the attack it exists to stop', () => {
    const tampered = payload.replace('Ship it', 'Ship anything');
    expect(verifyGitHubWebhookSignature(tampered, signature(payload, secret), secret)).toBe(false);
    expect(() => assertGitHubWebhookSignature(tampered, signature(payload, secret), secret))
      .toThrow(/does not match/);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyGitHubWebhookSignature(payload, signature(payload, 'other-secret'), secret)).toBe(false);
  });

  it('rejects an unsigned delivery instead of trusting it', () => {
    expect(verifyGitHubWebhookSignature(payload, undefined, secret)).toBe(false);
    expect(() => assertGitHubWebhookSignature(payload, undefined, secret)).toThrow(/missing its X-Hub-Signature-256/);
  });

  it('verifies the exact received bytes, not a re-serialized copy', () => {
    // GitHub signs the wire bytes; JSON.parse + stringify changes spacing and
    // key order, so verification must never round-trip the payload.
    const spaced = '{ "issue_id": "acme/api#1",  "title": "Ship it" }';
    const valid = signature(spaced, secret);
    expect(verifyGitHubWebhookSignature(spaced, valid, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(JSON.stringify(JSON.parse(spaced)), valid, secret)).toBe(false);
  });

  it('refuses to verify when no secret is configured', () => {
    expect(verifyGitHubWebhookSignature(payload, signature(payload, ''), '')).toBe(false);
  });
});
