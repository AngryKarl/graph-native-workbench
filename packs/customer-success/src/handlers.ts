import type { HandlerRegistry } from '@graph-workbench/core';

interface HealthSignal {
  readonly kind: string;
  readonly value: string;
  readonly trend: string;
  readonly source: string;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function signals(value: unknown): HealthSignal[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HealthSignal => Boolean(
    item && typeof item === 'object'
      && typeof (item as HealthSignal).kind === 'string'
      && typeof (item as HealthSignal).value === 'string'
      && typeof (item as HealthSignal).trend === 'string'
      && typeof (item as HealthSignal).source === 'string',
  ));
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export const customerSuccessHandlers: HandlerRegistry = {
  'customer_success.normalize_account': ({ state }) => ({
    account_profile: {
      name: stringValue(state.account_name),
      segment: stringValue(state.segment),
      renewal_date: stringValue(state.renewal_date),
      arr_usd: numberValue(state.arr_usd),
      outcomes: strings(state.success_outcomes),
    },
  }),

  'customer_success.analyze_product_health': ({ state }) => ({
    product_findings: signals(state.health_signals).map((signal) => ({
      signal: `${signal.kind}: ${signal.value}`,
      trend: signal.trend,
      source: signal.source,
      impact: signal.trend === 'declining'
        ? 'Treat as an active adoption risk and assign a dated recovery action.'
        : 'Preserve the behavior and connect it to a measurable customer outcome.',
    })),
  }),

  'customer_success.analyze_stakeholders': ({ state }) => ({
    stakeholder_findings: strings(state.stakeholder_notes).map((note, index) => ({
      stakeholder: index === 0 ? 'Executive sponsor' : `Stakeholder ${index + 1}`,
      observation: note,
      risk: /left|blocked|concern|delay|budget|unresponsive/i.test(note)
        ? 'attention-required'
        : 'monitor',
    })),
  }),

  'customer_success.assess_renewal_risk': ({ state }) => {
    const product = records<{ trend: string }>(state.product_findings);
    const stakeholders = records<{ risk: string }>(state.stakeholder_findings);
    const declining = product.filter((item) => item.trend === 'declining').length;
    const attention = stakeholders.filter((item) => item.risk === 'attention-required').length;
    const score = Math.min(100, declining * 30 + attention * 25 + (product.length === 0 ? 30 : 0));
    const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    return {
      renewal_risk: {
        score,
        level,
        rationale: `${declining} declining product signal(s) and ${attention} stakeholder concern(s).`,
      },
    };
  },

  'customer_success.build_intervention_plan': ({ state }) => {
    const product = records<{ signal: string; trend: string; impact: string }>(state.product_findings);
    const stakeholders = records<{ stakeholder: string; observation: string; risk: string }>(state.stakeholder_findings);
    const actions = [
      ...product.filter((item) => item.trend === 'declining').map((item, index) => ({
        owner: 'Customer Success Manager',
        due_in_days: 7 + index * 7,
        action: `Recover ${item.signal.toLowerCase()} through a targeted enablement session.`,
        success_measure: 'Usage trend returns to stable or growing.',
      })),
      ...stakeholders.filter((item) => item.risk === 'attention-required').map((item, index) => ({
        owner: index === 0 ? 'Revenue owner' : 'Customer Success Manager',
        due_in_days: 5 + index * 5,
        action: `Resolve stakeholder concern: ${item.observation}`,
        success_measure: `${item.stakeholder} confirms an owner and next decision date.`,
      })),
    ];
    if (actions.length === 0) {
      actions.push({
        owner: 'Customer Success Manager',
        due_in_days: 14,
        action: 'Document realized value against the agreed success outcomes.',
        success_measure: 'Customer validates an outcome summary before renewal review.',
      });
    }
    return { intervention_plan: actions };
  },

  'customer_success.quality_gate': ({ state }) => {
    const sourceCount = signals(state.health_signals).filter((item) => item.source.length > 0).length;
    const actions = records<{ owner: string; due_in_days: number; success_measure: string }>(state.intervention_plan);
    if (sourceCount === 0) throw new Error('Renewal review requires at least one attributable health signal.');
    if (actions.length === 0 || actions.some((item) => !item.owner || !item.due_in_days || !item.success_measure)) {
      throw new Error('Every intervention requires an owner, deadline and success measure.');
    }
    return { review_status: `passed:${sourceCount}-sources:${actions.length}-actions` };
  },

  'customer_success.publish_plan': ({ state }) => {
    const risk = state.renewal_risk as { score?: number; level?: string; rationale?: string } | undefined;
    const actions = records<{ owner: string; due_in_days: number; action: string; success_measure: string }>(state.intervention_plan);
    return {
      deliverable: [
        `# Renewal success plan — ${stringValue(state.account_name)}`,
        '',
        `**Renewal date:** ${stringValue(state.renewal_date)}`,
        `**ARR:** $${numberValue(state.arr_usd).toLocaleString('en-US')}`,
        `**Risk:** ${risk?.level ?? 'unknown'} (${risk?.score ?? 0}/100)`,
        '',
        '## Evidence-based assessment',
        risk?.rationale ?? 'No assessment available.',
        '',
        '## Intervention plan',
        ...actions.map((item, index) => [
          `${index + 1}. **${item.action}**`,
          `   - Owner: ${item.owner}`,
          `   - Due: ${item.due_in_days} days`,
          `   - Success: ${item.success_measure}`,
        ].join('\n')),
        '',
        `Quality gate: ${stringValue(state.review_status)}`,
        'Revenue-owner approval: approved',
      ].join('\n'),
    };
  },

  'customer_success.record_rejection': ({ state }) => ({
    rejection_reason: `Revenue owner rejected the plan after ${stringValue(state.review_status)}.`,
  }),

  'customer_success.advance_scan': ({ state }) => {
    const scanAttempt = numberValue(state.scan_attempt) + 1;
    return { scan_attempt: scanAttempt, continue_scan: scanAttempt < 2 };
  },

  'customer_success.score_scheduled_account': ({ state }) => ({
    result: { account: state.item, scored_at: 'scheduled-scan' },
  }),

  'customer_success.sync_health_alert': ({ state }) => {
    if (state.simulate_failure === true) throw new Error('Health alert sync failed.');
    return { recovered: false };
  },

  'customer_success.compensate_health_alert': () => ({ recovered: true }),
};
