import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies GitHub's `X-Hub-Signature-256` header over the exact bytes GitHub
 * sent.
 *
 * The raw body matters: re-serializing parsed JSON changes key order and
 * whitespace, so the digest would never match. Callers must verify before
 * parsing.
 */
export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
    .digest('hex')}`;
  const provided = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch.
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

export class GitHubWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubWebhookVerificationError';
  }
}

/**
 * Throws unless the delivery is authentic. Used at the HTTP boundary so an
 * unverified payload never reaches a graph run.
 */
export function assertGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): void {
  if (!signatureHeader) {
    throw new GitHubWebhookVerificationError('Webhook delivery is missing its X-Hub-Signature-256 header.');
  }
  if (!verifyGitHubWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new GitHubWebhookVerificationError('Webhook signature does not match the configured secret.');
  }
}
