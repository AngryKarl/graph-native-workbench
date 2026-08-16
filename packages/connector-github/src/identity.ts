import type { GitHubClient } from './client.js';
import { GitHubError } from './errors.js';
import {
  isCodeownerLogin,
  loginCoversChange,
  resolveCodeowners,
  type CodeownersResolution,
} from './codeowners.js';
import { parseRepository } from './tools.js';

export interface VerifiedGitHubIdentity {
  readonly login: string;
  readonly displayName: string;
  readonly kind: 'user' | 'app';
}

/**
 * Resolves who the configured token actually belongs to.
 *
 * This is the difference between an identity a user typed and one GitHub
 * confirmed. It authenticates the token holder — not every person who can
 * reach the Workbench — so a shared deployment still needs real per-user
 * authentication in front of it.
 */
export async function readAuthenticatedIdentity(
  client: GitHubClient,
  signal?: AbortSignal,
): Promise<VerifiedGitHubIdentity> {
  const user = await client.request<{
    readonly login?: string;
    readonly name?: string | null;
    readonly type?: string;
  }>({ method: 'GET', path: 'user', ...(signal ? { signal } : {}) });
  if (!user?.login) {
    throw new GitHubError('GitHub did not identify the configured token.', 'auth');
  }
  return {
    login: user.login,
    displayName: user.name?.trim() ? user.name : user.login,
    kind: user.type === 'Bot' ? 'app' : 'user',
  };
}

/** GitHub reads CODEOWNERS from the first of these that exists. */
const codeownersPaths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

export async function readCodeownersFile(
  client: GitHubClient,
  repository: string,
  signal?: AbortSignal,
): Promise<{ readonly path: string; readonly content: string } | undefined> {
  const { owner, repo } = parseRepository(repository);
  for (const path of codeownersPaths) {
    const file = await client.request<{ readonly content?: string; readonly encoding?: string }>({
      method: 'GET',
      path: `repos/${owner}/${repo}/contents/${path}`,
      allowMissing: true,
      ...(signal ? { signal } : {}),
    });
    if (!file?.content) continue;
    const content = file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64').toString('utf8')
      : file.content;
    return { path, content };
  }
  return undefined;
}

export async function readChangedPaths(
  client: GitHubClient,
  repository: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const { owner, repo } = parseRepository(repository);
  const paths: string[] = [];
  // A pull request can touch more files than one page returns.
  for (let page = 1; page <= 10; page += 1) {
    const files = await client.request<ReadonlyArray<{ readonly filename?: string }>>({
      method: 'GET',
      path: `repos/${owner}/${repo}/pulls/${pullNumber}/files`,
      query: { per_page: 100, page },
      ...(signal ? { signal } : {}),
    });
    if (!files?.length) break;
    for (const file of files) if (file.filename) paths.push(file.filename);
    if (files.length < 100) break;
  }
  return paths;
}

export interface ReviewAuthority {
  /** False when CODEOWNERS is absent, so the caller does not assume authority. */
  readonly resolved: boolean;
  readonly codeownersPath?: string;
  readonly changedPaths: readonly string[];
  readonly owners: readonly string[];
  readonly unownedPaths: readonly string[];
  readonly unresolvedTeams: readonly string[];
  /**
   * Whether the verified login owns *every* changed path, and can therefore
   * approve the change alone.
   */
  readonly loginIsOwner: boolean;
  readonly reason?: string;
}

/**
 * Answers "would GitHub ask this person to review this change?" by resolving
 * CODEOWNERS against the paths the pull request actually touches.
 */
export async function resolveReviewAuthority(
  client: GitHubClient,
  input: {
    readonly repository: string;
    readonly pullNumber: number;
    readonly login: string;
    readonly signal?: AbortSignal;
  },
): Promise<ReviewAuthority> {
  const file = await readCodeownersFile(client, input.repository, input.signal);
  const changedPaths = await readChangedPaths(
    client,
    input.repository,
    input.pullNumber,
    input.signal,
  );
  if (!file) {
    return {
      resolved: false,
      changedPaths,
      owners: [],
      unownedPaths: [...changedPaths],
      unresolvedTeams: [],
      loginIsOwner: false,
      reason: `${input.repository} does not declare CODEOWNERS, so no code-owner authority can be derived.`,
    };
  }
  const resolution: CodeownersResolution = resolveCodeowners(file.content, changedPaths);
  const outcome = isCodeownerLogin(resolution, input.login);
  const covers = loginCoversChange(resolution, input.login);
  return {
    resolved: true,
    codeownersPath: file.path,
    changedPaths,
    owners: resolution.owners,
    unownedPaths: resolution.unownedPaths,
    unresolvedTeams: outcome.unresolvedTeams,
    loginIsOwner: covers,
    ...(covers ? {} : {
      reason: resolution.unownedPaths.length > 0
        ? `No CODEOWNERS rule claims ${resolution.unownedPaths.join(', ')}, so the change has no declared owner.`
        : outcome.authorised
          ? `@${input.login} owns only part of this change; the remaining paths belong to ${resolution.owners.filter((owner) => owner !== `@${input.login.replace(/^@/, '')}`.toLowerCase()).join(', ')}.`
          : outcome.unresolvedTeams.length > 0
            ? `@${input.login} is not a named owner; ownership rests with ${outcome.unresolvedTeams.join(', ')}, whose membership CODEOWNERS does not expose.`
            : `@${input.login} is not an owner of the changed paths.`,
    }),
  };
}
