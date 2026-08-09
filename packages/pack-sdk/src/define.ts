import type { IndustryPackManifest } from '@graphwork/contracts';
import { compilePack, type HandlerRegistry } from '@graphwork/core';

export function definePack(manifest: IndustryPackManifest): IndustryPackManifest {
  return compilePack(manifest).manifest;
}

export function defineHandlers<const T extends HandlerRegistry>(handlers: T): T {
  return handlers;
}
