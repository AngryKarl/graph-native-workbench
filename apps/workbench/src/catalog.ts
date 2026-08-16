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
  cybersecurityResponseHandlers,
  cybersecurityResponsePack,
  cybersecurityResponseTools,
  projectCybersecurityResponseRun,
} from '@graph-workbench/pack-cybersecurity-response';
import {
  dataMlopsHandlers,
  dataMlopsPack,
  dataMlopsTools,
  projectDataMlopsRun,
} from '@graph-workbench/pack-data-mlops';
import {
  projectResearchRun,
  researchHandlers,
  researchPack,
  researchTools,
} from '@graph-workbench/pack-research';
import {
  projectQuantitativeFinanceRun,
  quantitativeFinanceHandlers,
  quantitativeFinancePack,
  quantitativeFinanceTools,
} from '@graph-workbench/pack-quantitative-finance';
import {
  healthcareDiagnosticsHandlers,
  healthcareDiagnosticsPack,
  healthcareDiagnosticsTools,
  projectHealthcareDiagnosticsRun,
} from '@graph-workbench/pack-healthcare-diagnostics';
import {
  projectRoboticsFleetRun,
  roboticsFleetHandlers,
  roboticsFleetPack,
  roboticsFleetTools,
} from '@graph-workbench/pack-robotics-fleet';
import {
  projectSoftwareDeliveryRun,
  softwareDeliveryHandlers,
  softwareDeliveryPack,
  softwareDeliveryTools,
} from '@graph-workbench/pack-software-delivery';
import {
  createGitHubToolsFromEnvironment,
  GitHubClient,
  readAuthenticatedIdentity,
  readGitHubConnectorStatus,
  type GitHubConnectorStatus,
  type VerifiedGitHubIdentity,
} from '@graph-workbench/connector-github';

/**
 * Software Delivery runs against real GitHub when a token is configured and
 * falls back to the deterministic zero-key adapters otherwise, so the
 * credential-free first run keeps working unchanged.
 */
export const gitHubConnector: GitHubConnectorStatus = readGitHubConnectorStatus();
const softwareDeliveryAdapters = createGitHubToolsFromEnvironment() ?? softwareDeliveryTools;

export interface VerifiedIdentityResult {
  readonly identity?: VerifiedGitHubIdentity;
  readonly reason?: string;
}

let verifiedIdentity: Promise<VerifiedIdentityResult> | undefined;

/**
 * Resolves the GitHub account the configured token belongs to, once per
 * process. A failure is cached as a reason rather than retried on every
 * request, and never locks the operator out of their own workspace.
 */
export function resolveVerifiedIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedIdentityResult> {
  verifiedIdentity ??= (async (): Promise<VerifiedIdentityResult> => {
    if (!gitHubConnector.configured) return { reason: gitHubConnector.reason ?? 'The GitHub connector is not configured.' };
    const token = environment.GITHUB_TOKEN?.trim();
    if (!token) return { reason: 'GITHUB_TOKEN is not available to the Workbench process.' };
    try {
      const client = new GitHubClient({
        token,
        ...(gitHubConnector.baseUrl ? { baseUrl: gitHubConnector.baseUrl } : {}),
      });
      return { identity: await readAuthenticatedIdentity(client) };
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
  })();
  return verifiedIdentity;
}

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
    roboticsFleetPack.id,
    {
      manifest: roboticsFleetPack,
      handlers: roboticsFleetHandlers,
      tools: roboticsFleetTools,
      projector: projectRoboticsFleetRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    healthcareDiagnosticsPack.id,
    {
      manifest: healthcareDiagnosticsPack,
      handlers: healthcareDiagnosticsHandlers,
      tools: healthcareDiagnosticsTools,
      projector: projectHealthcareDiagnosticsRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    quantitativeFinancePack.id,
    {
      manifest: quantitativeFinancePack,
      handlers: quantitativeFinanceHandlers,
      tools: quantitativeFinanceTools,
      projector: projectQuantitativeFinanceRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    cybersecurityResponsePack.id,
    {
      manifest: cybersecurityResponsePack,
      handlers: cybersecurityResponseHandlers,
      tools: cybersecurityResponseTools,
      projector: projectCybersecurityResponseRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    dataMlopsPack.id,
    {
      manifest: dataMlopsPack,
      handlers: dataMlopsHandlers,
      tools: dataMlopsTools,
      projector: projectDataMlopsRun,
      executionMode: 'in-process',
      trustSource: 'bundled',
    },
  ],
  [
    softwareDeliveryPack.id,
    {
      manifest: softwareDeliveryPack,
      handlers: softwareDeliveryHandlers,
      tools: softwareDeliveryAdapters,
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
