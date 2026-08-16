import { GitHubError, GitHubRateLimitError } from './errors.js';

export interface GitHubClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly userAgent?: string;
  /** Attempts for transient failures, including the first. */
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  /** Longest a rate-limit reset is waited out before the call fails instead. */
  readonly maxRateLimitWaitMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

export interface GitHubRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** A 404 resolves to undefined instead of throwing. */
  readonly allowMissing?: boolean;
}

function defaultSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('GitHub request was cancelled.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, durationMs);
    const cancel = () => {
      clearTimeout(timer);
      reject(new Error('GitHub request was cancelled.'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function messageFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

/**
 * A deliberately small GitHub REST client. It exists to make failure modes
 * explicit — authentication, permission, rate limiting and transient errors are
 * distinguishable by the caller — rather than to cover the whole API surface.
 */
export class GitHubClient {
  private readonly baseUrl: string;
  private readonly transport: typeof globalThis.fetch;
  private readonly sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly userAgent: string;

  constructor(private readonly options: GitHubClientOptions) {
    if (!options.token.trim()) throw new GitHubError('A GitHub token is required.', 'auth');
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.transport = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 500;
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 60_000;
    this.userAgent = options.userAgent ?? 'graph-workbench-connector-github';
  }

  async request<T>(request: GitHubRequest): Promise<T | undefined> {
    let lastError: GitHubError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (request.signal?.aborted) throw new GitHubError('GitHub request was cancelled.', 'permanent');
      try {
        return await this.attempt<T>(request);
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        lastError = error;
        if (!error.retryable || attempt === this.maxAttempts) throw error;
        const waitMs = error instanceof GitHubRateLimitError
          ? Math.max(0, Date.parse(error.resetAt) - this.now())
          : this.backoffMs * 2 ** (attempt - 1);
        await this.sleep(waitMs, request.signal);
      }
    }
    throw lastError ?? new GitHubError('GitHub request failed.', 'transient');
  }

  private async attempt<T>(request: GitHubRequest): Promise<T | undefined> {
    const url = new URL(`${this.baseUrl}/${request.path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.transport(url.toString(), {
        method: request.method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': this.userAgent,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      // Network-level failures carry no status and are worth another attempt.
      throw new GitHubError(
        `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`,
        'transient',
      );
    }

    const requestId = response.headers.get('x-github-request-id') ?? undefined;
    if (response.status === 204) return undefined;

    const raw = await response.text();
    const payload: unknown = raw ? safeJson(raw) : undefined;
    if (response.ok) return payload as T;

    if (response.status === 404 && request.allowMissing) return undefined;
    throw this.failure(response, payload, requestId);
  }

  private failure(response: Response, payload: unknown, requestId?: string): GitHubError {
    const status = response.status;
    const detail = messageFrom(payload, response.statusText || `HTTP ${status}`);

    if (status === 401) {
      return new GitHubError(`GitHub authentication failed: ${detail}`, 'auth', status, requestId);
    }
    if (status === 403 || status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const resetAtMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? this.now() + retryAfter * 1000
        : remaining === '0' && Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : undefined;
      if (resetAtMs !== undefined) {
        const waitMs = resetAtMs - this.now();
        const resetAt = new Date(resetAtMs).toISOString();
        if (waitMs > this.maxRateLimitWaitMs) {
          return new GitHubError(
            `GitHub rate limit exceeded; it resets at ${resetAt}, which is longer than this run will wait.`,
            'permanent',
            status,
            requestId,
          );
        }
        return new GitHubRateLimitError(
          `GitHub rate limit exceeded; retrying after ${resetAt}.`,
          resetAt,
          status,
          requestId,
        );
      }
      // A 403 without rate-limit headers is a permission problem, not a wait.
      return new GitHubError(`GitHub denied the request: ${detail}`, 'forbidden', status, requestId);
    }
    if (status === 404) {
      return new GitHubError(`GitHub resource not found: ${detail}`, 'not_found', status, requestId);
    }
    if (status >= 500) {
      return new GitHubError(`GitHub is unavailable: ${detail}`, 'transient', status, requestId);
    }
    return new GitHubError(`GitHub rejected the request: ${detail}`, 'permanent', status, requestId);
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 200) };
  }
}
