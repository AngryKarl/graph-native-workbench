import type { IndustryPackManifest } from '@graph-native/contracts';
import type { ContextGraphStore, GraphState, HandlerRegistry } from '@graph-native/core';
import { listInstalledPacks, loadInstalledPack } from '@graph-native/pack-sdk';
import {
  architectureHandlers,
  architecturePack,
  projectArchitectureRun,
} from '@graph-native/pack-architecture';
import {
  projectResearchRun,
  researchHandlers,
  researchPack,
} from '@graph-native/pack-research';

export interface PackRuntimeDefinition {
  readonly manifest: IndustryPackManifest;
  readonly handlers: HandlerRegistry;
  readonly projector?: (
    store: ContextGraphStore,
    run: { readonly runId: string; readonly state: GraphState },
  ) => Promise<void>;
}

export const bundledPackCatalog = new Map<string, PackRuntimeDefinition>([
  [
    architecturePack.id,
    {
      manifest: architecturePack,
      handlers: architectureHandlers,
      projector: projectArchitectureRun,
    },
  ],
  [
    researchPack.id,
    {
      manifest: researchPack,
      handlers: researchHandlers,
      projector: projectResearchRun,
    },
  ],
]);

export interface PackDiscoveryResult {
  readonly loaded: number;
  readonly errors: readonly string[];
}

export async function discoverInstalledPackRuntimes(root = '.graphwork/packs'): Promise<PackDiscoveryResult> {
  const registry = listInstalledPacks(root);
  let loadedCount = 0;
  const errors: string[] = [];
  for (const id of Object.keys(registry.packs).sort()) {
    try {
      const loaded = await loadInstalledPack(id, root);
      bundledPackCatalog.set(loaded.pack.id, {
        manifest: loaded.pack,
        handlers: loaded.handlers,
        ...(loaded.projector
          ? { projector: (store, run) => loaded.projector!(store, run) }
          : {}),
      });
      loadedCount += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { loaded: loadedCount, errors };
}

export function requirePackRuntime(packId: string): PackRuntimeDefinition {
  const runtime = bundledPackCatalog.get(packId);
  if (!runtime) throw new Error(`Pack "${packId}" is not available in this registry.`);
  return runtime;
}
