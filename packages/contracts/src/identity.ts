import { z } from 'zod';
import { identifierSchema } from './graph.js';

export const actorIdentitySchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['human', 'service', 'agent']),
    displayName: z.string().trim().min(1).max(160),
    workspaceRole: z.enum(['owner', 'member', 'service']).default('member'),
    roleIds: z.array(identifierSchema).default([]),
  })
  .strict();

export type ActorIdentity = z.infer<typeof actorIdentitySchema>;
