import {
  contextObjectSchema,
  contextRelationSchema,
  type ContextObject,
  type ContextRelation,
  type IndustryPackManifest,
} from '@graphwork/contracts';
import { assertPackObject, assertPackRelation } from './context-validation.js';

export interface ContextGraphStore {
  appendObject(object: ContextObject): Promise<void>;
  appendRelation(relation: ContextRelation): Promise<void>;
  getObject(id: string, version?: number): Promise<ContextObject | undefined>;
  listObjects(): Promise<readonly ContextObject[]>;
  listRelations(): Promise<readonly ContextRelation[]>;
}

export class InMemoryContextGraphStore implements ContextGraphStore {
  private readonly objects = new Map<string, ContextObject[]>();
  private readonly relations = new Map<string, ContextRelation[]>();

  constructor(private readonly pack?: IndustryPackManifest) {}

  async appendObject(input: ContextObject): Promise<void> {
    const object = contextObjectSchema.parse(input);
    const versions = this.objects.get(object.id) ?? [];
    if (versions.some((item) => item.version === object.version)) {
      throw new Error(`Context object "${object.id}" version ${object.version} already exists.`);
    }
    const expectedVersion = versions.length === 0 ? 1 : Math.max(...versions.map((item) => item.version)) + 1;
    if (object.version !== expectedVersion) {
      throw new Error(`Context object "${object.id}" must append version ${expectedVersion}.`);
    }

    assertPackObject(this.pack, object);
    versions.push(structuredClone(object));
    this.objects.set(object.id, versions);
  }

  async appendRelation(input: ContextRelation): Promise<void> {
    const relation = contextRelationSchema.parse(input);
    const versions = this.relations.get(relation.id) ?? [];
    if (versions.some((item) => item.version === relation.version)) {
      throw new Error(`Context relation "${relation.id}" version ${relation.version} already exists.`);
    }
    const expectedVersion = versions.length === 0 ? 1 : Math.max(...versions.map((item) => item.version)) + 1;
    if (relation.version !== expectedVersion) {
      throw new Error(`Context relation "${relation.id}" must append version ${expectedVersion}.`);
    }

    const source = await this.getObject(relation.sourceId);
    const target = await this.getObject(relation.targetId);
    if (!source) throw new Error(`Relation "${relation.id}" has unknown source object "${relation.sourceId}".`);
    if (!target) throw new Error(`Relation "${relation.id}" has unknown target object "${relation.targetId}".`);

    assertPackRelation(this.pack, relation, source, target);
    versions.push(structuredClone(relation));
    this.relations.set(relation.id, versions);
  }

  async getObject(id: string, version?: number): Promise<ContextObject | undefined> {
    const versions = this.objects.get(id) ?? [];
    const object = version === undefined
      ? versions.reduce<ContextObject | undefined>(
          (latest, item) => (!latest || item.version > latest.version ? item : latest),
          undefined,
        )
      : versions.find((item) => item.version === version);
    return object ? structuredClone(object) : undefined;
  }

  async listObjects(): Promise<readonly ContextObject[]> {
    return [...this.objects.values()].flat().map((item) => structuredClone(item));
  }

  async listRelations(): Promise<readonly ContextRelation[]> {
    return [...this.relations.values()].flat().map((item) => structuredClone(item));
  }
}
