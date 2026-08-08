import type { IndustryPackManifest } from '@graph-native/contracts';

export const customerSuccessPack: IndustryPackManifest = {
  id: 'customer_success',
  version: '0.2.0',
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
    { id: 'renewal_success_plan', label: 'Renewal success plan', description: 'An approved Markdown plan linking renewal risk to owned interventions.', graphId: 'customer_success.renewal_workflow', stateField: 'deliverable', mediaType: 'text/markdown' },
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
  }],
};
