import { z } from 'zod';
import { identifierSchema } from './graph.js';

export const graphRunStatusSchema = z.enum([
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const graphEventSchema = z
  .object({
    runId: identifierSchema,
    seq: z.number().int().positive(),
    timestamp: z.string().datetime(),
    type: z.enum([
      'run.started',
      'trigger.accepted',
      'run.resumed',
      'node.started',
      'node.retrying',
      'node.timed_out',
      'node.completed',
      'node.failed',
      'human.requested',
      'human.resolved',
      'wait.scheduled',
      'wait.resumed',
      'event.waiting',
      'event.received',
      'subgraph.started',
      'subgraph.completed',
      'loop.iteration',
      'map.started',
      'map.completed',
      'escalation.raised',
      'compensation.started',
      'compensation.completed',
      'tool.requested',
      'tool.approval_requested',
      'tool.approval_resolved',
      'tool.started',
      'tool.completed',
      'tool.denied',
      'tool.failed',
      'run.paused',
      'run.completed',
      'run.failed',
      'run.cancelled',
    ]),
    nodeId: identifierSchema.optional(),
    detail: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const graphCheckpointSchema = z
  .object({
    runId: identifierSchema,
    graphId: identifierSchema,
    graphVersion: z.number().int().positive(),
    state: z.record(z.string(), z.unknown()),
    completedNodeIds: z.array(identifierSchema),
    readyNodeIds: z.array(identifierSchema),
    arrivals: z.record(identifierSchema, z.array(identifierSchema)),
    nextSeq: z.number().int().positive(),
    stepCount: z.number().int().nonnegative(),
    startedAt: z.string().datetime(),
    suspensions: z.record(identifierSchema, z.unknown()).default({}),
    consumedEventIds: z.array(identifierSchema).default([]),
  })
  .strict();

export const graphRunRecordSchema = z
  .object({
    runId: identifierSchema,
    graphId: identifierSchema,
    graphVersion: z.number().int().positive(),
    status: graphRunStatusSchema,
    state: z.record(z.string(), z.unknown()),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    error: z.string().nullable().default(null),
  })
  .strict();

export const distributedRunRequestSchema = z
  .object({
    formatVersion: z.literal(1),
    runId: identifierSchema,
    packId: identifierSchema,
    graphId: identifierSchema,
    graphVersion: z.number().int().positive(),
    input: z.record(z.string(), z.unknown()),
    submittedAt: z.string().datetime(),
  })
  .strict();

export type GraphRunStatus = z.infer<typeof graphRunStatusSchema>;
export type GraphEvent = z.infer<typeof graphEventSchema>;
export type GraphCheckpoint = z.infer<typeof graphCheckpointSchema>;
export type GraphRunRecord = z.infer<typeof graphRunRecordSchema>;
export type DistributedRunRequest = z.infer<typeof distributedRunRequestSchema>;
