import type { HandlerRegistry } from '@graph-workbench/core';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asEvidence(value: unknown): Array<{ claim: string; source: string }> {
  return Array.isArray(value) ? (value as Array<{ claim: string; source: string }>) : [];
}

export const researchHandlers: HandlerRegistry = {
  'research.normalize_brief': ({ state }) => ({
    brief: `Investigate "${asString(state.goal)}" across adoption value, implementation feasibility, and operational risk.`,
  }),

  'research.market_evidence': ({ state }) => ({
    market_evidence: [
      {
        claim: `The problem must be validated with a repeatable user workflow: ${asString(state.brief)}`,
        source: 'reference://market/interview-synthesis',
      },
      {
        claim: 'Adoption improves when a reference workflow produces value before customization.',
        source: 'reference://market/developer-onboarding',
      },
    ],
  }),

  'research.technology_evidence': ({ state }) => ({
    technology_evidence: [
      {
        claim: `A typed graph contract can separate runtime behavior from domain content: ${asString(state.brief)}`,
        source: 'reference://technology/contract-test',
      },
      {
        claim: 'Checkpointed human gates make long-running workflows resumable and auditable.',
        source: 'reference://technology/runtime-test',
      },
    ],
  }),

  'research.synthesize': ({ state }) => {
    const evidence = [
      ...asEvidence(state.market_evidence),
      ...asEvidence(state.technology_evidence),
    ];
    return {
      synthesis: [
        `Research brief: ${asString(state.brief)}`,
        ...evidence.map((item, index) => `${index + 1}. ${item.claim} [${item.source}]`),
      ].join('\n'),
    };
  },

  'research.quality_check': ({ state }) => {
    const market = asEvidence(state.market_evidence);
    const technology = asEvidence(state.technology_evidence);
    const passed = market.length > 0 && technology.length > 0 && asString(state.synthesis).length > 0;
    if (!passed) throw new Error('Evidence coverage gate failed.');
    return { review_status: `passed:${market.length + technology.length}-evidence-items` };
  },

  'research.publish': ({ state }) => ({
    deliverable: [
      '# Approved research deliverable',
      '',
      asString(state.synthesis),
      '',
      `Quality gate: ${asString(state.review_status)}`,
      'Human approval: approved',
    ].join('\n'),
  }),

  'research.record_rejection': ({ state }) => ({
    rejection_reason: `Human reviewer rejected publication after ${asString(state.review_status)}.`,
  }),
};
