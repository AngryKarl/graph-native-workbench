import type { IndustryPackManifest } from '@graph-workbench/contracts';

export const customerSuccessPack: IndustryPackManifest = {
  id: 'customer_success',
  version: '0.4.1',
  name: 'Customer Success Renewal Pack',
  description:
    'Turn product-health signals, stakeholder evidence and commercial context into a governed renewal-risk assessment and approved success plan.',
  license: 'MIT',
  ontology: {
    objectTypes: [
      { id: 'account_profile', label: 'Account profile', description: 'The commercial and outcome context for a customer account.', fields: {
        name: { type: 'string', required: true, description: 'Account name.' },
        segment: { type: 'string', required: true, description: 'Customer segment.' },
        renewal_date: { type: 'string', required: true, description: 'Contract renewal date.' },
        arr_usd: { type: 'number', required: true, description: 'Annual recurring revenue in USD.' },
      } },
      { id: 'health_signal', label: 'Health signal', description: 'An attributable product or stakeholder health observation.', fields: {
        kind: { type: 'string', required: true, description: 'Signal category.' },
        value: { type: 'string', required: true, description: 'Observed value.' },
        trend: { type: 'string', required: true, description: 'Direction of travel.' },
        source: { type: 'string', required: true, description: 'Source system or record.' },
      } },
      { id: 'renewal_risk', label: 'Renewal risk', description: 'A scored renewal-risk assessment grounded in account signals.', fields: {
        score: { type: 'number', required: true, description: 'Risk score from 0 to 100.' },
        level: { type: 'string', required: true, description: 'Low, medium or high risk.' },
        rationale: { type: 'string', required: true, description: 'Evidence summary.' },
      } },
      { id: 'intervention', label: 'Intervention', description: 'A dated, owned action with a measurable outcome.', fields: {
        owner: { type: 'string', required: true, description: 'Accountable role.' },
        action: { type: 'string', required: true, description: 'Committed action.' },
        due_in_days: { type: 'number', required: true, description: 'Relative deadline.' },
        success_measure: { type: 'string', required: true, description: 'Completion evidence.' },
      } },
      { id: 'decision', label: 'Renewal-plan decision', description: 'The revenue-owner approval decision.', fields: {
        approved: { type: 'boolean', required: true, description: 'Approval state.' },
        rationale: { type: 'string', required: true, description: 'Decision basis.' },
      } },
      { id: 'success_plan', label: 'Renewal success plan', description: 'The approved, evidence-linked customer success deliverable.', fields: {
        title: { type: 'string', required: true, description: 'Plan title.' },
        content: { type: 'string', required: true, description: 'Markdown plan.' },
      } },
    ],
    relationTypes: [
      { id: 'signal_about', label: 'Signal about', description: 'A health signal describes an account.', sourceTypes: ['health_signal'], targetTypes: ['account_profile'] },
      { id: 'risk_supported_by', label: 'Risk supported by', description: 'A renewal risk is supported by health signals.', sourceTypes: ['renewal_risk'], targetTypes: ['health_signal'] },
      { id: 'intervention_addresses', label: 'Intervention addresses', description: 'An intervention addresses the assessed renewal risk.', sourceTypes: ['intervention'], targetTypes: ['renewal_risk'] },
      { id: 'decision_governs', label: 'Decision governs', description: 'A revenue-owner decision governs plan publication.', sourceTypes: ['decision'], targetTypes: ['success_plan'] },
      { id: 'plan_includes', label: 'Plan includes', description: 'The success plan includes an approved intervention.', sourceTypes: ['success_plan'], targetTypes: ['intervention'] },
    ],
  },
  roles: [
    { id: 'customer_success_manager', label: 'Customer Success Manager', mission: 'Translate account evidence into owned, measurable renewal interventions.', allowedTools: ['crm_snapshot_read', 'product_usage_read'], forbiddenActions: ['Inventing product usage, stakeholder intent or commercial commitments'] },
    { id: 'revenue_owner', label: 'Revenue owner', mission: 'Confirm risk framing, commercial priority and accountable intervention owners.', allowedTools: ['crm_snapshot_read'], forbiddenActions: ['Approving a plan that failed an evidence or actionability gate'] },
  ],
  tools: [
    { id: 'crm_snapshot_read', label: 'CRM snapshot read', risk: 'read', description: 'Read an approved CRM account snapshot.' },
    { id: 'product_usage_read', label: 'Product usage read', risk: 'read', description: 'Read an approved product adoption summary.' },
  ],
  evaluations: [
    { id: 'evidence_completeness', label: 'Evidence completeness', description: 'Risk claims include attributable product or stakeholder evidence.', blocking: true },
    { id: 'intervention_actionability', label: 'Intervention actionability', description: 'Every intervention has an owner, deadline and success measure.', blocking: true },
    { id: 'revenue_approval', label: 'Revenue approval', description: 'A revenue owner approves the plan before publication.', blocking: true },
  ],
  deliverables: [
    { id: 'renewal_success_plan', label: 'Renewal success plan', description: 'An approved Markdown plan linking renewal risk to owned interventions.', graphId: 'customer_success.renewal_workflow', stateField: 'deliverable', mediaType: 'text/markdown', artifactType: 'renewal_success_plan', evidenceFields: ['health_signals', 'product_findings', 'stakeholder_findings'], approvalField: 'approved' },
  ],
  fixtures: [
    {
      id: 'enterprise_renewal', label: 'Enterprise renewal at risk', description: 'A high-value account with declining adoption and sponsor change.', graphId: 'customer_success.renewal_workflow',
      input: {
        account_name: 'Northstar Logistics', segment: 'enterprise', renewal_date: '2026-11-30', arr_usd: 420000,
        success_outcomes: ['Reduce manual dispatch work', 'Improve exception response time'],
        health_signals: [
          { kind: 'weekly_active_teams', value: '6 of 14 teams active', trend: 'declining', source: 'product-analytics://northstar/2026-W31' },
          { kind: 'workflow_automation', value: '38% of target workflows automated', trend: 'stable', source: 'success-plan://northstar/Q3' },
        ],
        stakeholder_notes: ['Executive sponsor left the company in July.', 'Operations lead is concerned about enablement delays.'],
      },
      decisions: { approval: true },
      expectations: [
        { field: 'renewal_risk', operator: 'exists', description: 'Produces a scored renewal-risk assessment.' },
        { field: 'intervention_plan', operator: 'min_items', value: 2, description: 'Produces owned interventions for the evidence.' },
        { field: 'review_status', operator: 'includes', value: 'passed:', description: 'Passes evidence and actionability gates.' },
        { field: 'deliverable', operator: 'includes', value: '# Renewal success plan', description: 'Produces the declared customer success deliverable.' },
      ],
    },
    {
      id: 'expansion_ready', label: 'Expansion-ready account', description: 'A healthy account that needs value proof before an expansion conversation.', graphId: 'customer_success.renewal_workflow',
      input: {
        account_name: 'Meridian Health Network', segment: 'enterprise', renewal_date: '2027-02-15', arr_usd: 180000,
        success_outcomes: ['Shorten clinical operations reporting cycles'],
        health_signals: [
          { kind: 'monthly_active_users', value: '312 active users', trend: 'growing', source: 'product-analytics://meridian/2026-07' },
          { kind: 'report_cycle_time', value: 'Reduced from 5 days to 2 days', trend: 'growing', source: 'outcome-review://meridian/Q2' },
        ],
        stakeholder_notes: ['Operations VP requested a quantified value review before discussing expansion.'],
      },
      decisions: { approval: true },
      expectations: [
        { field: 'renewal_risk', operator: 'exists', description: 'Records a risk assessment even for a healthy account.' },
        { field: 'intervention_plan', operator: 'min_items', value: 1, description: 'Creates a value-proof action.' },
        { field: 'deliverable', operator: 'includes', value: 'Meridian Health Network', description: 'Produces an account-specific plan.' },
      ],
    },
  ],
  graphs: [{
    id: 'customer_success.renewal_workflow', version: 1, name: 'Evidence-based renewal workflow',
    description: 'Analyze product and stakeholder health in parallel, assess renewal risk, develop interventions, review and publish an accountable success plan.',
    state: { fields: {
      account_name: { type: 'string', required: true, description: 'Customer account name.' },
      segment: { type: 'string', required: true, description: 'Customer segment.' },
      renewal_date: { type: 'string', required: true, description: 'Renewal date.' },
      arr_usd: { type: 'number', required: true, description: 'Annual recurring revenue in USD.' },
      success_outcomes: { type: 'array', required: true, description: 'Agreed customer outcomes.' },
      health_signals: { type: 'array', required: true, description: 'Attributable account health signals.' },
      stakeholder_notes: { type: 'array', required: true, description: 'Stakeholder observations.' },
      account_profile: { type: 'object', required: false, description: 'Normalized account context.' },
      product_findings: { type: 'array', required: false, description: 'Product-health findings.' },
      stakeholder_findings: { type: 'array', required: false, description: 'Stakeholder findings.' },
      renewal_risk: { type: 'object', required: false, description: 'Renewal-risk assessment.' },
      intervention_plan: { type: 'array', required: false, description: 'Owned renewal interventions.' },
      review_status: { type: 'string', required: false, description: 'Blocking quality-gate status.' },
      approved: { type: 'boolean', required: false, description: 'Revenue-owner decision.' },
      deliverable: { type: 'string', required: false, description: 'Approved renewal success plan.' },
      rejection_reason: { type: 'string', required: false, description: 'Reason the plan was rejected.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Account intake', description: 'Accept account, commercial and outcome context.', reads: ['account_name', 'segment', 'renewal_date', 'arr_usd', 'success_outcomes', 'health_signals', 'stakeholder_notes'], writes: [], config: {} },
      { id: 'normalize_account', kind: 'function', label: 'Normalize account', description: 'Create a stable account profile.', handler: 'customer_success.normalize_account', reads: ['account_name', 'segment', 'renewal_date', 'arr_usd', 'success_outcomes'], writes: ['account_profile'], config: {} },
      { id: 'product_health', kind: 'agent', label: 'Analyze product health', description: 'Translate usage signals into adoption findings.', handler: 'customer_success.analyze_product_health', reads: ['health_signals', 'success_outcomes'], writes: ['product_findings'], config: { roleId: 'customer_success_manager' } },
      { id: 'stakeholder_health', kind: 'agent', label: 'Analyze stakeholders', description: 'Translate stakeholder notes into relationship findings.', handler: 'customer_success.analyze_stakeholders', reads: ['stakeholder_notes', 'renewal_date'], writes: ['stakeholder_findings'], config: { roleId: 'customer_success_manager' } },
      { id: 'health_join', kind: 'join', label: 'Join account health', description: 'Wait for product and stakeholder analyses.', reads: ['product_findings', 'stakeholder_findings'], writes: [], config: { mode: 'all' } },
      { id: 'assess_risk', kind: 'function', label: 'Assess renewal risk', description: 'Score and explain renewal risk from both evidence streams.', handler: 'customer_success.assess_renewal_risk', reads: ['product_findings', 'stakeholder_findings'], writes: ['renewal_risk'], config: { evaluationId: 'evidence_completeness' } },
      { id: 'build_plan', kind: 'agent', label: 'Build intervention plan', description: 'Create owned, dated, measurable renewal actions.', handler: 'customer_success.build_intervention_plan', reads: ['account_profile', 'product_findings', 'stakeholder_findings', 'renewal_risk'], writes: ['intervention_plan'], config: { roleId: 'customer_success_manager' } },
      { id: 'quality_gate', kind: 'function', label: 'Quality gate', description: 'Require attributable evidence and actionable interventions.', handler: 'customer_success.quality_gate', reads: ['health_signals', 'intervention_plan'], writes: ['review_status'], config: { evaluationId: 'intervention_actionability' } },
      { id: 'approval', kind: 'human', label: 'Revenue review', description: 'Pause for revenue-owner approval.', reads: ['account_profile', 'renewal_risk', 'intervention_plan', 'review_status'], writes: ['approved'], config: { decisionField: 'approved', roleId: 'revenue_owner', evaluationId: 'revenue_approval' } },
      { id: 'approval_route', kind: 'router', label: 'Route decision', description: 'Route approved and rejected plans.', reads: ['approved'], writes: [], config: {} },
      { id: 'publish', kind: 'function', label: 'Publish success plan', description: 'Publish the approved renewal success plan.', handler: 'customer_success.publish_plan', reads: ['account_name', 'renewal_date', 'arr_usd', 'renewal_risk', 'intervention_plan', 'review_status', 'approved'], writes: ['deliverable'], config: {} },
      { id: 'record_rejection', kind: 'function', label: 'Record rejection', description: 'Record why the plan was rejected.', handler: 'customer_success.record_rejection', reads: ['review_status', 'approved'], writes: ['rejection_reason'], config: {} },
    ],
    edges: [
      { id: 'e_start_normalize', source: 'start', target: 'normalize_account', on: 'success' },
      { id: 'e_normalize_product', source: 'normalize_account', target: 'product_health', on: 'success' },
      { id: 'e_normalize_stakeholder', source: 'normalize_account', target: 'stakeholder_health', on: 'success' },
      { id: 'e_product_join', source: 'product_health', target: 'health_join', on: 'success' },
      { id: 'e_stakeholder_join', source: 'stakeholder_health', target: 'health_join', on: 'success' },
      { id: 'e_join_risk', source: 'health_join', target: 'assess_risk', on: 'success' },
      { id: 'e_risk_plan', source: 'assess_risk', target: 'build_plan', on: 'success' },
      { id: 'e_plan_quality', source: 'build_plan', target: 'quality_gate', on: 'success' },
      { id: 'e_quality_approval', source: 'quality_gate', target: 'approval', on: 'success' },
      { id: 'e_approval_route', source: 'approval', target: 'approval_route', on: 'success' },
      { id: 'e_route_publish', source: 'approval_route', target: 'publish', on: 'success', condition: { field: 'approved', operator: 'equals', value: true } },
      { id: 'e_route_reject', source: 'approval_route', target: 'record_rejection', on: 'success', condition: { field: 'approved', operator: 'equals', value: false } },
    ],
    budget: { maxSteps: 48, maxDurationMs: 120_000, maxConcurrency: 4 },
  }, {
    id: 'customer_success.scheduled_health_scan', version: 1, name: 'Scheduled account health scan',
    description: 'Run a bounded preparation loop and score a dynamic account batch on a declared schedule.',
    trigger: { type: 'schedule', cron: '0 8 * * 1-5', timezone: 'UTC', input: { accounts: [{ account_id: 'reference-account', health: 'review' }], scan_attempt: 0, continue_scan: true } },
    state: { fields: {
      accounts: { type: 'array', required: true, description: 'Accounts to score.' },
      scan_attempt: { type: 'number', required: true, description: 'Preparation attempt.' },
      continue_scan: { type: 'boolean', required: true, description: 'Whether preparation continues.' },
      scored_accounts: { type: 'array', required: false, description: 'Parallel scoring results.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Schedule', description: 'Start the scheduled scan.', reads: ['accounts'], writes: [], config: {} },
      { id: 'prepare', kind: 'loop', label: 'Prepare scan', description: 'Run bounded preparation until ready.', reads: ['scan_attempt', 'continue_scan'], writes: ['scan_attempt', 'continue_scan'], config: { graphId: 'customer_success.scan_preparation', inputMapping: { scan_attempt: 'scan_attempt', continue_scan: 'continue_scan' }, outputMapping: { scan_attempt: 'scan_attempt', continue_scan: 'continue_scan' }, conditionField: 'continue_scan', conditionValue: true, maxIterations: 3 } },
      { id: 'score_accounts', kind: 'map', label: 'Score accounts', description: 'Score the current account batch concurrently.', reads: ['accounts'], writes: ['scored_accounts'], config: { graphId: 'customer_success.account_score', itemsField: 'accounts', itemField: 'item', resultField: 'result', outputField: 'scored_accounts', inputMapping: {}, maxItems: 500, maxConcurrency: 8 } },
    ],
    edges: [
      { id: 'scan.prepare', source: 'start', target: 'prepare', on: 'success' },
      { id: 'scan.score', source: 'prepare', target: 'score_accounts', on: 'success' },
    ],
    budget: { maxSteps: 24, maxDurationMs: 60_000, maxConcurrency: 2 },
  }, {
    id: 'customer_success.scan_preparation', version: 1, name: 'Scan preparation', description: 'Reusable bounded preparation step.',
    state: { fields: {
      scan_attempt: { type: 'number', required: true, description: 'Preparation attempt.' },
      continue_scan: { type: 'boolean', required: true, description: 'Whether preparation continues.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', description: 'Start preparation.', reads: [], writes: [], config: {} },
      { id: 'advance', kind: 'function', label: 'Advance', description: 'Advance bounded preparation.', handler: 'customer_success.advance_scan', reads: ['scan_attempt'], writes: ['scan_attempt', 'continue_scan'], config: {} },
    ],
    edges: [{ id: 'prepare.advance', source: 'start', target: 'advance', on: 'success' }],
    budget: { maxSteps: 6, maxDurationMs: 10_000, maxConcurrency: 1 },
  }, {
    id: 'customer_success.account_score', version: 1, name: 'Account score', description: 'Reusable account scoring boundary.',
    state: { fields: {
      item: { type: 'object', required: true, description: 'Account input.' },
      result: { type: 'object', required: false, description: 'Scored account.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', description: 'Start scoring.', reads: [], writes: [], config: {} },
      { id: 'score', kind: 'function', label: 'Score', description: 'Score one account.', handler: 'customer_success.score_scheduled_account', reads: ['item'], writes: ['result'], config: {} },
    ],
    edges: [{ id: 'score.run', source: 'start', target: 'score', on: 'success' }],
    budget: { maxSteps: 6, maxDurationMs: 10_000, maxConcurrency: 1 },
  }, {
    id: 'customer_success.health_alert', version: 1, name: 'Critical health alert',
    description: 'Handle a typed health event with explicit escalation and compensation when synchronization fails.',
    trigger: {
      type: 'event', eventType: 'customer.health_critical', correlationField: 'account_id',
      inputSchema: { type: 'object', properties: { severity: { type: 'string' }, simulate_failure: { type: 'boolean' } }, required: ['severity', 'simulate_failure'], additionalProperties: false },
    },
    state: { fields: {
      account_id: { type: 'string', required: true, description: 'Correlated account id.' },
      severity: { type: 'string', required: true, description: 'Alert severity.' },
      simulate_failure: { type: 'boolean', required: true, description: 'Reference failure switch.' },
      recovered: { type: 'boolean', required: false, description: 'Compensation outcome.' },
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Health event', description: 'Accept a typed critical-health event.', reads: ['account_id', 'severity'], writes: [], config: {} },
      { id: 'sync', kind: 'function', label: 'Synchronize response', description: 'Synchronize the alert response.', handler: 'customer_success.sync_health_alert', reads: ['simulate_failure'], writes: ['recovered'], config: {} },
      { id: 'escalate', kind: 'escalation', label: 'Escalate failure', description: 'Raise the failed response to the revenue owner.', reads: [], writes: [], config: { reason: 'Critical health response synchronization failed', severity: 'critical', roleId: 'revenue_owner' } },
      { id: 'compensate', kind: 'compensation', label: 'Restore response state', description: 'Restore a safe response state.', handler: 'customer_success.compensate_health_alert', reads: [], writes: ['recovered'], config: { compensates: ['sync'] } },
    ],
    edges: [
      { id: 'alert.sync', source: 'start', target: 'sync', on: 'success' },
      { id: 'alert.escalate', source: 'sync', target: 'escalate', on: 'failure' },
      { id: 'alert.compensate', source: 'sync', target: 'compensate', on: 'failure' },
    ],
    budget: { maxSteps: 12, maxDurationMs: 30_000, maxConcurrency: 2 },
  }],
};
