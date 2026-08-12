import { z } from 'zod';

export const jsonSchemaDefinitionSchema = z
  .record(z.string(), z.unknown())
  .superRefine((schema, context) => {
    try {
      z.fromJSONSchema(schema as never);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: `Unsupported JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

export type JsonSchemaDefinition = z.infer<typeof jsonSchemaDefinitionSchema>;

export function parseJsonSchemaValue(schema: JsonSchemaDefinition, value: unknown): unknown {
  return z.fromJSONSchema(schema as never).parse(value);
}
