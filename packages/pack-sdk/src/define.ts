import type { IndustryPackManifest } from '@graph-native/contracts';
import { compilePack, type HandlerRegistry } from '@graph-native/core';

export function definePack(manifest: IndustryPackManifest): IndustryPackManifest {
  return compilePack(manifest).manifest;
}

export function defineHandlers<const T extends HandlerRegistry>(handlers: T): T {
  return handlers;
}
