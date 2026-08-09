import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IndustryPackManifest } from '@graphwork/contracts';
import type { HandlerRegistry } from '@graphwork/core';

export interface LoadedPackModule {
  readonly pack: IndustryPackManifest;
  readonly handlers: HandlerRegistry;
  readonly source: string;
  readonly projector?: (store: unknown, run: unknown) => Promise<void>;
}

export async function loadPackModule(filePath: string): Promise<LoadedPackModule> {
  const absolutePath = resolve(filePath);
  if (extname(absolutePath).toLowerCase() === '.json') {
    const pack = JSON.parse(await readFile(absolutePath, 'utf8')) as IndustryPackManifest;
    return { pack, handlers: {}, source: absolutePath };
  }

  const modifiedAt = (await stat(absolutePath)).mtimeMs;
  const imported = (await import(`${pathToFileURL(absolutePath).href}?mtime=${modifiedAt}`)) as Record<string, unknown>;
  const pack = (imported.pack ?? imported.default) as IndustryPackManifest | undefined;
  if (!pack) {
    throw new Error(`Pack module "${absolutePath}" must export "pack" or a default manifest.`);
  }
  const handlers = (imported.handlers ?? {}) as HandlerRegistry;
  return {
    pack,
    handlers,
    source: absolutePath,
    ...(typeof imported.projector === 'function'
      ? { projector: imported.projector as (store: unknown, run: unknown) => Promise<void> }
      : {}),
  };
}
