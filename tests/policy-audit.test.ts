import { describe, expect, it } from 'vitest';
import {
  createPolicyToolAuthorizer,
  createRunAuditBundle,
  evaluateToolPolicy,
  parseToolPolicy,
  verifyRunAuditBundle,
  type ToolAuthorizationRequest,
} from '@graph-native/core';

const request = {
  runId: 'run-policy-test',
  node: {
    id: 'publish',
    kind: 'agent',
    label: 'Publish',
    description: 'Publish an artifact.',
    reads: [],
    writes: [],
    config: {},
  },
  role: {
    id: 'publisher',
    label: 'Publisher',
    mission: 'Publish approved artifacts.',
    allowedTools: ['external_publish'],
    forbiddenActions: ['publish without approval'],
  },
  tool: {
    id: 'external_publish',
    label: 'External publish',
    description: 'Publish outside the workspace.',
    risk: 'external',
  },
  input: { artifactId: 'artifact-1' },
} satisfies ToolAuthorizationRequest;

describe('policy and portable audit', () => {
  it('evaluates ordered declarative tool policy across run, node, role, tool and risk selectors', async () => {
    const policy = parseToolPolicy({
      formatVersion: 1,
      defaultEffect: 'deny',
      rules: [{
        id: 'approve-publisher-external',
        effect: 'require-approval',
        runIds: ['run-policy-test'],
        nodeIds: ['publish'],
        roleIds: ['publisher'],
        toolIds: ['external_publish'],
        risks: ['external'],
        reason: 'External publication requires a reviewer.',
      }],
    });

    expect(evaluateToolPolicy(policy, request)).toEqual({
      effect: 'require-approval',
      ruleId: 'approve-publisher-external',
      reason: 'External publication requires a reviewer.',
    });
    expect(await createPolicyToolAuthorizer(policy)(request)).toMatchObject({
      effect: 'require-approval',
    });
    expect(() => parseToolPolicy({
      formatVersion: 1,
      defaultEffect: 'allow',
      rules: [{ id: 'invalid-reason', effect: 'allow', reason: { unsafe: true } }],
    })).toThrow(/reason must be a non-empty string/);
  });

  it('creates a portable audit bundle and rejects altered run evidence', () => {
    const bundle = createRunAuditBundle({
      run: {
        runId: 'run-audit-test',
        packId: 'research',
        graphId: 'research.workflow',
        graphVersion: 1,
        status: 'completed',
        state: { deliverable: 'Approved result' },
      },
      events: [{
        runId: 'run-audit-test',
        seq: 1,
        timestamp: '2026-01-02T03:04:05.000Z',
        type: 'run.completed',
        detail: {},
      }],
    }, new Date('2026-01-02T03:05:00.000Z'));

    expect(verifyRunAuditBundle(bundle)).toEqual(bundle);
    expect(bundle.integrity.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyRunAuditBundle({
      ...bundle,
      run: { ...bundle.run, state: { deliverable: 'Altered result' } },
    })).toThrow(/integrity verification failed/);
    expect(() => verifyRunAuditBundle({ ...bundle, events: undefined })).toThrow(
      /events must be an array/,
    );
  });
});
