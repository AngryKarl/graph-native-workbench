/**
 * GitHub failures are classified so the graph runtime can react correctly:
 * transient failures are worth a retry, permanent ones are not, and a
 * rate-limited call carries the time at which it becomes worth retrying.
 */
export type GitHubErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'transient'
  | 'permanent';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: GitHubErrorKind,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }

  /** Whether the runtime's retry policy can usefully attempt this call again. */
  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limit';
  }
}

export class GitHubRateLimitError extends GitHubError {
  constructor(
    message: string,
    readonly resetAt: string,
    status?: number,
    requestId?: string,
  ) {
    super(message, 'rate_limit', status, requestId);
    this.name = 'GitHubRateLimitError';
  }
}
