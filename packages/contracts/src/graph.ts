import { z } from 'zod';
import { identifierSchema } from './identifier.js';
import { graphTriggerSchema } from './orchestration.js';

export { identifierSchema } from './identifier.js';

export const stateValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
]);

export const stateFieldSchema = z
  .object({
    type: stateValueTypeSchema,
    required: z.boolean().default(false),
    description: z.string().trim().min(1).max(500),
  })
  .strict();

export const graphStateSchema = z
  .object({
    fields: z.record(identifierSchema, stateFieldSchema),
  })
  .strict();

export const graphNodeKindSchema = z.enum([
  'trigger',
  'agent',
  'function',
  'router',
  'join',
  'human',
  'wait',
  'subgraph',
  'loop',
  'map',
  'escalation',
  'compensation',
]);

export const nodeRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().positive().max(10),
    backoffMs: z.number().int().nonnegative().max(60_000).default(0),
  })
  .strict();

export const nodeExecutionPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().max(86_400_000).optional(),
    retry: nodeRetryPolicySchema.optional(),
  })
  .strict();

export const graphNodeSchema = z
  .object({
    id: identifierSchema,
    kind: graphNodeKindSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(800),
    handler: identifierSchema.optional(),
    reads: z.array(identifierSchema).default([]),
    writes: z.array(identifierSchema).default([]),
    config: z.record(z.string(), z.unknown()).default({}),
    execution: nodeExecutionPolicySchema.optional(),
  })
  .strict();

export const edgeOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'exists',
  'not_exists',
  'includes',
]);

export const edgeConditionSchema = z
  .object({
    field: identifierSchema,
    operator: edgeOperatorSchema,
    value: z.unknown().optional(),
  })
  .strict();

export const graphEdgeSchema = z
  .object({
    id: identifierSchema,
    source: identifierSchema,
    target: identifierSchema,
    on: z.enum(['success', 'failure', 'always']).default('success'),
    condition: edgeConditionSchema.optional(),
    label: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const graphBudgetSchema = z
  .object({
    maxSteps: z.number().int().positive().max(10_000),
    maxDurationMs: z.number().int().positive().max(86_400_000),
    maxConcurrency: z.number().int().positive().max(100).default(4),
  })
  .strict();

export const graphDefinitionSchema = z
  .object({
    id: identifierSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    state: graphStateSchema,
    nodes: z.array(graphNodeSchema).min(1).max(1_000),
    edges: z.array(graphEdgeSchema).max(5_000),
    budget: graphBudgetSchema,
    trigger: graphTriggerSchema.optional(),
  })
  .strict();

export type StateValueType = z.infer<typeof stateValueTypeSchema>;
export type StateField = z.infer<typeof stateFieldSchema>;
export type GraphStateDefinition = z.infer<typeof graphStateSchema>;
export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;
export type NodeRetryPolicy = z.infer<typeof nodeRetryPolicySchema>;
export type NodeExecutionPolicy = z.infer<typeof nodeExecutionPolicySchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type EdgeOperator = z.infer<typeof edgeOperatorSchema>;
export type EdgeCondition = z.infer<typeof edgeConditionSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphBudget = z.infer<typeof graphBudgetSchema>;
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;
