import { z } from 'zod';
import { graphDefinitionSchema, identifierSchema, stateFieldSchema } from './graph.js';
import { jsonSchemaDefinitionSchema } from './json-schema-definition.js';

export { jsonSchemaDefinitionSchema, parseJsonSchemaValue } from './json-schema-definition.js';
export type { JsonSchemaDefinition } from './json-schema-definition.js';

export const objectTypeDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    fields: z.record(identifierSchema, stateFieldSchema),
  })
  .strict();

export const relationTypeDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    sourceTypes: z.array(identifierSchema).min(1),
    targetTypes: z.array(identifierSchema).min(1),
  })
  .strict();

export const roleDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    mission: z.string().trim().min(1).max(1_200),
    allowedTools: z.array(identifierSchema).default([]),
    forbiddenActions: z.array(z.string().trim().min(1).max(500)).default([]),
  })
  .strict();

export const toolDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    risk: z.enum(['read', 'draft', 'write', 'external']),
    description: z.string().trim().min(1).max(800),
    operation: z.enum(['query', 'command']).optional(),
    inputSchema: jsonSchemaDefinitionSchema.optional(),
    outputSchema: jsonSchemaDefinitionSchema.optional(),
    idempotency: z.enum(['intrinsic', 'keyed', 'none']).optional(),
    idempotencyKeyField: identifierSchema.optional(),
  })
  .strict()
  .superRefine((tool, context) => {
    const typedFields = [tool.operation, tool.inputSchema, tool.outputSchema, tool.idempotency];
    if (typedFields.some((value) => value !== undefined) && typedFields.some((value) => value === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Typed tools must declare operation, inputSchema, outputSchema and idempotency together.',
      });
    }
    if (tool.inputSchema && tool.inputSchema.type !== 'object') {
      context.addIssue({ code: 'custom', path: ['inputSchema'], message: 'Tool inputSchema must describe an object.' });
    }
    if (tool.operation === 'query' && tool.idempotency !== 'intrinsic') {
      context.addIssue({ code: 'custom', path: ['idempotency'], message: 'Query tools must be intrinsically idempotent.' });
    }
    if (tool.idempotency === 'keyed' && !tool.idempotencyKeyField) {
      context.addIssue({ code: 'custom', path: ['idempotencyKeyField'], message: 'Keyed tools require idempotencyKeyField.' });
    }
    if (tool.idempotency !== 'keyed' && tool.idempotencyKeyField) {
      context.addIssue({ code: 'custom', path: ['idempotencyKeyField'], message: 'Only keyed tools may declare idempotencyKeyField.' });
    }
  });

export const evaluationDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    blocking: z.boolean(),
  })
  .strict();

export const deliverableDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    graphId: identifierSchema,
    stateField: identifierSchema,
    mediaType: z.string().trim().min(1).max(160),
    artifactType: identifierSchema.optional(),
    evidenceFields: z.array(identifierSchema).optional(),
    approvalField: identifierSchema.optional(),
  })
  .strict();

export const fixtureExpectationSchema = z
  .object({
    field: identifierSchema,
    operator: z.enum(['equals', 'exists', 'includes', 'min_items']),
    value: z.unknown().optional(),
    description: z.string().trim().min(1).max(500),
  })
  .strict();

export const packFixtureDefinitionSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    graphId: identifierSchema,
    input: z.record(z.string(), z.unknown()),
    decisions: z.record(identifierSchema, z.unknown()).default({}),
    expectations: z.array(fixtureExpectationSchema).min(1),
  })
  .strict();

export const industryPackManifestSchema = z
  .object({
    id: identifierSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    license: z.string().trim().min(1).max(80),
    ontology: z
      .object({
        objectTypes: z.array(objectTypeDefinitionSchema),
        relationTypes: z.array(relationTypeDefinitionSchema),
      })
      .strict(),
    roles: z.array(roleDefinitionSchema),
    tools: z.array(toolDefinitionSchema),
    graphs: z.array(graphDefinitionSchema).min(1),
    evaluations: z.array(evaluationDefinitionSchema).default([]),
    deliverables: z.array(deliverableDefinitionSchema).default([]),
    fixtures: z.array(packFixtureDefinitionSchema).default([]),
  })
  .strict();

export type ObjectTypeDefinition = z.infer<typeof objectTypeDefinitionSchema>;
export type RelationTypeDefinition = z.infer<typeof relationTypeDefinitionSchema>;
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type EvaluationDefinition = z.infer<typeof evaluationDefinitionSchema>;
export type DeliverableDefinition = z.infer<typeof deliverableDefinitionSchema>;
export type FixtureExpectation = z.infer<typeof fixtureExpectationSchema>;
export type PackFixtureDefinition = z.infer<typeof packFixtureDefinitionSchema>;
export type IndustryPackManifest = z.infer<typeof industryPackManifestSchema>;
