import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { IndustryPackManifest } from '@graph-workbench/contracts';
import { identifierSchema, industryPackManifestSchema } from '@graph-workbench/contracts';
import type { HandlerRegistry } from '@graph-workbench/core';
import { compilePack } from '@graph-workbench/core';
import { build as bundle } from 'esbuild';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { valid, validRange } from 'semver';
import { z } from 'zod';
import { evaluateEngineCompatibility, type EngineCompatibilityReport } from './compatibility.js';
import { loadPackModule } from './load.js';
import packSdkManifest from '../package.json' with { type: 'json' };

export const PACK_FORMAT_VERSION = 1 as const;
export const GRAPH_WORKBENCH_ENGINE_VERSION = packSdkManifest.version;
const descriptorFile = 'graph-workbench.pack.json';
const legacyDescriptorFile = 'graphwork.pack.json';
const manifestFile = 'manifest.json';
const entryFile = 'dist/index.mjs';
const maxArtifactBytes = 25 * 1024 * 1024;
const maxExpandedBytes = 50 * 1024 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const descriptorFields = {
  formatVersion: z.literal(PACK_FORMAT_VERSION),
  pack: z.object({
    id: identifierSchema,
    version: z.string().refine((value) => Boolean(valid(value)), 'Expected a semantic version.'),
    manifest: z.literal(manifestFile),
    entry: z.literal(entryFile),
  }).strict(),
  permissions: z.array(z.enum(['handlers.execute', 'context.write', 'network', 'filesystem'])),
  integrity: z.object({
    algorithm: z.literal('sha256'),
    files: z.record(z.string(), sha256Schema),
  }).strict(),
};

const engineRangeSchema = z.string().refine(
  (value) => Boolean(validRange(value)),
  'Expected a semantic version range.',
);
const currentPackPackageDescriptorSchema = z.object({
  ...descriptorFields,
  engine: z.object({ 'graph-workbench': engineRangeSchema }).strict(),
}).strict();
const legacyPackPackageDescriptorSchema = z.object({
  ...descriptorFields,
  engine: z.object({ graphwork: engineRangeSchema }).strict(),
}).strict().transform(({ engine, ...descriptor }) => ({
  ...descriptor,
  engine: { 'graph-workbench': engine.graphwork },
}));

export const packPackageDescriptorSchema = z.union([
  currentPackPackageDescriptorSchema,
  legacyPackPackageDescriptorSchema,
]);

export type PackPackageDescriptor = z.infer<typeof packPackageDescriptorSchema>;

export interface PackBuildOptions {
  readonly source: string;
  readonly output?: string;
  readonly engineRange?: string;
  readonly permissions?: readonly PackPackageDescriptor['permissions'][number][];
}

export interface PackBuildResult {
  readonly artifact: string;
  readonly checksum: string;
  readonly bytes: number;
  readonly descriptor: PackPackageDescriptor;
}

export interface PackArtifactInspection {
  readonly artifact: string;
  readonly checksum: string;
  readonly bytes: number;
  readonly compatible: boolean;
  readonly compatibility: EngineCompatibilityReport;
  readonly descriptor: PackPackageDescriptor;
  readonly manifest: IndustryPackManifest;
}

export interface InstalledPackVersion {
  readonly version: string;
  readonly installedAt: string;
  readonly artifactChecksum: string;
  readonly descriptorChecksum?: string;
  readonly engineRange: string;
  readonly trusted: boolean;
  readonly directory: string;
  readonly trustSource?:
    | { readonly mode: 'local-explicit' }
    | {
        readonly mode: 'signed-registry';
        readonly publisherKeyId: string;
        readonly registry: string;
      };
}

export interface InstalledPackRecord {
  readonly activeVersion: string;
  readonly versions: Readonly<Record<string, InstalledPackVersion>>;
}

export interface PackRegistryState {
  readonly version: 1;
  readonly packs: Readonly<Record<string, InstalledPackRecord>>;
}

export interface PackInstallOptions {
  readonly root?: string;
  readonly trust?: boolean;
  readonly activate?: boolean;
  readonly trustSource?: InstalledPackVersion['trustSource'];
}

const installedPackVersionSchema = z.object({
  version: z.string().refine((value) => Boolean(valid(value))),
  installedAt: z.iso.datetime(),
  artifactChecksum: sha256Schema,
  descriptorChecksum: sha256Schema.optional(),
  engineRange: z.string().refine((value) => Boolean(validRange(value))),
  trusted: z.boolean(),
  directory: z.string().min(1),
  trustSource: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('local-explicit') }).strict(),
    z.object({
      mode: z.literal('signed-registry'),
      publisherKeyId: z.string().min(1),
      registry: z.url(),
    }).strict(),
  ]).optional(),
}).strict();

const installedPackRecordSchema = z.object({
  activeVersion: z.string().refine((value) => Boolean(valid(value))),
  versions: z.record(z.string(), installedPackVersionSchema),
}).strict();

const packRegistryStateSchema = z.object({
  version: z.literal(1),
  packs: z.record(identifierSchema, installedPackRecordSchema),
}).strict();

export interface InstalledPackModule {
  readonly pack: IndustryPackManifest;
  readonly handlers: HandlerRegistry;
  readonly source: string;
  readonly descriptor: PackPackageDescriptor;
  readonly installation: InstalledPackVersion;
  readonly projector?: (store: unknown, run: unknown) => Promise<void>;
}

export interface InstalledPackFiles {
  readonly pack: IndustryPackManifest;
  readonly source: string;
  readonly descriptor: PackPackageDescriptor;
  readonly installation: InstalledPackVersion;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultRegistry(): PackRegistryState {
  return { version: 1, packs: {} };
}

function registryPath(root: string): string {
  return resolve(root, 'registry.json');
}

function readRegistry(root: string): PackRegistryState {
  try {
    return packRegistryStateSchema.parse(
      JSON.parse(readFileSync(registryPath(root), 'utf8')) as unknown,
    ) as PackRegistryState;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return defaultRegistry();
    throw error;
  }
}

function writeRegistry(root: string, state: PackRegistryState): void {
  mkdirSync(root, { recursive: true });
  const target = registryPath(root);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, stableJson(state), 'utf8');
  renameSync(temporary, target);
}

function decodeArtifact(artifact: string): {
  readonly raw: Uint8Array;
  readonly files: Record<string, Uint8Array>;
  readonly descriptorName: string;
} {
  const raw = readFileSync(artifact);
  if (raw.byteLength > maxArtifactBytes) {
    throw new Error(`Pack artifact exceeds the ${maxArtifactBytes / 1024 / 1024} MB limit.`);
  }
  let files: Record<string, Uint8Array>;
  const allowed = new Set([descriptorFile, legacyDescriptorFile, manifestFile, entryFile]);
  const seen = new Set<string>();
  let declaredExpandedBytes = 0;
  try {
    files = unzipSync(raw, {
      filter: (file) => {
        if (!allowed.has(file.name)) {
          throw new Error('Pack contains an unexpected file. Only declared v1 files are allowed.');
        }
        if (seen.has(file.name)) throw new Error(`Pack contains duplicate file "${file.name}".`);
        seen.add(file.name);
        if (file.compression !== 0 && file.compression !== 8) {
          throw new Error(`Pack file "${file.name}" uses an unsupported compression method.`);
        }
        declaredExpandedBytes += file.originalSize;
        if (declaredExpandedBytes > maxExpandedBytes) {
          throw new Error('Expanded Pack exceeds the 50 MB safety limit.');
        }
        return true;
      },
    });
  } catch (error) {
    if (
      error instanceof Error
      && (error.message.startsWith('Pack ') || error.message.startsWith('Expanded Pack '))
    ) throw error;
    throw new Error(`"${artifact}" is not a readable .gpack artifact.`, { cause: error });
  }
  const names = Object.keys(files);
  if (names.some((name) => !allowed.has(name))) {
    throw new Error('Pack contains an unexpected file. Only declared v1 files are allowed.');
  }
  const descriptors = [descriptorFile, legacyDescriptorFile].filter((name) => files[name]);
  if (descriptors.length !== 1 || ![manifestFile, entryFile].every((name) => files[name])) {
    throw new Error('Pack is missing its descriptor, manifest, or executable entry.');
  }
  const expandedBytes = Object.values(files).reduce((total, value) => total + value.byteLength, 0);
  if (expandedBytes > maxExpandedBytes) throw new Error('Expanded Pack exceeds the 50 MB safety limit.');
  return { raw, files, descriptorName: descriptors[0]! };
}

export async function buildPackArtifact(options: PackBuildOptions): Promise<PackBuildResult> {
  const source = resolve(options.source);
  const loaded = await loadPackModule(source);
  const manifest = compilePack(loaded.pack).manifest;
  const output = resolve(options.output ?? `${manifest.id}-${manifest.version}.gpack`);
  const bundled = await bundle({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    sourcemap: false,
    minify: false,
    treeShaking: true,
    logLevel: 'silent',
  });
  const entry = bundled.outputFiles[0]?.contents;
  if (!entry) throw new Error('Pack source did not produce an executable module.');
  const manifestBytes = strToU8(stableJson(manifest));
  const permissions = [...new Set(options.permissions ?? [
    'handlers.execute',
    ...(loaded.projector ? ['context.write' as const] : []),
  ])];
  const descriptor = packPackageDescriptorSchema.parse({
    formatVersion: PACK_FORMAT_VERSION,
    pack: { id: manifest.id, version: manifest.version, manifest: manifestFile, entry: entryFile },
    engine: { 'graph-workbench': options.engineRange ?? `^${GRAPH_WORKBENCH_ENGINE_VERSION}` },
    permissions,
    integrity: {
      algorithm: 'sha256',
      files: {
        [manifestFile]: sha256(manifestBytes),
        [entryFile]: sha256(entry),
      },
    },
  });
  const archive = zipSync({
    [descriptorFile]: strToU8(stableJson(descriptor)),
    [manifestFile]: manifestBytes,
    [entryFile]: entry,
  }, { level: 9, mtime: new Date('1980-01-01T00:00:00.000Z') });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, archive);
  return {
    artifact: output,
    checksum: sha256(archive),
    bytes: archive.byteLength,
    descriptor,
  };
}

export function inspectPackArtifact(filePath: string): PackArtifactInspection {
  const artifact = resolve(filePath);
  const { raw, files, descriptorName } = decodeArtifact(artifact);
  const descriptor = packPackageDescriptorSchema.parse(
    JSON.parse(strFromU8(files[descriptorName]!)) as unknown,
  );
  const hashedFiles = Object.keys(descriptor.integrity.files).sort();
  if (
    hashedFiles.length !== 2
    || hashedFiles[0] !== entryFile
    || hashedFiles[1] !== manifestFile
  ) {
    throw new Error('Pack integrity metadata must cover exactly manifest.json and dist/index.mjs.');
  }
  for (const [name, expected] of Object.entries(descriptor.integrity.files)) {
    const contents = files[name];
    if (!contents) throw new Error(`Integrity entry references missing file "${name}".`);
    if (sha256(contents) !== expected) throw new Error(`Integrity check failed for "${name}".`);
  }
  const manifest = industryPackManifestSchema.parse(
    JSON.parse(strFromU8(files[descriptor.pack.manifest]!)) as unknown,
  );
  if (manifest.id !== descriptor.pack.id || manifest.version !== descriptor.pack.version) {
    throw new Error('Pack descriptor and manifest identity do not match.');
  }
  const compatibility = evaluateEngineCompatibility(
    descriptor.engine['graph-workbench'],
    GRAPH_WORKBENCH_ENGINE_VERSION,
  );
  return {
    artifact,
    checksum: sha256(raw),
    bytes: raw.byteLength,
    compatible: compatibility.compatible,
    compatibility,
    descriptor,
    manifest,
  };
}

export function installPackArtifact(
  filePath: string,
  options: PackInstallOptions = {},
): InstalledPackVersion {
  const root = resolve(options.root ?? '.graph-workbench/packs');
  const inspection = inspectPackArtifact(filePath);
  if (!inspection.compatible) {
    throw new Error(inspection.compatibility.message);
  }
  if (!options.trust) {
    throw new Error(
      'This Pack contains executable handlers. Review its source, then install again with --trust.',
    );
  }
  const id = inspection.manifest.id;
  const version = inspection.manifest.version;
  const destination = resolve(root, id, version);
  const expectedParent = resolve(root, id);
  if (dirname(destination) !== expectedParent) throw new Error('Unsafe Pack installation path.');
  const { files, descriptorName } = decodeArtifact(inspection.artifact);
  const temporary = resolve(root, '.tmp', randomUUID());
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = resolve(temporary, name);
      const relativeTarget = relative(temporary, target);
      if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
        throw new Error(`Unsafe Pack file path "${name}".`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    if (readRegistry(root).packs[id]?.versions[version]) {
      throw new Error(`Pack "${id}@${version}" is already installed.`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(temporary, destination);
    const installed: InstalledPackVersion = {
      version,
      installedAt: new Date().toISOString(),
      artifactChecksum: inspection.checksum,
      descriptorChecksum: sha256(files[descriptorName]!),
      engineRange: inspection.descriptor.engine['graph-workbench'],
      trusted: true,
      directory: destination,
      trustSource: options.trustSource ?? { mode: 'local-explicit' },
    };
    const registry = readRegistry(root);
    const previous = registry.packs[id];
    writeRegistry(root, {
      version: 1,
      packs: {
        ...registry.packs,
        [id]: {
          activeVersion: options.activate === false && previous ? previous.activeVersion : version,
          versions: { ...previous?.versions, [version]: installed },
        },
      },
    });
    return installed;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (!readRegistry(root).packs[id]?.versions[version]) {
      rmSync(destination, { recursive: true, force: true });
    }
    throw error;
  }
}

export function listInstalledPacks(root = '.graph-workbench/packs'): PackRegistryState {
  return readRegistry(resolve(root));
}

export function activateInstalledPack(id: string, version: string, root = '.graph-workbench/packs'): InstalledPackVersion {
  const resolvedRoot = resolve(root);
  const registry = readRegistry(resolvedRoot);
  const record = registry.packs[id];
  const installation = record?.versions[version];
  if (!record || !installation) throw new Error(`Pack "${id}@${version}" is not installed.`);
  writeRegistry(resolvedRoot, {
    ...registry,
    packs: { ...registry.packs, [id]: { ...record, activeVersion: version } },
  });
  return installation;
}

export function rollbackInstalledPack(id: string, root = '.graph-workbench/packs'): InstalledPackVersion {
  const resolvedRoot = resolve(root);
  const registry = readRegistry(resolvedRoot);
  const record = registry.packs[id];
  if (!record) throw new Error(`Pack "${id}" is not installed.`);
  const candidates = Object.values(record.versions)
    .filter((item) => item.version !== record.activeVersion)
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
  const target = candidates[0];
  if (!target) throw new Error(`Pack "${id}" has no previous installed version.`);
  return activateInstalledPack(id, target.version, resolvedRoot);
}

export function uninstallInstalledPack(
  id: string,
  version: string | undefined,
  root = '.graph-workbench/packs',
): void {
  const resolvedRoot = resolve(root);
  const registry = readRegistry(resolvedRoot);
  const record = registry.packs[id];
  if (!record) throw new Error(`Pack "${id}" is not installed.`);
  const versions = version ? [version] : Object.keys(record.versions);
  for (const selected of versions) {
    if (!record.versions[selected]) throw new Error(`Pack "${id}@${selected}" is not installed.`);
  }
  if (version && version === record.activeVersion && Object.keys(record.versions).length > 1) {
    throw new Error('Activate another version before removing the active version.');
  }
  const remaining = Object.fromEntries(
    Object.entries(record.versions).filter(([selected]) => !versions.includes(selected)),
  );
  const packs = { ...registry.packs };
  if (Object.keys(remaining).length === 0) {
    delete packs[id];
  } else {
    packs[id] = { activeVersion: record.activeVersion, versions: remaining };
  }
  writeRegistry(resolvedRoot, { version: 1, packs });
  for (const selected of versions) {
    const target = resolve(resolvedRoot, id, selected);
    if (dirname(target) !== resolve(resolvedRoot, id)) throw new Error('Unsafe Pack removal path.');
    rmSync(target, { recursive: true, force: true });
  }
  if (Object.keys(remaining).length === 0) {
    rmSync(resolve(resolvedRoot, id), { recursive: true, force: true });
  }
}

export async function inspectInstalledPack(
  id: string,
  root = '.graph-workbench/packs',
): Promise<InstalledPackFiles> {
  const resolvedRoot = resolve(root);
  const registry = readRegistry(resolvedRoot);
  const record = registry.packs[id];
  if (!record) throw new Error(`Pack "${id}" is not installed.`);
  const installation = record.versions[record.activeVersion];
  if (!installation) throw new Error(`Active Pack version "${record.activeVersion}" is unavailable.`);
  if (!installation.trusted) throw new Error(`Pack "${id}@${record.activeVersion}" is not trusted.`);
  const expectedDirectory = resolve(resolvedRoot, id, record.activeVersion);
  if (resolve(installation.directory) !== expectedDirectory) {
    throw new Error(`Pack "${id}@${record.activeVersion}" has an unsafe registry path.`);
  }
  const descriptorBytes = await readFile(resolve(installation.directory, descriptorFile)).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFile(resolve(installation.directory, legacyDescriptorFile));
  });
  if (installation.descriptorChecksum && sha256(descriptorBytes) !== installation.descriptorChecksum) {
    throw new Error('Installed Pack descriptor integrity check failed.');
  }
  const descriptor = packPackageDescriptorSchema.parse(
    JSON.parse(descriptorBytes.toString('utf8')) as unknown,
  );
  if (descriptor.pack.id !== id || descriptor.pack.version !== record.activeVersion) {
    throw new Error('Installed Pack descriptor identity does not match its registry record.');
  }
  const entry = resolve(installation.directory, descriptor.pack.entry);
  const manifestPath = resolve(installation.directory, descriptor.pack.manifest);
  const [entryBytes, manifestBytes] = await Promise.all([readFile(entry), readFile(manifestPath)]);
  for (const [name, contents] of [[entryFile, entryBytes], [manifestFile, manifestBytes]] as const) {
    if (sha256(contents) !== descriptor.integrity.files[name]) {
      throw new Error(`Installed Pack integrity check failed for "${name}".`);
    }
  }
  const installedManifest = industryPackManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  if (installedManifest.id !== id || installedManifest.version !== record.activeVersion) {
    throw new Error('Installed Pack manifest identity does not match its registry record.');
  }
  return {
    pack: installedManifest,
    source: entry,
    descriptor,
    installation,
  };
}

export async function loadInstalledPack(
  id: string,
  root = '.graph-workbench/packs',
): Promise<InstalledPackModule> {
  const inspected = await inspectInstalledPack(id, root);
  const { source: entry, descriptor, installation, pack: installedManifest } = inspected;
  const imported = (await import(`${pathToFileURL(entry).href}?integrity=${installation.artifactChecksum}`)) as Record<string, unknown>;
  const pack = industryPackManifestSchema.parse(imported.pack ?? imported.default);
  if (pack.id !== installedManifest.id || pack.version !== installedManifest.version) {
    throw new Error('Installed Pack module identity does not match its registry record.');
  }
  if (!isDeepStrictEqual(pack, installedManifest)) {
    throw new Error('Installed Pack module manifest does not match its inspectable manifest.json.');
  }
  return {
    pack,
    handlers: (imported.handlers ?? {}) as HandlerRegistry,
    source: entry,
    descriptor,
    installation,
    ...(typeof imported.projector === 'function'
      ? { projector: imported.projector as (store: unknown, run: unknown) => Promise<void> }
      : {}),
  };
}

export async function loadAllInstalledPacks(root = '.graph-workbench/packs'): Promise<readonly InstalledPackModule[]> {
  const registry = readRegistry(resolve(root));
  const results: InstalledPackModule[] = [];
  for (const id of Object.keys(registry.packs).sort()) results.push(await loadInstalledPack(id, root));
  return results;
}

export function formatArtifactInspection(inspection: PackArtifactInspection): string {
  const trust = inspection.descriptor.permissions.join(', ') || 'none';
  return [
    `${inspection.manifest.name} (${inspection.manifest.id}@${inspection.manifest.version})`,
    `Artifact: ${basename(inspection.artifact)} (${inspection.bytes} bytes)`,
    `SHA-256: ${inspection.checksum}`,
    `Engine: ${inspection.descriptor.engine['graph-workbench']} (${inspection.compatibility.message})`,
    `Permissions: ${trust}`,
  ].join('\n');
}
