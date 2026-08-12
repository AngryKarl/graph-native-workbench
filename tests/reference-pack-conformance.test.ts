import { describe, expect, it } from 'vitest';
import { graphNodeKindSchema, type IndustryPackManifest } from '@graph-workbench/contracts';
import type { HandlerRegistry } from '@graph-workbench/core';
import { validatePackHandlerCoverage } from '@graph-workbench/pack-sdk';
import { architectureHandlers, architecturePack } from '@graph-workbench/pack-architecture';
import { customerSuccessHandlers, customerSuccessPack } from '@graph-workbench/pack-customer-success';
import { cybersecurityResponseHandlers, cybersecurityResponsePack } from '@graph-workbench/pack-cybersecurity-response';
import { dataMlopsHandlers, dataMlopsPack } from '@graph-workbench/pack-data-mlops';
import { healthcareDiagnosticsHandlers, healthcareDiagnosticsPack } from '@graph-workbench/pack-healthcare-diagnostics';
import { researchHandlers, researchPack } from '@graph-workbench/pack-research';
import { quantitativeFinanceHandlers, quantitativeFinancePack } from '@graph-workbench/pack-quantitative-finance';
import { softwareDeliveryHandlers, softwareDeliveryPack } from '@graph-workbench/pack-software-delivery';
import { roboticsFleetHandlers, roboticsFleetPack } from '@graph-workbench/pack-robotics-fleet';

const firstPartyPacks: ReadonlyArray<readonly [IndustryPackManifest, HandlerRegistry]> = [
  [researchPack, researchHandlers],
  [quantitativeFinancePack, quantitativeFinanceHandlers],
  [architecturePack, architectureHandlers],
  [customerSuccessPack, customerSuccessHandlers],
  [softwareDeliveryPack, softwareDeliveryHandlers],
  [roboticsFleetPack, roboticsFleetHandlers],
  [dataMlopsPack, dataMlopsHandlers],
  [healthcareDiagnosticsPack, healthcareDiagnosticsHandlers],
  [cybersecurityResponsePack, cybersecurityResponseHandlers],
];

describe('first-party Pack node conformance', () => {
  it('binds every executable node and demonstrates every public node kind', () => {
    const demonstrated = new Set<string>();
    for (const [pack, handlers] of firstPartyPacks) {
      expect(() => validatePackHandlerCoverage(pack, handlers)).not.toThrow();
      for (const graph of pack.graphs) {
        for (const node of graph.nodes) demonstrated.add(node.kind);
      }
    }

    expect([...demonstrated].sort()).toEqual([...graphNodeKindSchema.options].sort());
  });
});
