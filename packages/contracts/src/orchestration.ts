import { z } from 'zod';
import { identifierSchema } from './identifier.js';
import { jsonSchemaDefinitionSchema } from './json-schema-definition.js';

export const graphTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }).strict(),
  z.object({
    type: z.literal('webhook'),
    method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
    path: z.string().trim().min(1).max(240).regex(/^\/[a-zA-Z0-9/_{}.-]*$/),
    inputSchema: jsonSchemaDefinitionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('schedule'),
    cron: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(80).default('UTC'),
    input: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  z.object({
    type: z.literal('event'),
    eventType: identifierSchema,
    correlationField: identifierSchema.optional(),
    inputSchema: jsonSchemaDefinitionSchema.optional(),
  }).strict(),
]);

export const externalEventSchema = z.object({
  id: identifierSchema,
  type: identifierSchema,
  correlationKey: z.string().trim().min(1).max(500).optional(),
  payload: z.unknown(),
  occurredAt: z.string().datetime(),
}).strict();

export const scheduleOccurrenceSchema = z.object({
  id: identifierSchema,
  scheduledFor: z.string().datetime(),
}).strict();

export const waitNodeConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('timer'),
    durationMs: z.number().int().positive().max(31_536_000_000),
  }).strict(),
  z.object({
    mode: z.literal('event'),
    eventType: identifierSchema,
    correlationField: identifierSchema,
    payloadField: identifierSchema.optional(),
  }).strict(),
]);

export const joinNodeConfigSchema = z.object({
  mode: z.enum(['all', 'any']).default('all'),
}).strict();

const stateMappingSchema = z.record(identifierSchema, identifierSchema);

export const subgraphNodeConfigSchema = z.object({
  graphId: identifierSchema,
  inputMapping: stateMappingSchema,
  outputMapping: stateMappingSchema,
}).strict();

export const loopNodeConfigSchema = z.object({
  graphId: identifierSchema,
  inputMapping: stateMappingSchema,
  outputMapping: stateMappingSchema,
  conditionField: identifierSchema,
  conditionValue: z.unknown(),
  maxIterations: z.number().int().positive().max(1_000),
}).strict();

export const mapNodeConfigSchema = z.object({
  graphId: identifierSchema,
  itemsField: identifierSchema,
  itemField: identifierSchema,
  resultField: identifierSchema,
  outputField: identifierSchema,
  inputMapping: stateMappingSchema.default({}),
  maxItems: z.number().int().positive().max(10_000),
  maxConcurrency: z.number().int().positive().max(100).default(4),
}).strict();

export const escalationNodeConfigSchema = z.object({
  reason: z.string().trim().min(1).max(800),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  roleId: identifierSchema.optional(),
}).strict();

export const compensationNodeConfigSchema = z.object({
  compensates: z.array(identifierSchema).min(1),
}).strict();

export type GraphTrigger = z.infer<typeof graphTriggerSchema>;
export type ExternalEvent = z.infer<typeof externalEventSchema>;
export type ScheduleOccurrence = z.infer<typeof scheduleOccurrenceSchema>;
export type WaitNodeConfig = z.infer<typeof waitNodeConfigSchema>;
export type JoinNodeConfig = z.infer<typeof joinNodeConfigSchema>;
export type SubgraphNodeConfig = z.infer<typeof subgraphNodeConfigSchema>;
export type LoopNodeConfig = z.infer<typeof loopNodeConfigSchema>;
export type MapNodeConfig = z.infer<typeof mapNodeConfigSchema>;
export type EscalationNodeConfig = z.infer<typeof escalationNodeConfigSchema>;
export type CompensationNodeConfig = z.infer<typeof compensationNodeConfigSchema>;
