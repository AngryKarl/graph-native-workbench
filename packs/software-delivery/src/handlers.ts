import type { HandlerRegistry } from '@graph-workbench/core';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function items<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function verificationResults(value: unknown): Array<{
  check_id: string;
  type: string;
  status: string;
  evidence_uri: string;
  summary: string;
}> {
  return items(value);
}

function healthSignals(value: unknown): Array<{ name: string; status: string; value?: unknown }> {
  return items(value);
}

function releaseContextLine(value: unknown): string {
  const linked = object(value);
  const sourceRunId = text(linked.source_run_id);
  return linked.linked === true
    ? `Prior approved release context: reused ${text(linked.release_id)} from approved run ${sourceRunId.slice(-8)}`
    : 'Prior approved release: not found in the context graph';
}

export const softwareDeliveryHandlers: HandlerRegistry = {
  'software_delivery.normalize_intake': ({ state }) => ({
    intake: {
      issue_id: text(state.issue_id),
      title: text(state.title),
      repository: text(state.repository),
      acceptance_criteria: items(state.acceptance_criteria),
      target_environment: text(state.target_environment),
    },
  }),

  'software_delivery.assess_risk': ({ state }) => {
    const flags = items<string>(state.risk_flags);
    const production = text(state.target_environment) === 'production';
    const score = Math.min(100, flags.length * 20 + (production ? 20 : 0));
    const level = score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
    return {
      risk_assessment: {
        level,
        score,
        reasons: [...flags, ...(production ? ['production deployment'] : [])],
      },
    };
  },

  'software_delivery.plan_change': ({ state }) => ({
    delivery_plan: [
      `Trace ${text(state.issue_id)} to executable acceptance criteria.`,
      `Implement the smallest reversible change in ${text(state.repository)}.`,
      'Run unit, integration, security and supply-chain verification.',
      `Promote an immutable candidate to ${text(state.target_environment)} after two human gates.`,
    ],
  }),

  'software_delivery.build_change_set': ({ state }) => ({
    change_set: {
      repository: text(state.repository),
      base_ref: text(state.base_ref),
      affected_components: items(state.affected_components),
      summary: `Implement ${text(state.issue_id)}: ${text(state.title)}`,
      reversible: true,
    },
  }),

  'software_delivery.open_change_request': ({ state }) => ({
    change_request: {
      change_request_id: `cr-${text(state.issue_id).toLowerCase()}`,
      repository: text(state.repository),
      base_ref: text(state.base_ref),
      url: `reference://change-request/${encodeURIComponent(text(state.repository))}/${encodeURIComponent(text(state.issue_id))}`,
      status: 'open',
    },
  }),

  'software_delivery.prepare_checks': () => ({
    check_requests: [
      { check_id: 'unit', type: 'unit', required: true },
      { check_id: 'integration', type: 'integration', required: true },
      { check_id: 'security', type: 'security', required: true },
      { check_id: 'supply_chain', type: 'supply_chain', required: true },
    ],
  }),

  'software_delivery.execute_check': ({ state }) => {
    const check = object(state.check);
    const checkId = text(check.check_id);
    return {
      result: {
        check_id: checkId,
        type: text(check.type),
        status: 'passed',
        evidence_uri: `reference://verification/${encodeURIComponent(text(state.repository))}/${checkId}`,
        summary: `${checkId} verification passed for ${text(object(state.change_set).summary)}.`,
      },
    };
  },

  'software_delivery.quality_gate': ({ state }) => {
    const results = verificationResults(state.verification_results);
    const required = ['unit', 'integration', 'security', 'supply_chain'];
    const covered = new Set(results.filter((result) => result.status === 'passed').map((result) => result.type));
    const missing = required.filter((type) => !covered.has(type));
    if (missing.length > 0) throw new Error(`Release verification is missing passing checks: ${missing.join(', ')}.`);
    return {
      quality_summary: {
        status: 'passed',
        required_checks: required,
        evidence_count: results.length,
        risk_level: text(object(state.risk_assessment).level),
      },
    };
  },

  'software_delivery.prepare_release': ({ state }) => ({
    release_candidate: {
      release_id: `${text(state.repository)}@${text(state.release_version)}`,
      version: text(state.release_version),
      repository: text(state.repository),
      environment: text(state.target_environment),
      change_summary: text(object(state.change_set).summary),
      artifact_digest: text(state.artifact_digest),
      verification_evidence: verificationResults(state.verification_results).map((result) => result.evidence_uri),
    },
    build_provenance: {
      builder_id: 'reference://builder/graph-workbench-zero-key',
      build_type: 'reference://build-type/software-delivery/v1',
      source_ref: text(object(state.merge_record).merge_ref),
      artifact_digest: text(state.artifact_digest),
      attestation_uri: `reference://attestation/${encodeURIComponent(text(state.artifact_digest))}`,
    },
  }),

  'software_delivery.merge_change': ({ state }) => ({
    merge_record: {
      change_request_id: text(object(state.change_request).change_request_id),
      merge_ref: `${text(state.repository)}#${text(state.release_version)}`,
      status: 'merged',
    },
  }),

  'software_delivery.request_deployment': ({ state }) => {
    const candidate = object(state.release_candidate);
    return {
      deployment_request: {
        request_id: `deploy-${text(state.issue_id).toLowerCase()}-${text(state.release_version)}`,
        release_id: text(candidate.release_id),
        environment: text(state.target_environment),
        artifact_digest: text(candidate.artifact_digest),
        status: 'accepted',
      },
    };
  },

  'software_delivery.publish_release': ({ state }) => {
    const candidate = object(state.release_candidate);
    const risk = object(state.risk_assessment);
    const checks = verificationResults(state.verification_results);
    return {
      release_record: [
        `# Release readiness record — ${text(candidate.release_id)}`,
        '',
        `**Work item:** ${text(state.issue_id)} — ${text(state.title)}`,
        `**Repository:** ${text(state.repository)}`,
        `**Target:** ${text(state.target_environment)}`,
        `**Artifact digest:** ${text(candidate.artifact_digest)}`,
        `**Risk:** ${text(risk.level)} (${String(risk.score ?? 0)}/100)`,
        '',
        '## Traceability',
        ...items<string>(state.acceptance_criteria).map((criterion, index) => `${index + 1}. ${criterion}`),
        '',
        '## Verification evidence',
        ...checks.map((check) => `- ${check.type}: ${check.status} — ${check.evidence_uri}`),
        '',
        '## Decisions',
        '- Code review: approved',
        '- Release approval: approved',
        `- Change request: ${text(object(state.change_request).url)}`,
        `- Deployment request: ${text(object(state.deployment_request).request_id)} (${text(object(state.deployment_request).status)})`,
        '- Change is declared reversible; deployment health is tracked by deployment.observed events.',
      ].join('\n'),
    };
  },

  'software_delivery.record_rejection': ({ state }) => ({
    rejection_reason: state.code_review_approved === false
      ? 'Code review rejected the change before release preparation.'
      : 'Release manager rejected promotion of the release candidate.',
  }),

  'software_delivery.record_quality_failure': ({ state }) => ({
    rejection_reason: `Automated release quality gate failed for ${text(state.issue_id)}.`,
  }),

  'software_delivery.assess_deployment': async ({ state, context }) => {
    const signals = healthSignals(state.health_signals);
    const healthy = text(state.status) === 'succeeded'
      && signals.length > 0
      && signals.every((signal) => ['healthy', 'ok', 'passed'].includes(signal.status));
    const releaseId = text(state.release_id);
    const releases = await context?.queryObjects({ types: ['release'], statuses: ['confirmed'], currentOnly: true }) ?? [];
    const linkedRelease = releases.find((candidate) => text(candidate.data.release_id) === releaseId);
    return {
      deployment_healthy: healthy,
      release_context: linkedRelease ? {
        linked: true,
        object_id: linkedRelease.id,
        version: linkedRelease.version,
        release_id: releaseId,
        source_run_id: linkedRelease.provenance.producedByRunId ?? '',
        artifact_digest: text(linkedRelease.data.artifact_digest),
      } : { linked: false, release_id: releaseId },
      observation_summary: {
        release_id: releaseId,
        deployment_id: text(state.deployment_id),
        environment: text(state.environment),
        status: text(state.status),
        signal_count: signals.length,
        healthy,
      },
    };
  },

  'software_delivery.rollback_deployment': ({ state }) => ({
    rollback_completed: true,
    rollback_reference: `reference://rollback/${encodeURIComponent(text(state.deployment_id) || text(state.release_id))}`,
  }),

  'software_delivery.publish_healthy_observation': ({ state }) => ({
    deployment_record: [
      `# Deployment observation — ${text(state.release_id)}`,
      '',
      `Environment: ${text(state.environment)}`,
      `Deployment: ${text(state.deployment_id)}`,
      `Artifact: ${text(state.artifact_digest)}`,
      releaseContextLine(state.release_context),
      'Outcome: healthy',
      `Signals: ${healthSignals(state.health_signals).length}`,
    ].join('\n'),
  }),

  'software_delivery.publish_failed_observation': ({ state }) => ({
    deployment_record: [
      `# Deployment incident — ${text(state.release_id)}`,
      '',
      `Environment: ${text(state.environment)}`,
      `Deployment: ${text(state.deployment_id)}`,
      `Artifact: ${text(state.artifact_digest)}`,
      releaseContextLine(state.release_context),
      `Outcome: unhealthy (${text(state.status)})`,
      `Rollback: ${state.rollback_completed === true ? 'completed' : 'not completed'}`,
      `Rollback evidence: ${text(state.rollback_reference)}`,
    ].join('\n'),
  }),
};
