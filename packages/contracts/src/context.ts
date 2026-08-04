import { z } from 'zod';
import { identifierSchema } from './graph.js';

export const contextObjectStatusSchema = z.enum([
  'draft',
  'proposed',
  'confirmed',
  'superseded',
  'archived',
]);

export const provenanceSchema = z
  .object({
    sourceIds: z.array(identifierSchema).default([]),
    producedByRunId: identifierSchema.optional(),
    producedByNodeId: identifierSchema.optional(),
    actorId: identifierSchema,
    recordedAt: z.string().datetime(),
  })
  .strict();

export const contextObjectSchema = z
  .object({
    id: identifierSchema,
    type: identifierSchema,
    version: z.number().int().positive(),
    status: contextObjectStatusSchema,
    data: z.record(z.string(), z.unknown()),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().nullable().default(null),
    provenance: provenanceSchema,
  })
  .strict();

export const contextRelationSchema = z
  .object({
    id: identifierSchema,
    type: identifierSchema,
    sourceId: identifierSchema,
    targetId: identifierSchema,
    version: z.number().int().positive(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().nullable().default(null),
    provenance: provenanceSchema,
  })
  .strict();

export type ContextObjectStatus = z.infer<typeof contextObjectStatusSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type ContextObject = z.infer<typeof contextObjectSchema>;
export type ContextRelation = z.infer<typeof contextRelationSchema>;
