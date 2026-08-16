import type { SecretProvider } from './adapters.js';

/**
 * Resolves tool secrets from the process environment.
 *
 * Only names a tool adapter declares in `requiredSecrets` are ever read, and an
 * optional allow list narrows that further so a Pack cannot reach an unrelated
 * variable. Values never enter graph state, events or audit bundles.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  private readonly allowed?: ReadonlySet<string>;

  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    allowed?: Iterable<string>,
  ) {
    if (allowed) this.allowed = new Set(allowed);
  }

  get(name: string): string | undefined {
    if (this.allowed && !this.allowed.has(name)) return undefined;
    const value = this.environment[name];
    return value === undefined || value.trim() === '' ? undefined : value;
  }
}

/** A provider backed by an explicit map, for tests and embedded callers. */
export class StaticSecretProvider implements SecretProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  get(name: string): string | undefined {
    return this.values[name];
  }
}
