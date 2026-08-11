import type { GraphEvent, IndustryPackManifest } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState, HandlerRegistry, ToolAdapterRegistry } from '@graph-workbench/core';
import {
  listInstalledPacks,
  loadInstalledPackIsolated,
  type IsolatedPackPolicy,
} from '@graph-workbench/pack-sdk';
import {
  architectureHandlers,
  architecturePack,
  projectArchitectureRun,
} from '@graph-workbench/pack-architecture';
import {
  customerSuccessHandlers,
  customerSuccessPack,
  projectCustomerSuccessRun,
} from '@graph-workbench/pack-customer-success';
import {
  projectResearchRun,
  researchHandlers,
  researchPack,
  researchTools,
} from '@graph-workbench/pack-research';
import {
  projectSoftwareDeliveryRun,
  softwareDeliveryHandlers,
  softwareDeliveryPack,
  softwareDeliveryTools,
} from '@graph-workbench/pack-software-delivery';

export interface PackRuntimeDefinition {
  readonly manifest: IndustryPackManifest;
  readonly handlers: HandlerRegistry;
  readonly tools?: ToolAdapterRegistry;
  readonly projector?: (
    store: ContextGraphStore,
    run: {
      readonly runId: string;
      readonly state: GraphState;
      readonly events?: readonly GraphEvent[];
    },
  ) => Promise<void>;
  readonly executionMode: 'in-process' | 'isolated-container' | 'unsafe-process';
  readonly trustSource: 'bundled' | 'local-explicit' | 'signed-registry';
  readonly publisherKeyId?: string;
}

export const bundledPackCatalog = new Map<string, PackRuntimeDefinition>([
  [
    softwareDeliveryPack.id,
    {
      manifest: softwareDeliveryPack,
      handlers: softwareDeliveryHandlers,
      tools: softwareDeliveryTools,
      projector: projectSoftwareDeliveryRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    architecturePack.id,
    {
      manifest: architecturePack,
      handlers: architectureHandlers,
      projector: projectArchitectureRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    customerSuccessPack.id,
    {
      manifest: customerSuccessPack,
      handlers: customerSuccessHandlers,
      projector: projectCustomerSuccessRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    researchPack.id,
    {
      manifest: researchPack,
      handlers: researchHandlers,
      tools: researchTools,
      projector: projectResearchRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
]);

export interface PackDiscoveryResult {
  readonly loaded: number;
  readonly errors: readonly string[];
}

export async function discoverInstalledPackRuntimes(
  root = '.graph-workbench/packs',
  policy: IsolatedPackPolicy = { container: {} },
): Promise<PackDiscoveryResult> {
  const registry = listInstalledPacks(root);
  let loadedCount = 0;
  const errors: string[] = [];
  for (const id of Object.keys(registry.packs).sort()) {
    try {
      const loaded = await loadInstalledPackIsolated(id, root, policy);
      bundledPackCatalog.set(loaded.pack.id, {
        manifest: loaded.pack,
        handlers: loaded.handlers,
        ...(loaded.projector
          ? { projector: (store, run) => loaded.projector!(store, run) }
          : {}),
        executionMode: loaded.isolationMode === 'container' ? 'isolated-container' : 'unsafe-process',
        trustSource: loaded.installation.trustSource?.mode ?? 'local-explicit',
        ...(loaded.installation.trustSource?.mode === 'signed-registry'
          ? { publisherKeyId: loaded.installation.trustSource.publisherKeyId }
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
