import { z } from 'zod';
import { identifierSchema } from './graph.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const artifactEvidenceSchema = z
  .object({
    id: identifierSchema,
    sourceField: identifierSchema,
    ordinal: z.number().int().nonnegative(),
    value: z.unknown(),
    digest: sha256Schema,
  })
  .strict();

export const artifactApprovalSchema = z
  .object({
    stateField: identifierSchema,
    value: z.unknown(),
    requiredRoleId: identifierSchema.optional(),
    actorId: identifierSchema.optional(),
    actorName: z.string().trim().min(1).max(160).optional(),
    recordedAt: z.string().datetime().optional(),
  })
  .strict();

export const portableArtifactSchema = z
  .object({
    formatVersion: z.literal(1),
    id: identifierSchema,
    artifactType: identifierSchema,
    deliverableId: identifierSchema,
    mediaType: z.string().trim().min(1).max(160),
    content: z.unknown(),
    contentDigest: sha256Schema,
    evidence: z.array(artifactEvidenceSchema),
    producer: z
      .object({
        packId: identifierSchema,
        graphId: identifierSchema,
        graphVersion: z.number().int().positive(),
        runId: identifierSchema,
        nodeId: identifierSchema.optional(),
        producedAt: z.string().datetime(),
      })
      .strict(),
    approval: artifactApprovalSchema.optional(),
  })
  .strict();

export type ArtifactEvidence = z.infer<typeof artifactEvidenceSchema>;
export type ArtifactApproval = z.infer<typeof artifactApprovalSchema>;
export type PortableArtifact = z.infer<typeof portableArtifactSchema>;
