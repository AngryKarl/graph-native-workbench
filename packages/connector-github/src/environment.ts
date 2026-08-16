import type { ToolAdapterRegistry } from '@graph-workbench/core';
import { createGitHubSoftwareDeliveryTools, type GitHubConnectorOptions } from './tools.js';

export interface GitHubConnectorStatus {
  /** True when a token is present, so real GitHub calls are possible. */
  readonly configured: boolean;
  /** True when command tools may change GitHub instead of describing the change. */
  readonly write: boolean;
  readonly repository?: string;
  readonly baseUrl?: string;
  /** Human-readable reason the connector is inactive, when it is. */
  readonly reason?: string;
}

export interface GitHubEnvironment {
  readonly GITHUB_TOKEN?: string | undefined;
  readonly GRAPH_WORKBENCH_GITHUB_REPOSITORY?: string | undefined;
  readonly GRAPH_WORKBENCH_GITHUB_WRITE?: string | undefined;
  readonly GRAPH_WORKBENCH_GITHUB_API?: string | undefined;
}

/**
 * Reads connector configuration from the environment.
 *
 * Activation deliberately requires both a token and an explicitly named
 * repository. A `GITHUB_TOKEN` alone is ambient on many developer machines, and
 * inheriting it would silently turn the credential-free first run into live
 * network calls. Writing to GitHub then needs a further opt-in, so an
 * exploratory run against a real repository can read and plan but not act.
 */
export function readGitHubConnectorStatus(
  environment: GitHubEnvironment = process.env,
): GitHubConnectorStatus {
  const token = environment.GITHUB_TOKEN?.trim();
  const repository = environment.GRAPH_WORKBENCH_GITHUB_REPOSITORY?.trim();
  const baseUrl = environment.GRAPH_WORKBENCH_GITHUB_API?.trim();
  const write = environment.GRAPH_WORKBENCH_GITHUB_WRITE?.trim().toLowerCase() === 'true';
  if (!token || !repository) {
    return {
      configured: false,
      write: false,
      ...(repository ? { repository } : {}),
      reason: token
        ? 'GRAPH_WORKBENCH_GITHUB_REPOSITORY is not set; the deterministic zero-key adapters remain active.'
        : 'GITHUB_TOKEN is not set; the deterministic zero-key adapters remain active.',
    };
  }
  return {
    configured: true,
    write,
    repository,
    ...(baseUrl ? { baseUrl } : {}),
    ...(write ? {} : { reason: 'GRAPH_WORKBENCH_GITHUB_WRITE is not "true"; command tools describe changes without making them.' }),
  };
}

/**
 * Returns GitHub-backed adapters when a token is configured, otherwise
 * undefined so the caller keeps its deterministic zero-key adapters.
 */
export function createGitHubToolsFromEnvironment(
  environment: GitHubEnvironment = process.env,
  overrides: GitHubConnectorOptions = {},
): ToolAdapterRegistry | undefined {
  const status = readGitHubConnectorStatus(environment);
  if (!status.configured) return undefined;
  return createGitHubSoftwareDeliveryTools({
    ...(status.repository ? { defaultRepository: status.repository } : {}),
    ...(status.baseUrl ? { baseUrl: status.baseUrl } : {}),
    write: status.write,
    ...overrides,
  });
}
