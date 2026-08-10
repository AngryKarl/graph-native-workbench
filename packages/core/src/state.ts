import type { GraphStateDefinition, StateValueType } from '@graph-workbench/contracts';

export type GraphState = Record<string, unknown>;

function matchesType(value: unknown, type: StateValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

export function assertValidState(
  definition: GraphStateDefinition,
  state: GraphState,
  options: { requireAllRequired: boolean },
): void {
  const errors: string[] = [];
  for (const key of Object.keys(state)) {
    if (!(key in definition.fields)) errors.push(`State contains undeclared field "${key}".`);
  }
  for (const [key, field] of Object.entries(definition.fields)) {
    const value = state[key];
    if (value === undefined) {
      if (options.requireAllRequired && field.required) errors.push(`Required state field "${key}" is missing.`);
      continue;
    }
    if (!matchesType(value, field.type)) {
      errors.push(`State field "${key}" must be ${field.type}; received ${typeof value}.`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function assertValidPatch(
  definition: GraphStateDefinition,
  allowedWrites: readonly string[],
  patch: GraphState,
  nodeId: string,
): void {
  for (const key of Object.keys(patch)) {
    if (!allowedWrites.includes(key)) {
      throw new Error(`Node "${nodeId}" attempted to write undeclared output "${key}".`);
    }
  }
  assertValidState(definition, patch, { requireAllRequired: false });
}
