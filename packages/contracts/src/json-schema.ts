import { z } from 'zod';
import { graphDefinitionSchema } from './graph.js';
import { industryPackManifestSchema } from './pack.js';

export const graphDefinitionJsonSchema = z.toJSONSchema(graphDefinitionSchema, {
  target: 'draft-7',
});

export const industryPackJsonSchema = z.toJSONSchema(industryPackManifestSchema, {
  target: 'draft-7',
});
