import type {
  ToolAuthorizationDecision,
  ToolAuthorizationEffect,
  ToolAuthorizationRequest,
  ToolAuthorizer,
} from './adapters.js';

export interface ToolPolicyRule {
  readonly id: string;
  readonly effect: ToolAuthorizationEffect;
  readonly runIds?: readonly string[];
  readonly nodeIds?: readonly string[];
  readonly roleIds?: readonly string[];
  readonly toolIds?: readonly string[];
  readonly risks?: readonly ToolAuthorizationRequest['tool']['risk'][];
  readonly reason?: string;
}

export interface ToolPolicy {
  readonly formatVersion: 1;
  readonly defaultEffect: ToolAuthorizationEffect;
  readonly rules: readonly ToolPolicyRule[];
}

export const defaultToolPolicy: ToolPolicy = {
  formatVersion: 1,
  defaultEffect: 'require-approval',
  rules: [{ id: 'allow-read-tools', effect: 'allow', risks: ['read'] }],
};

const effects = new Set<ToolAuthorizationEffect>(['allow', 'deny', 'require-approval']);
const risks = new Set<ToolAuthorizationRequest['tool']['risk']>(['read', 'draft', 'write', 'external']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function stringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return [...new Set(value as string[])];
}

export function parseToolPolicy(input: unknown): ToolPolicy {
  const root = record(input, 'Tool policy');
  if (root.formatVersion !== 1) throw new Error('Tool policy formatVersion must be 1.');
  if (!effects.has(root.defaultEffect as ToolAuthorizationEffect)) {
    throw new Error('Tool policy defaultEffect must be allow, deny or require-approval.');
  }
  if (!Array.isArray(root.rules)) throw new Error('Tool policy rules must be an array.');
  const ids = new Set<string>();
  const rules = root.rules.map((value, index): ToolPolicyRule => {
    const rule = record(value, `Tool policy rule ${index + 1}`);
    if (typeof rule.id !== 'string' || !rule.id) throw new Error(`Tool policy rule ${index + 1} requires an id.`);
    if (ids.has(rule.id)) throw new Error(`Tool policy rule id "${rule.id}" is duplicated.`);
    ids.add(rule.id);
    if (!effects.has(rule.effect as ToolAuthorizationEffect)) {
      throw new Error(`Tool policy rule "${rule.id}" has an invalid effect.`);
    }
    const runIds = stringList(rule.runIds, `Tool policy rule "${rule.id}" runIds`);
    const nodeIds = stringList(rule.nodeIds, `Tool policy rule "${rule.id}" nodeIds`);
    const roleIds = stringList(rule.roleIds, `Tool policy rule "${rule.id}" roleIds`);
    const toolIds = stringList(rule.toolIds, `Tool policy rule "${rule.id}" toolIds`);
    const selectedRisks = stringList(rule.risks, `Tool policy rule "${rule.id}" risks`);
    if (selectedRisks?.some((risk) => !risks.has(risk as ToolAuthorizationRequest['tool']['risk']))) {
      throw new Error(`Tool policy rule "${rule.id}" has an invalid risk.`);
    }
    if (rule.reason !== undefined && (typeof rule.reason !== 'string' || !rule.reason.trim())) {
      throw new Error(`Tool policy rule "${rule.id}" reason must be a non-empty string.`);
    }
    return {
      id: rule.id,
      effect: rule.effect as ToolAuthorizationEffect,
      ...(runIds ? { runIds } : {}),
      ...(nodeIds ? { nodeIds } : {}),
      ...(roleIds ? { roleIds } : {}),
      ...(toolIds ? { toolIds } : {}),
      ...(selectedRisks ? { risks: selectedRisks as ToolAuthorizationRequest['tool']['risk'][] } : {}),
      ...(rule.reason === undefined ? {} : { reason: rule.reason as string }),
    };
  });
  return { formatVersion: 1, defaultEffect: root.defaultEffect as ToolAuthorizationEffect, rules };
}

function includes(list: readonly string[] | undefined, value: string): boolean {
  return list === undefined || list.includes(value);
}

export function evaluateToolPolicy(
  policy: ToolPolicy,
  request: ToolAuthorizationRequest,
): ToolAuthorizationDecision {
  const rule = policy.rules.find((candidate) =>
    includes(candidate.runIds, request.runId)
    && includes(candidate.nodeIds, request.node.id)
    && includes(candidate.roleIds, request.role.id)
    && includes(candidate.toolIds, request.tool.id)
    && includes(candidate.risks, request.tool.risk));
  if (!rule) {
    return {
      effect: policy.defaultEffect,
      reason: `default policy requires ${policy.defaultEffect}`,
    };
  }
  return {
    effect: rule.effect,
    ruleId: rule.id,
    reason: rule.reason ?? `matched policy rule "${rule.id}"`,
  };
}

export function createPolicyToolAuthorizer(policy: ToolPolicy): ToolAuthorizer {
  const parsed = parseToolPolicy(policy);
  return (request) => evaluateToolPolicy(parsed, request);
}
