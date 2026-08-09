import type { ToolAdapterRegistry } from '@graphwork/core';

const documents = [
  {
    locator: 'reference://market/interview-synthesis',
    domain: 'market',
    title: 'Interview synthesis',
    content: 'Teams adopt workflow infrastructure when it maps to a repeated operational job with a visible owner and outcome.',
  },
  {
    locator: 'reference://market/developer-onboarding',
    domain: 'market',
    title: 'Developer onboarding study',
    content: 'A runnable reference workflow reduces time-to-value before teams customize roles, tools and quality gates.',
  },
  {
    locator: 'reference://technology/contract-test',
    domain: 'technology',
    title: 'Graph contract test',
    content: 'Typed graph contracts keep runtime mechanisms independent from Pack-owned domain semantics.',
  },
  {
    locator: 'reference://technology/runtime-test',
    domain: 'technology',
    title: 'Runtime checkpoint test',
    content: 'Ordered events and durable checkpoints make human-gated workflows resumable and auditable.',
  },
] as const;

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

export const researchTools: ToolAdapterRegistry = {
  source_search: {
    execute: (input) => {
      const request = inputRecord(input);
      const domain = typeof request.domain === 'string' ? request.domain : '';
      const matches = domain ? documents.filter((item) => item.domain === domain) : documents;
      return matches.map(({ locator, domain: sourceDomain, title }) => ({
        locator,
        domain: sourceDomain,
        title,
      }));
    },
  },
  document_read: {
    execute: (input) => {
      const locator = inputRecord(input).locator;
      const document = documents.find((item) => item.locator === locator);
      if (!document) throw new Error(`Document "${String(locator ?? '')}" is not available.`);
      return document;
    },
  },
};
