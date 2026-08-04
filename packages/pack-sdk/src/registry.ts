import { createPrivateKey, createPublicKey, KeyObject, randomUUID, sign, verify } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { identifierSchema } from '@graph-native/contracts';
import { satisfies, valid, validRange } from 'semver';
import { z } from 'zod';
import {
  GRAPHWORK_ENGINE_VERSION,
  inspectPackArtifact,
  installPackArtifact,
  type InstalledPackVersion,
} from './package.js';

const maxRegistryBytes = 1024 * 1024;
const maxArtifactBytes = 25 * 1024 * 1024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const keyIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);
const permissionSchema = z.enum(['handlers.execute', 'context.write', 'network', 'filesystem']);

export const signedPackRegistryPayloadSchema = z.object({
  formatVersion: z.literal(1),
  registry: z.object({
    id: identifierSchema,
    name: z.string().min(1),
  }).strict(),
  generatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  packs: z.array(z.object({
    id: identifierSchema,
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    license: z.string().min(1).optional(),
    version: z.string().refine((value) => Boolean(valid(value)), 'Expected a semantic version.'),
    artifact: z.string().min(1),
    artifactChecksum: sha256Schema,
    engineRange: z.string().refine((value) => Boolean(validRange(value)), 'Expected a semantic version range.'),
    permissions: z.array(permissionSchema),
  }).strict()),
}).strict();

export const signedPackRegistrySchema = z.object({
  payload: signedPackRegistryPayloadSchema,
  signature: z.object({
    algorithm: z.literal('ed25519'),
    keyId: keyIdSchema,
    value: z.string().min(1),
  }).strict(),
}).strict();

export type SignedPackRegistryPayload = z.infer<typeof signedPackRegistryPayloadSchema>;
export type SignedPackRegistry = z.infer<typeof signedPackRegistrySchema>;
export type SignedPackRegistryEntry = SignedPackRegistryPayload['packs'][number];

export interface VerifiedPackRegistry {
  readonly payload: SignedPackRegistryPayload;
  readonly publisherKeyId: string;
}

export interface RegistryTrustOptions {
  readonly trustedKeys: Readonly<Record<string, string | Buffer | KeyObject>>;
  readonly now?: Date;
  readonly allowInsecureHttp?: boolean;
}

export interface RegistryInstallOptions extends RegistryTrustOptions {
  readonly root?: string;
  readonly activate?: boolean;
  readonly allowCrossOriginArtifacts?: boolean;
}

function canonicalPayload(payload: SignedPackRegistryPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function parseSignature(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) {
    throw new Error('Registry signature is not canonical Ed25519 base64.');
  }
  return decoded;
}

function assertRegistryUrl(url: URL, allowInsecureHttp = false): void {
  if (url.protocol === 'https:') return;
  if (allowInsecureHttp && url.protocol === 'http:') return;
  throw new Error('Signed registries and artifacts require HTTPS. Use allowInsecureHttp only for local development.');
}

async function fetchBytes(
  url: URL,
  limit: number,
  allowInsecureHttp = false,
  expectedOrigin?: string,
): Promise<Uint8Array> {
  assertRegistryUrl(url, allowInsecureHttp);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}) for ${url}.`);
  const finalUrl = new URL(response.url || url);
  assertRegistryUrl(finalUrl, allowInsecureHttp);
  if (expectedOrigin && finalUrl.origin !== expectedOrigin) {
    throw new Error('Registry artifact redirected across origins.');
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error(`Registry response exceeds the ${limit} byte limit.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`Registry response exceeds the ${limit} byte limit.`);
  return bytes;
}

export function signPackRegistry(
  input: SignedPackRegistryPayload,
  keyId: string,
  privateKey: string | Buffer | KeyObject,
): SignedPackRegistry {
  const payload = signedPackRegistryPayloadSchema.parse(input);
  const resolvedKeyId = keyIdSchema.parse(keyId);
  const key = privateKey instanceof KeyObject ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Registry signing requires an Ed25519 private key.');
  return {
    payload,
    signature: {
      algorithm: 'ed25519',
      keyId: resolvedKeyId,
      value: sign(null, canonicalPayload(payload), key).toString('base64'),
    },
  };
}

export function verifySignedPackRegistry(
  input: unknown,
  options: Pick<RegistryTrustOptions, 'trustedKeys' | 'now'>,
): VerifiedPackRegistry {
  const document = signedPackRegistrySchema.parse(input);
  const trusted = options.trustedKeys[document.signature.keyId];
  if (!trusted) throw new Error(`Registry publisher key "${document.signature.keyId}" is not trusted.`);
  const key = trusted instanceof KeyObject ? trusted : createPublicKey(trusted);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Registry trust keys must be Ed25519 public keys.');
  if (!verify(null, canonicalPayload(document.payload), key, parseSignature(document.signature.value))) {
    throw new Error('Registry signature verification failed.');
  }
  const now = (options.now ?? new Date()).getTime();
  if (Date.parse(document.payload.generatedAt) > now + 5 * 60_000) {
    throw new Error('Registry metadata was generated in the future.');
  }
  if (Date.parse(document.payload.expiresAt) <= now) throw new Error('Registry metadata has expired.');
  const identities = new Set<string>();
  for (const pack of document.payload.packs) {
    const identity = `${pack.id}@${pack.version}`;
    if (identities.has(identity)) throw new Error(`Registry contains duplicate Pack "${identity}".`);
    identities.add(identity);
  }
  return { payload: document.payload, publisherKeyId: document.signature.keyId };
}

export async function fetchSignedPackRegistry(
  source: string | URL,
  options: RegistryTrustOptions,
): Promise<VerifiedPackRegistry> {
  const url = source instanceof URL ? source : new URL(source);
  const bytes = await fetchBytes(url, maxRegistryBytes, options.allowInsecureHttp);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('Registry response is not valid JSON.');
  }
  return verifySignedPackRegistry(parsed, options);
}

function assertEntryMatchesArtifact(
  entry: SignedPackRegistryEntry,
  inspection: ReturnType<typeof inspectPackArtifact>,
): void {
  if (inspection.manifest.id !== entry.id || inspection.manifest.version !== entry.version) {
    throw new Error('Downloaded Pack identity does not match signed registry metadata.');
  }
  if (inspection.checksum !== entry.artifactChecksum) {
    throw new Error('Downloaded Pack checksum does not match signed registry metadata.');
  }
  if (inspection.descriptor.engine.graphwork !== entry.engineRange) {
    throw new Error('Downloaded Pack engine range does not match signed registry metadata.');
  }
  const declaredPermissions = [...inspection.descriptor.permissions].sort();
  const signedPermissions = [...entry.permissions].sort();
  if (JSON.stringify(declaredPermissions) !== JSON.stringify(signedPermissions)) {
    throw new Error('Downloaded Pack permissions do not match signed registry metadata.');
  }
}

export async function installPackFromSignedRegistry(
  registrySource: string | URL,
  packId: string,
  version: string,
  options: RegistryInstallOptions,
): Promise<InstalledPackVersion> {
  const registryUrl = registrySource instanceof URL ? registrySource : new URL(registrySource);
  const verified = await fetchSignedPackRegistry(registryUrl, options);
  const entry = verified.payload.packs.find((item) => item.id === packId && item.version === version);
  if (!entry) throw new Error(`Signed registry does not contain Pack "${packId}@${version}".`);
  if (!satisfies(GRAPHWORK_ENGINE_VERSION, entry.engineRange)) {
    throw new Error(`Pack requires Graphwork ${entry.engineRange}; current engine is ${GRAPHWORK_ENGINE_VERSION}.`);
  }
  const artifactUrl = new URL(entry.artifact, registryUrl);
  assertRegistryUrl(artifactUrl, options.allowInsecureHttp);
  if (!options.allowCrossOriginArtifacts && artifactUrl.origin !== registryUrl.origin) {
    throw new Error('Cross-origin registry artifacts are disabled by default.');
  }
  const bytes = await fetchBytes(
    artifactUrl,
    maxArtifactBytes,
    options.allowInsecureHttp,
    options.allowCrossOriginArtifacts ? undefined : registryUrl.origin,
  );
  const root = resolve(options.root ?? '.graphwork/packs');
  const temporary = resolve(root, '.registry-downloads', `${randomUUID()}.gpack`);
  if (dirname(temporary) !== resolve(root, '.registry-downloads')) throw new Error('Unsafe registry download path.');
  mkdirSync(dirname(temporary), { recursive: true });
  writeFileSync(temporary, bytes);
  try {
    const inspection = inspectPackArtifact(temporary);
    assertEntryMatchesArtifact(entry, inspection);
    return installPackArtifact(temporary, {
      root,
      trust: true,
      ...(options.activate === undefined ? {} : { activate: options.activate }),
      trustSource: {
        mode: 'signed-registry',
        publisherKeyId: verified.publisherKeyId,
        registry: registryUrl.toString(),
      },
    });
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function registryPayloadFromArtifacts(input: {
  readonly id: string;
  readonly name: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly artifacts: readonly { readonly path: string; readonly url: string }[];
}): SignedPackRegistryPayload {
  return signedPackRegistryPayloadSchema.parse({
    formatVersion: 1,
    registry: { id: input.id, name: input.name },
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    packs: input.artifacts.map(({ path, url }) => {
      const inspection = inspectPackArtifact(path);
      return {
        id: inspection.manifest.id,
        name: inspection.manifest.name,
        description: inspection.manifest.description,
        license: inspection.manifest.license,
        version: inspection.manifest.version,
        artifact: url,
        artifactChecksum: inspection.checksum,
        engineRange: inspection.descriptor.engine.graphwork,
        permissions: inspection.descriptor.permissions,
      } satisfies SignedPackRegistryEntry;
    }),
  });
}
