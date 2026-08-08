import { createHash } from 'node:crypto';

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Integrity payload numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (typeof value !== 'object') throw new Error(`Integrity payload cannot contain ${typeof value}.`);
  if (seen.has(value)) throw new Error('Integrity payload cannot contain circular references.');
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) output[key] = normalize(item, seen);
  }
  seen.delete(value);
  return output;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
