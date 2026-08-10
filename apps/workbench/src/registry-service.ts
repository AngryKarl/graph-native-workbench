import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  evaluateEngineCompatibility,
  fetchSignedPackRegistry,
  GRAPH_WORKBENCH_ENGINE_VERSION,
  installPackFromSignedRegistry,
  listInstalledPacks,
  type RegistryInstallOptions,
} from '@graph-workbench/pack-sdk';

export interface RegistryTrustKeyConfig {
  readonly keyId: string;
  readonly publicKeyPath: string;
}

export interface RegistrySourceConfig {
  readonly id: string;
  readonly name?: string;
  readonly url: string;
  readonly trustedKeys: readonly RegistryTrustKeyConfig[];
  readonly allowInsecureHttp?: boolean;
  readonly allowCrossOriginArtifacts?: boolean;
}

export interface RegistryTrustConfig {
  readonly formatVersion: 1;
  readonly registries: readonly RegistrySourceConfig[];
}

export interface RegistryPackView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly version: string;
  readonly engineRange: string;
  readonly compatible: boolean;
  readonly compatibilityMessage: string;
  readonly permissions: readonly string[];
  readonly installed: boolean;
  readonly active: boolean;
}

export type RegistrySourceView = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: 'verified';
  readonly publisherKeyId: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly packs: readonly RegistryPackView[];
} | {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: 'error';
  readonly error: string;
  readonly packs: readonly [];
};

const identifier = /^[a-z][a-z0-9_-]*$/;
const keyIdentifier = /^[A-Za-z0-9._-]+$/;
const legacyReferenceKeyId = 'graphwork.reference.v1';
const referenceKeyId = 'graph-workbench.reference.v1';
const legacyReferenceRegistryUrl = 'https://angrykarl.github.io/graphwork/registry/registry.json';
const referenceRegistryUrl = 'https://angrykarl.github.io/graph-workbench/registry/registry.json';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function parseTrustConfig(input: unknown): RegistryTrustConfig {
  const root = object(input, 'Trust config');
  if (root.formatVersion !== 1) throw new Error('Trust config formatVersion must be 1.');
  if (!Array.isArray(root.registries)) throw new Error('Trust config registries must be an array.');
  const seen = new Set<string>();
  const registries = root.registries.map((value, index): RegistrySourceConfig => {
    const source = object(value, `registries[${index}]`);
    const id = text(source.id, `registries[${index}].id`);
    if (!identifier.test(id)) throw new Error(`Registry id "${id}" is invalid.`);
    if (seen.has(id)) throw new Error(`Registry id "${id}" is duplicated.`);
    seen.add(id);
    const configuredUrl = text(source.url, `registries[${index}].url`);
    const url = configuredUrl === legacyReferenceRegistryUrl ? referenceRegistryUrl : configuredUrl;
    const parsedUrl = new URL(url);
    const allowInsecureHttp = optionalBoolean(source.allowInsecureHttp, `registries[${index}].allowInsecureHttp`);
    if (parsedUrl.protocol === 'http:' && (!allowInsecureHttp || !['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname))) {
      throw new Error(`Registry "${id}" may use HTTP only on localhost with allowInsecureHttp enabled.`);
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error(`Registry "${id}" must use HTTPS.`);
    if (!Array.isArray(source.trustedKeys) || source.trustedKeys.length === 0) {
      throw new Error(`Registry "${id}" requires at least one trusted key.`);
    }
    const seenKeys = new Set<string>();
    const trustedKeys = source.trustedKeys.map((value, keyIndex): RegistryTrustKeyConfig => {
      const key = object(value, `registries[${index}].trustedKeys[${keyIndex}]`);
      const keyId = text(key.keyId, `registries[${index}].trustedKeys[${keyIndex}].keyId`);
      if (!keyIdentifier.test(keyId)) throw new Error(`Publisher key id "${keyId}" is invalid.`);
      if (seenKeys.has(keyId)) throw new Error(`Publisher key id "${keyId}" is duplicated in Registry "${id}".`);
      seenKeys.add(keyId);
      return {
        keyId,
        publicKeyPath: text(key.publicKeyPath, `registries[${index}].trustedKeys[${keyIndex}].publicKeyPath`),
      };
    });
    const legacyReferenceKey = trustedKeys.find((key) => key.keyId === legacyReferenceKeyId);
    if (legacyReferenceKey && !seenKeys.has(referenceKeyId)) {
      trustedKeys.push({ ...legacyReferenceKey, keyId: referenceKeyId });
    }
    const allowCrossOriginArtifacts = optionalBoolean(
      source.allowCrossOriginArtifacts,
      `registries[${index}].allowCrossOriginArtifacts`,
    );
    return {
      id,
      ...(source.name === undefined ? {} : { name: text(source.name, `registries[${index}].name`) }),
      url,
      trustedKeys,
      ...(allowInsecureHttp === undefined ? {} : { allowInsecureHttp }),
      ...(allowCrossOriginArtifacts === undefined ? {} : { allowCrossOriginArtifacts }),
    };
  });
  return { formatVersion: 1, registries };
}

export async function loadRegistryTrustConfig(path: string): Promise<RegistryTrustConfig> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { formatVersion: 1, registries: [] };
    throw error;
  }
  try {
    return parseTrustConfig(JSON.parse(source) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Registry trust config at ${path}: ${message}`);
  }
}

interface LoadedRegistrySource {
  readonly config: RegistrySourceConfig;
  readonly trustedKeys: Readonly<Record<string, string>>;
}

export class WorkbenchRegistryService {
  private constructor(
    private readonly sources: readonly LoadedRegistrySource[],
    private readonly packRoot: string,
  ) {}

  static async fromConfigFile(configPath: string, packRoot: string): Promise<WorkbenchRegistryService> {
    const config = await loadRegistryTrustConfig(configPath);
    const base = dirname(resolve(configPath));
    const sources = await Promise.all(config.registries.map(async (registry): Promise<LoadedRegistrySource> => {
      const entries = await Promise.all(registry.trustedKeys.map(async (key) => {
        const path = isAbsolute(key.publicKeyPath) ? key.publicKeyPath : resolve(base, key.publicKeyPath);
        return [key.keyId, await readFile(path, 'utf8')] as const;
      }));
      return { config: registry, trustedKeys: Object.fromEntries(entries) };
    }));
    return new WorkbenchRegistryService(sources, packRoot);
  }

  async catalog(): Promise<readonly RegistrySourceView[]> {
    const installed = listInstalledPacks(this.packRoot).packs;
    return Promise.all(this.sources.map(async ({ config, trustedKeys }): Promise<RegistrySourceView> => {
      try {
        const verified = await fetchSignedPackRegistry(config.url, {
          trustedKeys,
          ...(config.allowInsecureHttp === undefined ? {} : { allowInsecureHttp: config.allowInsecureHttp }),
        });
        return {
          id: config.id,
          name: config.name ?? verified.payload.registry.name,
          url: config.url,
          status: 'verified',
          publisherKeyId: verified.publisherKeyId,
          generatedAt: verified.payload.generatedAt,
          expiresAt: verified.payload.expiresAt,
          packs: verified.payload.packs.map((pack) => {
            const compatibility = evaluateEngineCompatibility(pack.engineRange, GRAPH_WORKBENCH_ENGINE_VERSION);
            return {
              id: pack.id,
              name: pack.name ?? pack.id,
              description: pack.description ?? 'Signed Industry Pack',
              ...(pack.license ? { license: pack.license } : {}),
              version: pack.version,
              engineRange: pack.engineRange,
              compatible: compatibility.compatible,
              compatibilityMessage: compatibility.message,
              permissions: pack.permissions,
              installed: Boolean(installed[pack.id]?.versions[pack.version]),
              active: installed[pack.id]?.activeVersion === pack.version,
            };
          }),
        };
      } catch (error) {
        return {
          id: config.id,
          name: config.name ?? config.id,
          url: config.url,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          packs: [],
        };
      }
    }));
  }

  async install(registryId: string, packId: string, version: string) {
    const source = this.sources.find(({ config }) => config.id === registryId);
    if (!source) throw new Error(`Trusted Registry "${registryId}" is not configured.`);
    const options: RegistryInstallOptions = {
      root: this.packRoot,
      trustedKeys: source.trustedKeys,
      ...(source.config.allowInsecureHttp === undefined ? {} : { allowInsecureHttp: source.config.allowInsecureHttp }),
      ...(source.config.allowCrossOriginArtifacts === undefined ? {} : {
        allowCrossOriginArtifacts: source.config.allowCrossOriginArtifacts,
      }),
    };
    return installPackFromSignedRegistry(source.config.url, packId, version, options);
  }
}
