import { createRequire } from 'node:module';

globalThis.require = createRequire(import.meta.url);

class RecordingContextStore {
  objects = [];
  relations = [];

  async appendObject(object) {
    this.objects.push(structuredClone(object));
  }

  async appendRelation(relation) {
    this.relations.push(structuredClone(relation));
  }

  async getObject(id, version) {
    const candidates = this.objects.filter((item) => item.id === id);
    const selected = version === undefined
      ? candidates.sort((left, right) => right.version - left.version)[0]
      : candidates.find((item) => item.version === version);
    return selected ? structuredClone(selected) : undefined;
  }

  async listObjects() {
    return structuredClone(this.objects);
  }

  async listRelations() {
    return structuredClone(this.relations);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

process.once('message', async (request) => {
  try {
    const imported = await import(`${request.entry}?worker=${request.nonce}`);
    if (request.operation === 'handler') {
      const handler = imported.handlers?.[request.handlerId];
      if (typeof handler !== 'function') throw new Error(`Pack handler "${request.handlerId}" is not exported.`);
      const result = await handler({
        runId: request.context.runId,
        node: request.context.node,
        state: request.context.state,
        signal: new AbortController().signal,
      });
      process.send?.({ ok: true, result });
      return;
    }
    if (request.operation === 'projector') {
      if (typeof imported.projector !== 'function') throw new Error('Pack does not export a context projector.');
      const store = new RecordingContextStore();
      await imported.projector(store, request.run);
      process.send?.({ ok: true, result: { objects: store.objects, relations: store.relations } });
      return;
    }
    throw new Error('Unknown isolated Pack worker operation.');
  } catch (error) {
    process.send?.({ ok: false, error: errorMessage(error) });
  }
});
