import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IndustryPackManifest } from '@graph-native/contracts';
import type { HandlerRegistry } from '@graph-native/core';

export interface LoadedPackModule {
  readonly pack: IndustryPackManifest;
  readonly handlers: HandlerRegistry;
  readonly source: string;
}

export async function loadPackModule(filePath: string): Promise<LoadedPackModule> {
  const absolutePath = resolve(filePath);
  if (extname(absolutePath).toLowerCase() === '.json') {
    const pack = JSON.parse(await readFile(absolutePath, 'utf8')) as IndustryPackManifest;
    return { pack, handlers: {}, source: absolutePath };
  }

  const imported = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  const pack = (imported.pack ?? imported.default) as IndustryPackManifest | undefined;
  if (!pack) {
    throw new Error(`Pack module "${absolutePath}" must export "pack" or a default manifest.`);
  }
  const handlers = (imported.handlers ?? {}) as HandlerRegistry;
  return { pack, handlers, source: absolutePath };
}
