import type { ToolAdapter, ToolAdapterRegistry, ToolExecutionContext } from '@graph-workbench/core';
import { GitHubClient, type GitHubClientOptions } from './client.js';
import { GitHubError } from './errors.js';

export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

export interface GitHubConnectorOptions extends Omit<GitHubClientOptions, 'token'> {
  /** Repository used when a work item does not name one, as `owner/repo`. */
  readonly defaultRepository?: string;
  /**
   * Command tools only describe what they would do unless this is true.
   * The default protects users who run `npx graph-workbench` against a
   * repository they can actually write to.
   */
  readonly write?: boolean;
}

interface RepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GitHubError(`GitHub connector requires a non-empty "${field}".`, 'permanent');
  }
  return value.trim();
}

export function parseRepository(value: string): RepositoryRef {
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value.trim());
  if (!match) {
    throw new GitHubError(`"${value}" is not a valid GitHub repository; use "owner/repo".`, 'permanent');
  }
  return { owner: match[1]!, repo: match[2]! };
}

/**
 * Work items arrive as `owner/repo#123`, a bare issue number, or an external
 * tracker key such as `PLAT-142`. The first two address an issue directly; the
 * third is resolved by searching issue titles, which is how teams that keep a
 * separate tracker usually link the two systems.
 */
interface WorkItemLocator {
  readonly repository: RepositoryRef;
  readonly issueNumber?: number;
  readonly searchKey?: string;
}

export function parseWorkItem(issueId: string, defaultRepository?: string): WorkItemLocator {
  const qualified = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/.exec(issueId.trim());
  if (qualified) {
    return { repository: parseRepository(qualified[1]!), issueNumber: Number(qualified[2]) };
  }
  if (!defaultRepository) {
    throw new GitHubError(
      `Work item "${issueId}" does not name a repository and no default repository is configured. `
      + 'Use "owner/repo#123" or set GRAPH_WORKBENCH_GITHUB_REPOSITORY.',
      'permanent',
    );
  }
  const repository = parseRepository(defaultRepository);
  const bare = /^#?(\d+)$/.exec(issueId.trim());
  if (bare) return { repository, issueNumber: Number(bare[1]) };
  return { repository, searchKey: issueId.trim() };
}

interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url?: string;
  readonly pull_request?: unknown;
}

interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly html_url: string;
  readonly body?: string | null;
}

/** Marker written into a pull-request body so a retry can recognise its own work. */
function idempotencyMarker(key: string): string {
  return `<!-- graph-workbench:idempotency-key:${key} -->`;
}

export function createGitHubSoftwareDeliveryTools(
  options: GitHubConnectorOptions = {},
): ToolAdapterRegistry {
  const { defaultRepository, write = false, ...clientOptions } = options;

  const clientFor = (context: ToolExecutionContext): GitHubClient => new GitHubClient({
    ...clientOptions,
    token: context.secrets[GITHUB_TOKEN_SECRET] ?? '',
  });

  const readIssue = async (
    client: GitHubClient,
    locator: WorkItemLocator,
    signal: AbortSignal,
  ): Promise<GitHubIssue> => {
    const { owner, repo } = locator.repository;
    if (locator.issueNumber !== undefined) {
      const issue = await client.request<GitHubIssue>({
        method: 'GET',
        path: `repos/${owner}/${repo}/issues/${locator.issueNumber}`,
        signal,
      });
      if (!issue) throw new GitHubError('GitHub returned an empty issue.', 'permanent');
      return issue;
    }
    const found = await client.request<{ readonly items?: readonly GitHubIssue[] }>({
      method: 'GET',
      path: 'search/issues',
      query: { q: `${locator.searchKey} in:title repo:${owner}/${repo}`, per_page: 1 },
      signal,
    });
    const first = found?.items?.[0];
    if (!first) {
      throw new GitHubError(
        `No issue in ${owner}/${repo} has "${locator.searchKey}" in its title.`,
        'not_found',
      );
    }
    return first;
  };

  const workItemRead: ToolAdapter = {
    requiredSecrets: [GITHUB_TOKEN_SECRET],
    execute: async (input, context) => {
      const locator = parseWorkItem(text(record(input).issue_id, 'issue_id'), defaultRepository);
      const issue = await readIssue(clientFor(context), locator, context.signal);
      return {
        issue_id: text(record(input).issue_id, 'issue_id'),
        title: issue.title,
        status: issue.state,
      };
    },
  };

  const repositoryRead: ToolAdapter = {
    requiredSecrets: [GITHUB_TOKEN_SECRET],
    execute: async (input, context) => {
      const request = record(input);
      const repository = text(request.repository, 'repository');
      const ref = text(request.ref, 'ref');
      const { owner, repo } = parseRepository(repository);
      const commit = await clientFor(context).request<{ readonly sha?: string }>({
        method: 'GET',
        path: `repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
        signal: context.signal,
      });
      if (!commit?.sha) {
        throw new GitHubError(`GitHub did not return a commit for "${repository}@${ref}".`, 'not_found');
      }
      return { repository, ref, commit_sha: commit.sha };
    },
  };

  const changeRequestUpsert: ToolAdapter = {
    requiredSecrets: [GITHUB_TOKEN_SECRET],
    execute: async (input, context) => {
      const request = record(input);
      const repository = text(request.repository, 'repository');
      const title = text(request.title, 'title');
      const head = text(request.head, 'head');
      const base = text(request.base, 'base');
      const key = context.idempotencyKey ?? text(request.idempotency_key, 'idempotency_key');
      const { owner, repo } = parseRepository(repository);
      const client = clientFor(context);

      // Real idempotency: an open pull request for the same head/base already
      // represents this change, whatever the caller's key says.
      const open = await client.request<readonly GitHubPullRequest[]>({
        method: 'GET',
        path: `repos/${owner}/${repo}/pulls`,
        query: { head: `${owner}:${head}`, base, state: 'open', per_page: 1 },
        signal: context.signal,
      });
      const existing = open?.[0];

      if (!write) {
        return existing
          ? { change_request_id: String(existing.number), url: existing.html_url, status: 'existing' }
          : {
              change_request_id: 'dry-run',
              url: `https://github.com/${owner}/${repo}/compare/${base}...${head}`,
              status: 'dry_run_would_create',
            };
      }

      if (existing) {
        const updated = await client.request<GitHubPullRequest>({
          method: 'PATCH',
          path: `repos/${owner}/${repo}/pulls/${existing.number}`,
          body: { title },
          signal: context.signal,
        });
        return {
          change_request_id: String(existing.number),
          url: updated?.html_url ?? existing.html_url,
          status: 'updated',
        };
      }

      const created = await client.request<GitHubPullRequest>({
        method: 'POST',
        path: `repos/${owner}/${repo}/pulls`,
        body: { title, head, base, body: idempotencyMarker(key) },
        signal: context.signal,
      });
      if (!created) throw new GitHubError('GitHub did not return the created pull request.', 'permanent');
      return { change_request_id: String(created.number), url: created.html_url, status: 'created' };
    },
  };

  const deploymentExecute: ToolAdapter = {
    requiredSecrets: [GITHUB_TOKEN_SECRET],
    execute: async (input, context) => {
      const request = record(input);
      const releaseId = text(request.release_id, 'release_id');
      const environment = text(request.environment, 'environment');
      const artifactDigest = text(request.artifact_digest, 'artifact_digest');
      const key = context.idempotencyKey ?? text(request.idempotency_key, 'idempotency_key');
      if (!defaultRepository) {
        throw new GitHubError(
          'Deployment requires GRAPH_WORKBENCH_GITHUB_REPOSITORY to name the target repository.',
          'permanent',
        );
      }
      const { owner, repo } = parseRepository(defaultRepository);
      if (!write) return { deployment_id: 'dry-run', status: 'dry_run_would_deploy' };

      const deployment = await clientFor(context).request<{ readonly id?: number }>({
        method: 'POST',
        path: `repos/${owner}/${repo}/deployments`,
        body: {
          ref: releaseId,
          environment,
          auto_merge: false,
          required_contexts: [],
          description: `Graph Workbench release ${releaseId}`,
          payload: { artifact_digest: artifactDigest, idempotency_key: key },
        },
        signal: context.signal,
      });
      if (deployment?.id === undefined) {
        throw new GitHubError('GitHub did not return a deployment identifier.', 'permanent');
      }
      return { deployment_id: String(deployment.id), status: 'accepted' };
    },
  };

  const deploymentRollback: ToolAdapter = {
    requiredSecrets: [GITHUB_TOKEN_SECRET],
    execute: async (input, context) => {
      const request = record(input);
      const deploymentId = text(request.deployment_id, 'deployment_id');
      if (!defaultRepository) {
        throw new GitHubError(
          'Rollback requires GRAPH_WORKBENCH_GITHUB_REPOSITORY to name the target repository.',
          'permanent',
        );
      }
      const { owner, repo } = parseRepository(defaultRepository);
      if (!write) return { rollback_id: 'dry-run', status: 'dry_run_would_rollback' };

      // GitHub has no rollback API. Marking the deployment inactive is the
      // closest accountable record; the deployment platform performs the
      // actual revert.
      const status = await clientFor(context).request<{ readonly id?: number }>({
        method: 'POST',
        path: `repos/${owner}/${repo}/deployments/${encodeURIComponent(deploymentId)}/statuses`,
        body: { state: 'inactive', description: 'Rolled back by Graph Workbench.' },
        signal: context.signal,
      });
      if (status?.id === undefined) {
        throw new GitHubError('GitHub did not record the rollback status.', 'permanent');
      }
      return { rollback_id: String(status.id), status: 'accepted' };
    },
  };

  return {
    work_item_read: workItemRead,
    repository_read: repositoryRead,
    change_request_upsert: changeRequestUpsert,
    deployment_execute: deploymentExecute,
    deployment_rollback: deploymentRollback,
  };
}
