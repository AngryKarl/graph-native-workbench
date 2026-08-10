import type { IndustryPackManifest } from '@graph-workbench/contracts';
import { compilePack, type HandlerRegistry } from '@graph-workbench/core';

export function definePack(manifest: IndustryPackManifest): IndustryPackManifest {
  return compilePack(manifest).manifest;
}

export function defineHandlers<const T extends HandlerRegistry>(handlers: T): T {
  return handlers;
}
