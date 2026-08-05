import type { ContextObject, ContextRelation, GraphEvent } from '@graph-native/contracts';
import type { ContextGraphStore, GraphState } from '@graph-native/core';

interface CompletedResearchRun {
  readonly runId: string;
  readonly state: GraphState;
  readonly events?: readonly GraphEvent[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asEvidence(value: unknown): Array<{ claim: string; source: string }> {
  return Array.isArray(value) ? (value as Array<{ claim: string; source: string }>) : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function modelUsageEvents(events: readonly GraphEvent[] = []) {
  return events.flatMap((event) => {
    if (event.type !== 'node.completed' || !event.nodeId) return [];
    const usage = asRecord(event.detail.usage);
    if (!usage || typeof usage.providerId !== 'string' || typeof usage.model !== 'string') return [];
    return [{ event, usage }];
  });
}

export async function projectResearchRun(
  store: ContextGraphStore,
  run: CompletedResearchRun,
): Promise<void> {
  if (run.state.approved !== true || typeof run.state.deliverable !== 'string') {
    throw new Error('Only an approved research run with a deliverable can be confirmed.');
  }

  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const briefId = `${base}.brief`;
  const deliverableId = `${base}.deliverable`;
  const decisionId = `${base}.decision`;
  const common = (nodeId: string) => ({
    sourceIds: [],
    producedByRunId: run.runId,
    producedByNodeId: nodeId,
    actorId: 'system.runtime',
    recordedAt,
  });

  const objects: ContextObject[] = [
    {
      id: briefId,
      type: 'research_brief',
      version: 1,
      status: 'confirmed',
      data: { goal: asString(run.state.goal), scope: asString(run.state.brief) },
      validFrom: recordedAt,
      validTo: null,
      provenance: common('normalize_brief'),
    },
    {
      id: decisionId,
      type: 'decision',
      version: 1,
      status: 'confirmed',
      data: { approved: true, rationale: asString(run.state.review_status) },
      validFrom: recordedAt,
      validTo: null,
      provenance: { ...common('approval'), actorId: 'role.reviewer' },
    },
    {
      id: deliverableId,
      type: 'deliverable',
      version: 1,
      status: 'confirmed',
      data: { content: run.state.deliverable, approved: true },
      validFrom: recordedAt,
      validTo: null,
      provenance: common('publish'),
    },
  ];

  const calls = modelUsageEvents(run.events);
  calls.forEach(({ event, usage }) => {
    objects.push({
      id: `${base}.model.${event.nodeId}.${event.seq}`,
      type: 'model_call',
      version: 1,
      status: 'confirmed',
      data: {
        provider_id: usage.providerId,
        protocol: typeof usage.protocol === 'string' ? usage.protocol : 'unknown',
        model: usage.model,
        ...(typeof usage.inputTokens === 'number' ? { input_tokens: usage.inputTokens } : {}),
        ...(typeof usage.outputTokens === 'number' ? { output_tokens: usage.outputTokens } : {}),
        ...(typeof usage.latencyMs === 'number' ? { latency_ms: usage.latencyMs } : {}),
        ...(typeof usage.requestId === 'string' ? { request_id: usage.requestId } : {}),
      },
      validFrom: recordedAt,
      validTo: null,
      provenance: { ...common(event.nodeId!), actorId: `provider.${usage.providerId}` },
    });
  });

  const evidenceStreams = [
    { name: 'market', nodeId: 'market_research', items: asEvidence(run.state.market_evidence) },
    { name: 'technology', nodeId: 'technology_research', items: asEvidence(run.state.technology_evidence) },
  ];
  for (const stream of evidenceStreams) {
    stream.items.forEach((item, index) => {
      objects.push({
        id: `${base}.evidence.${stream.name}.${index + 1}`,
        type: 'evidence',
        version: 1,
        status: 'confirmed',
        data: item,
        validFrom: recordedAt,
        validTo: null,
        provenance: common(stream.nodeId),
      });
    });
  }

  for (const object of objects) await store.appendObject(object);

  const evidence = objects.filter((object) => object.type === 'evidence');
  const relations: ContextRelation[] = [
    ...evidence.flatMap((object, index) => [
      {
        id: `${base}.relation.evidence.${index + 1}.brief`,
        type: 'scoped_by',
        sourceId: object.id,
        targetId: briefId,
        version: 1,
        attributes: {},
        validFrom: recordedAt,
        validTo: null,
        provenance: common(object.provenance.producedByNodeId ?? 'synthesize'),
      },
      {
        id: `${base}.relation.evidence.${index + 1}.deliverable`,
        type: 'supports',
        sourceId: object.id,
        targetId: deliverableId,
        version: 1,
        attributes: {},
        validFrom: recordedAt,
        validTo: null,
        provenance: common('synthesize'),
      },
    ]),
    {
      id: `${base}.relation.decision.deliverable`,
      type: 'governs',
      sourceId: decisionId,
      targetId: deliverableId,
      version: 1,
      attributes: {},
      validFrom: recordedAt,
      validTo: null,
      provenance: { ...common('approval'), actorId: 'role.reviewer' },
    },
    ...calls.map(({ event }) => ({
      id: `${base}.relation.model.${event.seq}.deliverable`,
      type: 'contributed_to',
      sourceId: `${base}.model.${event.nodeId}.${event.seq}`,
      targetId: deliverableId,
      version: 1,
      attributes: {},
      validFrom: recordedAt,
      validTo: null,
      provenance: common(event.nodeId ?? 'synthesize'),
    })),
  ];
  for (const relation of relations) await store.appendRelation(relation);
}
