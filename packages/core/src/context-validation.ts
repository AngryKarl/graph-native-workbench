import type {
  ContextObject,
  ContextRelation,
  IndustryPackManifest,
} from '@graph-workbench/contracts';
import { assertValidState } from './state.js';

export function assertPackObject(
  pack: IndustryPackManifest | undefined,
  object: ContextObject,
): void {
  if (!pack) return;
  const objectType = pack.ontology.objectTypes.find((item) => item.id === object.type);
  if (!objectType) throw new Error(`Pack does not declare context object type "${object.type}".`);
  assertValidState({ fields: objectType.fields }, object.data, { requireAllRequired: true });
}

export function assertPackRelation(
  pack: IndustryPackManifest | undefined,
  relation: ContextRelation,
  source: ContextObject,
  target: ContextObject,
): void {
  if (!pack) return;
  const relationType = pack.ontology.relationTypes.find((item) => item.id === relation.type);
  if (!relationType) throw new Error(`Pack does not declare relation type "${relation.type}".`);
  if (!relationType.sourceTypes.includes(source.type)) {
    throw new Error(`Relation "${relation.id}" cannot use source type "${source.type}".`);
  }
  if (!relationType.targetTypes.includes(target.type)) {
    throw new Error(`Relation "${relation.id}" cannot use target type "${target.type}".`);
  }
}
