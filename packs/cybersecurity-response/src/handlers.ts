import { createHash } from 'node:crypto';
import type { HandlerRegistry } from '@graph-workbench/core';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function items<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

interface EvidenceResult {
  evidence_ref: string;
  evidence_id: string;
  digest: string;
  status: string;
}

export const cybersecurityResponseHandlers: HandlerRegistry = {
  'cybersecurity_response.normalize_signal': ({ state }) => ({
    signal_record: {
      signal_id: text(state.signal_id),
      case_key: text(state.case_key),
      source: text(state.source),
      title: text(state.title),
      observed_at: text(state.observed_at),
      confidence: numeric(state.confidence),
    },
  }),

  'cybersecurity_response.prepare_evidence': ({ state }) => {
    const refs = items<string>(state.evidence_refs);
    if (refs.length === 0) throw new Error('Security triage requires at least one attributable evidence reference.');
    return { evidence_items: refs };
  },

  'cybersecurity_response.analyze_evidence': ({ state }) => {
    const evidenceRef = text(state.evidence_ref);
    return {
      result: {
        evidence_ref: evidenceRef,
        evidence_id: `evidence-${createHash('sha256').update(evidenceRef).digest('hex').slice(0, 16)}`,
        digest: `sha256:${createHash('sha256').update(`preserved:${evidenceRef}`).digest('hex')}`,
        status: 'preserved',
      },
    };
  },

  'cybersecurity_response.correlate_and_classify': ({ state }) => {
    const evidence = items<EvidenceResult>(state.evidence_results);
    const indicators = items<string>(state.indicators);
    const techniques = items<string>(state.technique_ids);
    const confidence = numeric(state.confidence);
    const likely = confidence >= 0.6 || indicators.length > 0 || techniques.length > 0;
    const hintedSeverity = text(state.severity_hint);
    const severity = likely && ['low', 'medium', 'high', 'critical'].includes(hintedSeverity)
      ? hintedSeverity
      : likely ? 'medium' : 'informational';
    return {
      incident_likely: likely,
      severity_assessment: {
        severity,
        confidence,
        indicator_count: indicators.length,
        technique_ids: techniques,
        evidence_count: evidence.length,
        rationale: likely
          ? 'Correlated evidence meets the declared incident threshold.'
          : 'Available evidence does not meet the incident threshold.',
      },
    };
  },

  'cybersecurity_response.declare_incident': ({ state }) => ({
    incident: {
      incident_id: `incident-${text(state.case_key)}`,
      case_key: text(state.case_key),
      title: text(state.title),
      severity: text(object(state.severity_assessment).severity),
      status: 'declared',
      affected_asset_ids: items(state.affected_asset_ids),
      affected_identity_ids: items(state.affected_identity_ids),
    },
  }),

  'cybersecurity_response.plan_containment': ({ state }) => {
    const assets = items<string>(state.affected_asset_ids);
    const identities = items<string>(state.affected_identity_ids);
    const actions = [
      ...identities.map((identityId) => ({ type: 'disable_identity_sessions', target_id: identityId, reversible: true })),
      ...assets.map((assetId) => ({ type: 'isolate_asset', target_id: assetId, reversible: true })),
    ];
    if (actions.length === 0) throw new Error('Containment requires at least one affected asset or identity.');
    return {
      containment_plan: {
        incident_id: text(object(state.incident).incident_id), actions,
        evidence_preserved: items(state.evidence_results).every((item) => object(item).status === 'preserved'),
      },
    };
  },

  'cybersecurity_response.execute_containment': ({ state }) => {
    const plan = object(state.containment_plan);
    const actions = items<Record<string, unknown>>(plan.actions);
    return {
      containment_results: actions.map((action, index) => ({
        action_id: `containment-${index + 1}`,
        type: text(action.type),
        target_id: text(action.target_id),
        status: 'completed',
        evidence_uri: `reference://containment/${encodeURIComponent(text(action.target_id))}`,
      })),
      containment_completed: true,
    };
  },

  'cybersecurity_response.notify_stakeholders': ({ state }) => ({
    notification_receipt: {
      incident_id: text(object(state.incident).incident_id),
      audience: items(state.notification_audience),
      status: 'sent',
    },
  }),

  'cybersecurity_response.prepare_recovery': ({ state }) => ({
    recovery_plan: {
      incident_id: text(object(state.incident).incident_id),
      eradicate: ['remove persistence', 'rotate exposed credentials', 'close exploited access path'],
      recover: ['restore from trusted state', 'verify controls', 'increase monitoring'],
      containment_result_count: items(state.containment_results).length,
    },
  }),

  'cybersecurity_response.execute_recovery': ({ state }) => ({
    recovery_result: {
      incident_id: text(object(state.incident).incident_id),
      status: 'recovered',
      verification: 'reference recovery checks passed',
    },
  }),

  'cybersecurity_response.capture_lessons': ({ state }) => ({
    lessons_learned: {
      incident_id: text(object(state.incident).incident_id),
      findings: [
        'Preserve detection evidence and containment decision provenance.',
        'Review exposed access paths and affected control coverage.',
      ],
      control_improvements: items(state.control_improvements),
    },
  }),

  'cybersecurity_response.publish_incident': ({ state }) => {
    const incident = object(state.incident);
    const severity = object(state.severity_assessment);
    return {
      incident_record: [
        `# Cybersecurity incident response — ${text(incident.incident_id)}`,
        '',
        `**Title:** ${text(state.title)}`,
        `**Severity:** ${text(severity.severity)}`,
        `**Status:** recovered`,
        `**Evidence preserved:** ${items(state.evidence_results).length}`,
        `**Containment actions:** ${items(state.containment_results).length}`,
        '',
        '## Governance',
        '- Incident declaration: approved',
        '- Containment execution: approved',
        '- Recovery execution: approved',
        '- Technical action authority remains in the connected security systems.',
      ].join('\n'),
    };
  },

  'cybersecurity_response.publish_non_incident': ({ state }) => ({
    incident_record: [
      `# Security triage closure — ${text(state.signal_id)}`,
      '',
      'Outcome: closed as non-incident',
      `Confidence: ${String(numeric(state.confidence))}`,
      `Evidence preserved: ${items(state.evidence_results).length}`,
    ].join('\n'),
  }),

  'cybersecurity_response.record_rejection': ({ state }) => ({
    rejection_reason: state.incident_declared === false
      ? 'Incident commander rejected incident declaration.'
      : state.containment_approved === false
        ? 'Containment approver rejected the proposed high-impact actions.'
        : 'Recovery owner rejected the recovery plan.',
  }),

  'cybersecurity_response.assess_recovery': ({ state }) => {
    const signals = items<Record<string, unknown>>(state.health_signals);
    const healthy = text(state.recovery_status) === 'healthy'
      && signals.length > 0
      && signals.every((signal) => ['healthy', 'ok', 'passed'].includes(text(signal.status)));
    return {
      recovery_healthy: healthy,
      recovery_observation: {
        incident_id: text(state.incident_id),
        recovery_id: text(state.recovery_id),
        status: text(state.recovery_status),
        signal_count: signals.length,
        healthy,
      },
    };
  },

  'cybersecurity_response.rollback_recovery_change': ({ state }) => ({
    recovery_rollback_completed: true,
    recovery_rollback_reference: `reference://recovery-rollback/${encodeURIComponent(text(state.recovery_id))}`,
  }),

  'cybersecurity_response.publish_healthy_recovery': ({ state }) => ({
    recovery_record: [
      `# Security recovery observation — ${text(state.incident_id)}`,
      '',
      'Outcome: healthy',
      `Recovery change: ${text(state.change_ref)}`,
      `Containment remains active: ${String(state.containment_still_active === true)}`,
    ].join('\n'),
  }),

  'cybersecurity_response.publish_failed_recovery': ({ state }) => ({
    recovery_record: [
      `# Security recovery failure — ${text(state.incident_id)}`,
      '',
      'Outcome: degraded',
      'The failed recovery change was rolled back while containment remained active.',
      `Evidence: ${text(state.recovery_rollback_reference)}`,
    ].join('\n'),
  }),
};
