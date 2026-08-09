import { dirname, resolve } from 'node:path';
import { identifierSchema, industryPackManifestSchema } from '@graphwork/contracts';
import { z } from 'zod';
import { loadPackModule } from './load.js';
import { buildPackArtifact, type PackBuildResult } from './package.js';
import { registryPayloadFromArtifacts, type SignedPackRegistryPayload } from './registry.js';

const permissionSchema = z.enum(['handlers.execute', 'context.write', 'network', 'filesystem']);

export const packRegistryReleaseConfigSchema = z.object({
  formatVersion: z.literal(1),
  registry: z.object({
    id: identifierSchema,
    name: z.string().min(1),
  }).strict(),
  packs: z.array(z.object({
    source: z.string().min(1),
    engineRange: z.string().min(1).optional(),
    permissions: z.array(permissionSchema).optional(),
  }).strict()).min(1),
}).strict();

export type PackRegistryReleaseConfig = z.infer<typeof packRegistryReleaseConfigSchema>;

export interface PackRegistryReleaseBuildOptions {
  readonly configDirectory: string;
  readonly outputDirectory: string;
  readonly artifactBaseUrl: string;
  readonly expiresInDays: number;
  readonly now?: Date;
}

export interface PackRegistryReleaseBuild {
  readonly payload: SignedPackRegistryPayload;
  readonly artifacts: readonly PackBuildResult[];
}

export async function buildPackRegistryRelease(
  input: unknown,
  options: PackRegistryReleaseBuildOptions,
): Promise<PackRegistryReleaseBuild> {
  const config = packRegistryReleaseConfigSchema.parse(input);
  if (!Number.isInteger(options.expiresInDays) || options.expiresInDays < 1 || options.expiresInDays > 365) {
    throw new Error('Registry expiry must be an integer between 1 and 365 days.');
  }
  const baseUrl = new URL(options.artifactBaseUrl.endsWith('/')
    ? options.artifactBaseUrl
    : `${options.artifactBaseUrl}/`);
  if (baseUrl.protocol !== 'https:') throw new Error('Published Registry artifacts require an HTTPS base URL.');
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('Published Registry artifact base URLs cannot contain credentials, query parameters or fragments.');
  }

  const configDirectory = resolve(options.configDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const packsDirectory = resolve(outputDirectory, 'packs');
  const releases = await Promise.all(config.packs.map(async (pack) => {
    const source = resolve(configDirectory, pack.source);
    const loaded = await loadPackModule(source);
    const manifest = industryPackManifestSchema.parse(loaded.pack);
    const filename = `${manifest.id}-${manifest.version}.gpack`;
    const output = resolve(packsDirectory, filename);
    if (dirname(output) !== packsDirectory) throw new Error(`Unsafe published Pack identity "${manifest.id}@${manifest.version}".`);
    return { pack, source, manifest, filename, output };
  }));
  const identities = new Set<string>();
  for (const { manifest } of releases) {
    const identity = `${manifest.id}@${manifest.version}`;
    if (identities.has(identity)) throw new Error(`Registry release contains duplicate Pack "${identity}".`);
    identities.add(identity);
  }
  const built = await Promise.all(releases.map(async ({ pack, source, filename, output }) => {
    const artifact = await buildPackArtifact({
      source,
      output,
      ...(pack.engineRange ? { engineRange: pack.engineRange } : {}),
      ...(pack.permissions ? { permissions: pack.permissions } : {}),
    });
    return { artifact, url: new URL(`packs/${encodeURIComponent(filename)}`, baseUrl).toString() };
  }));

  const now = options.now ?? new Date();
  return {
    payload: registryPayloadFromArtifacts({
      id: config.registry.id,
      name: config.registry.name,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + options.expiresInDays * 24 * 60 * 60_000).toISOString(),
      artifacts: built.map(({ artifact, url }) => ({ path: artifact.artifact, url })),
    }),
    artifacts: built.map(({ artifact }) => artifact),
  };
}
