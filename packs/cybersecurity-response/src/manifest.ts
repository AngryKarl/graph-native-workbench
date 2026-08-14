import type { IndustryPackManifest } from '@graph-workbench/contracts';

export const cybersecurityResponsePack: IndustryPackManifest = {
  id: 'cybersecurity_response',
  version: '0.5.0',
  name: 'Cybersecurity Incident Response Pack',
  description:
    'A governed signal-to-recovery workflow for attributable evidence, incident declaration, approved containment, verified recovery and lessons learned.',
  license: 'MIT',
  ontology: {
    objectTypes: [
      {
        id: 'security_signal', label: 'Security signal',
        description: 'An attributable alert, report or detection presented for triage.',
        fields: {
          signal_id: { type: 'string', required: true, description: 'Source signal identifier.' },
          source: { type: 'string', required: true, description: 'Signal source.' },
          title: { type: 'string', required: true, description: 'Signal title.' },
          observed_at: { type: 'string', required: true, description: 'Observation time.' },
          confidence: { type: 'number', required: true, description: 'Declared confidence.' },
        },
      },
      {
        id: 'security_indicator', label: 'Security indicator',
        description: 'An observable value or ATT&CK technique reference used during analysis.',
        fields: {
          value: { type: 'string', required: true, description: 'Indicator or technique value.' },
          kind: { type: 'string', required: true, description: 'Indicator or technique.' },
        },
      },
      {
        id: 'affected_asset', label: 'Affected asset',
        description: 'An asset within the declared incident scope.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Asset identifier.' },
          criticality: { type: 'string', required: true, description: 'Business criticality.' },
        },
      },
      {
        id: 'affected_identity', label: 'Affected identity',
        description: 'A user, service or machine identity within incident scope.',
        fields: {
          identity_id: { type: 'string', required: true, description: 'Identity identifier.' },
          identity_kind: { type: 'string', required: true, description: 'Identity category.' },
        },
      },
      {
        id: 'security_evidence', label: 'Security evidence',
        description: 'Preserved evidence with immutable digest and source reference.',
        fields: {
          evidence_id: { type: 'string', required: true, description: 'Evidence identifier.' },
          evidence_ref: { type: 'string', required: true, description: 'Authoritative evidence locator.' },
          digest: { type: 'string', required: true, description: 'Preserved content digest.' },
          status: { type: 'string', required: true, description: 'Preservation status.' },
        },
      },
      {
        id: 'security_incident', label: 'Security incident',
        description: 'A declared incident with accountable severity and lifecycle status.',
        fields: {
          incident_id: { type: 'string', required: true, description: 'Incident identifier.' },
          title: { type: 'string', required: true, description: 'Incident title.' },
          severity: { type: 'string', required: true, description: 'Current severity.' },
          status: { type: 'string', required: true, description: 'Lifecycle status.' },
        },
      },
      {
        id: 'severity_assessment', label: 'Severity assessment',
        description: 'A documented classification decision and its evidence basis.',
        fields: {
          severity: { type: 'string', required: true, description: 'Assigned severity.' },
          confidence: { type: 'number', required: true, description: 'Assessment confidence.' },
          incident_likely: { type: 'boolean', required: true, description: 'Incident threshold result.' },
          rationale: { type: 'string', required: true, description: 'Classification rationale.' },
        },
      },
      {
        id: 'response_action', label: 'Response action',
        description: 'A containment, notification, eradication, recovery or rollback action.',
        fields: {
          action_id: { type: 'string', required: true, description: 'Action identifier.' },
          action_type: { type: 'string', required: true, description: 'Action category.' },
          target_id: { type: 'string', required: true, description: 'Action target.' },
          status: { type: 'string', required: true, description: 'Execution status.' },
        },
      },
      {
        id: 'security_decision', label: 'Security decision',
        description: 'An accountable declaration, containment or recovery decision.',
        fields: {
          gate: { type: 'string', required: true, description: 'Decision gate.' },
          approved: { type: 'boolean', required: true, description: 'Decision outcome.' },
        },
      },
      {
        id: 'recovery_observation', label: 'Recovery observation',
        description: 'Post-change health evidence for an incident recovery attempt.',
        fields: {
          recovery_id: { type: 'string', required: true, description: 'Recovery identifier.' },
          status: { type: 'string', required: true, description: 'Observed status.' },
          healthy: { type: 'boolean', required: true, description: 'Health outcome.' },
          signal_count: { type: 'number', required: true, description: 'Health signal count.' },
        },
      },
      {
        id: 'lessons_learned', label: 'Lessons learned',
        description: 'Post-incident findings and control improvements.',
        fields: {
          incident_id: { type: 'string', required: true, description: 'Incident identifier.' },
          finding_count: { type: 'number', required: true, description: 'Finding count.' },
          improvement_count: { type: 'number', required: true, description: 'Improvement count.' },
        },
      },
      {
        id: 'security_delivery_record', label: 'Security delivery record',
        description: 'A portable triage, incident or recovery record.',
        fields: {
          record_type: { type: 'string', required: true, description: 'Record category.' },
          content: { type: 'string', required: true, description: 'Markdown record.' },
        },
      },
    ],
    relationTypes: [
      { id: 'classifies_signal', label: 'Classifies', description: 'An assessment classifies a signal.', sourceTypes: ['severity_assessment'], targetTypes: ['security_signal'] },
      { id: 'indicates_incident', label: 'Indicates incident', description: 'A signal contributes to a declared incident.', sourceTypes: ['security_signal'], targetTypes: ['security_incident'] },
      { id: 'supported_by_evidence', label: 'Supported by', description: 'An incident or assessment is supported by preserved evidence.', sourceTypes: ['security_incident', 'severity_assessment'], targetTypes: ['security_evidence'] },
      { id: 'has_indicator', label: 'Has indicator', description: 'A signal has an indicator or technique reference.', sourceTypes: ['security_signal'], targetTypes: ['security_indicator'] },
      { id: 'affects_security_asset', label: 'Affects asset', description: 'An incident affects an asset.', sourceTypes: ['security_incident'], targetTypes: ['affected_asset'] },
      { id: 'affects_security_identity', label: 'Affects identity', description: 'An incident affects an identity.', sourceTypes: ['security_incident'], targetTypes: ['affected_identity'] },
      { id: 'mitigates_incident', label: 'Mitigates', description: 'A response action mitigates an incident.', sourceTypes: ['response_action'], targetTypes: ['security_incident'] },
      { id: 'governs_response', label: 'Governs', description: 'A decision governs an incident or response action.', sourceTypes: ['security_decision'], targetTypes: ['security_incident', 'response_action'] },
      { id: 'observes_incident_recovery', label: 'Observes recovery', description: 'An observation measures incident recovery.', sourceTypes: ['recovery_observation'], targetTypes: ['security_incident'] },
      { id: 'improves_after_incident', label: 'Improves after', description: 'Lessons learned improve future response after an incident.', sourceTypes: ['lessons_learned'], targetTypes: ['security_incident'] },
      { id: 'documents_security_work', label: 'Documents', description: 'A record documents a triage, incident, response action or recovery.', sourceTypes: ['security_delivery_record'], targetTypes: ['severity_assessment', 'security_incident', 'response_action', 'recovery_observation'] },
    ],
  },
  roles: [
    {
      id: 'soc_analyst', label: 'SOC analyst',
      mission: 'Preserve evidence, correlate signals and produce an attributable initial assessment.',
      allowedTools: ['siem_signal_read', 'asset_inventory_read', 'identity_context_read', 'evidence_preserve', 'incident_record_upsert'],
      forbiddenActions: ['Changing source evidence', 'Executing containment without approval'],
    },
    {
      id: 'forensic_analyst', label: 'Forensic analyst',
      mission: 'Preserve and analyze evidence without contaminating authoritative sources.',
      allowedTools: ['siem_signal_read', 'asset_inventory_read', 'identity_context_read', 'evidence_preserve'],
      forbiddenActions: ['Collecting evidence without provenance', 'Modifying an affected system during preservation'],
    },
    {
      id: 'incident_commander', label: 'Incident commander',
      mission: 'Declare incidents, own severity and coordinate accountable response.',
      allowedTools: ['siem_signal_read', 'asset_inventory_read', 'identity_context_read', 'notification_publish', 'incident_record_upsert'],
      forbiddenActions: ['Declaring closure without recovery evidence'],
    },
    {
      id: 'containment_approver', label: 'Containment approver',
      mission: 'Authorize high-impact isolation and identity actions with business context.',
      allowedTools: ['asset_inventory_read', 'identity_context_read', 'containment_execute'],
      forbiddenActions: ['Approving unscoped containment', 'Disabling evidence preservation'],
    },
    {
      id: 'recovery_owner', label: 'Recovery owner',
      mission: 'Authorize eradication and verified restoration while managing residual risk.',
      allowedTools: ['asset_inventory_read', 'containment_execute', 'recovery_change_execute', 'incident_record_upsert'],
      forbiddenActions: ['Removing containment before recovery verification'],
    },
    {
      id: 'communications_lead', label: 'Communications lead',
      mission: 'Coordinate accurate, policy-aligned stakeholder notifications.',
      allowedTools: ['notification_publish', 'incident_record_upsert'],
      forbiddenActions: ['Publishing unverified impact claims'],
    },
  ],
  tools: [
    typedQuery('siem_signal_read', 'Read SIEM signal', 'Read an authoritative detection without changing it.',
      { signal_id: { type: 'string' } }, ['signal_id'],
      { signal_id: { type: 'string' }, status: { type: 'string' }, source: { type: 'string' } }, ['signal_id', 'status', 'source']),
    typedQuery('asset_inventory_read', 'Read asset inventory', 'Read ownership and criticality from the asset authority.',
      { asset_id: { type: 'string' } }, ['asset_id'],
      { asset_id: { type: 'string' }, criticality: { type: 'string' }, owner: { type: 'string' } }, ['asset_id', 'criticality', 'owner']),
    typedQuery('identity_context_read', 'Read identity context', 'Read identity status and privilege context.',
      { identity_id: { type: 'string' } }, ['identity_id'],
      { identity_id: { type: 'string' }, status: { type: 'string' }, privileged: { type: 'boolean' } }, ['identity_id', 'status', 'privileged']),
    typedCommand('evidence_preserve', 'Preserve evidence', 'Request immutable evidence preservation and a digest.', 'write',
      { idempotency_key: { type: 'string' }, evidence_ref: { type: 'string' } }, ['idempotency_key', 'evidence_ref'],
      { evidence_id: { type: 'string' }, digest: { type: 'string' }, status: { type: 'string' } }, ['evidence_id', 'digest', 'status']),
    typedCommand('containment_execute', 'Execute containment', 'Request an approved isolation or identity containment action.', 'external',
      { idempotency_key: { type: 'string' }, action_type: { type: 'string' }, target_id: { type: 'string' }, incident_id: { type: 'string' } }, ['idempotency_key', 'action_type', 'target_id', 'incident_id'],
      { action_id: { type: 'string' }, status: { type: 'string' } }, ['action_id', 'status']),
    typedCommand('notification_publish', 'Publish notification', 'Send an approved incident notification.', 'external',
      { idempotency_key: { type: 'string' }, incident_id: { type: 'string' }, audience: { type: 'array', items: { type: 'string' } } }, ['idempotency_key', 'incident_id', 'audience'],
      { notification_id: { type: 'string' }, status: { type: 'string' } }, ['notification_id', 'status']),
    typedCommand('recovery_change_execute', 'Execute recovery change', 'Request an approved eradication or recovery change.', 'external',
      { idempotency_key: { type: 'string' }, incident_id: { type: 'string' }, change_ref: { type: 'string' } }, ['idempotency_key', 'incident_id', 'change_ref'],
      { recovery_id: { type: 'string' }, status: { type: 'string' } }, ['recovery_id', 'status']),
    typedCommand('incident_record_upsert', 'Update incident record', 'Create or update an incident-system record idempotently.', 'write',
      { idempotency_key: { type: 'string' }, incident_id: { type: 'string' }, status: { type: 'string' } }, ['idempotency_key', 'incident_id', 'status'],
      { incident_id: { type: 'string' }, status: { type: 'string' } }, ['incident_id', 'status']),
  ],
  evaluations: [
    { id: 'evidence_integrity', label: 'Evidence integrity', description: 'Every assessment preserves attributable evidence and digest.', blocking: true },
    { id: 'severity_classification', label: 'Severity classification', description: 'Severity and confidence are explicit and evidence-backed.', blocking: true },
    { id: 'incident_declaration', label: 'Incident declaration', description: 'An incident commander confirms incident status and severity.', blocking: true },
    { id: 'containment_approval', label: 'Containment approval', description: 'A scoped approver authorizes high-impact response actions.', blocking: true },
    { id: 'recovery_approval', label: 'Recovery approval', description: 'A recovery owner authorizes eradication and restoration.', blocking: true },
    { id: 'recovery_health', label: 'Recovery health', description: 'Post-change signals prove health or visibly trigger rollback.', blocking: true },
  ],
  deliverables: [
    {
      id: 'incident_record', label: 'Incident response record', description: 'A non-incident closure or governed incident-to-recovery record.',
      graphId: 'cybersecurity_response.incident_response', stateField: 'incident_record', mediaType: 'text/markdown',
      artifactType: 'cybersecurity_incident_record', evidenceFields: ['evidence_results', 'severity_assessment', 'containment_results', 'recovery_result', 'lessons_learned'],
    },
    {
      id: 'recovery_record', label: 'Recovery observation record', description: 'A healthy recovery or failed-change rollback record.',
      graphId: 'cybersecurity_response.observe_recovery', stateField: 'recovery_record', mediaType: 'text/markdown',
      artifactType: 'cybersecurity_recovery_record', evidenceFields: ['health_signals', 'recovery_observation', 'recovery_rollback_reference'],
    },
  ],
  fixtures: [
    {
      id: 'privileged_credential_compromise',
      label: 'Privileged credential compromise',
      description: 'Declares and recovers a high-severity privileged identity incident.',
      graphId: 'cybersecurity_response.incident_response',
      input: incidentInput({
        signal_id: 'sig-credential-442', case_key: 'credential-442', source: 'identity-detection',
        title: 'Impossible travel followed by privileged token use', observed_at: '2026-08-11T02:14:00.000Z',
        confidence: 0.93, severity_hint: 'high', affected_asset_ids: ['cloud-admin-console'],
        asset_criticality: 'high', affected_identity_ids: ['identity.admin-42'], identity_kind: 'user', indicators: ['203.0.113.42', 'token-reuse'],
        technique_ids: ['T1078'], evidence_refs: ['siem://signals/sig-credential-442', 'idp://sessions/admin-42'],
      }),
      decisions: { incident_declaration_approval: true, containment_approval: true, recovery_approval: true },
      expectations: [
        { field: 'evidence_results', operator: 'min_items', value: 2, description: 'Preserves each declared evidence source.' },
        { field: 'containment_completed', operator: 'equals', value: true, description: 'Executes only approved containment.' },
        { field: 'incident_record', operator: 'includes', value: 'Status:** recovered', description: 'Publishes governed recovery evidence.' },
      ],
    },
    {
      id: 'critical_ransomware_response',
      label: 'Critical ransomware response',
      description: 'Coordinates multi-asset ransomware containment and recovery.',
      graphId: 'cybersecurity_response.incident_response',
      input: incidentInput({
        signal_id: 'sig-ransomware-901', case_key: 'ransomware-901', source: 'endpoint-detection',
        title: 'Encryption behavior and lateral movement detected', observed_at: '2026-08-11T03:05:00.000Z',
        confidence: 0.99, severity_hint: 'critical', affected_asset_ids: ['finance-db-01', 'backup-controller-02'],
        asset_criticality: 'critical', affected_identity_ids: ['identity.backup-service'], identity_kind: 'service', indicators: ['ransom-note-hash', 'east-west-smb-spike'],
        technique_ids: ['T1486', 'T1021.002'], evidence_refs: ['edr://cases/ransomware-901', 'network://captures/east-west-901', 'backup://audit/901'],
      }),
      decisions: { incident_declaration_approval: true, containment_approval: true, recovery_approval: true },
      expectations: [
        { field: 'severity_assessment', operator: 'exists', description: 'Produces evidence-backed critical classification.' },
        { field: 'containment_results', operator: 'min_items', value: 3, description: 'Scopes actions to all affected assets and identities.' },
        { field: 'incident_record', operator: 'includes', value: 'Severity:** critical', description: 'Preserves critical severity in the response record.' },
      ],
    },
    {
      id: 'benign_administration_activity',
      label: 'Benign administration activity',
      description: 'Preserves evidence and closes a low-confidence signal without declaring an incident.',
      graphId: 'cybersecurity_response.incident_response',
      input: incidentInput({
        signal_id: 'sig-admin-110', case_key: 'admin-110', source: 'cloud-audit',
        title: 'Expected infrastructure administrator change', observed_at: '2026-08-11T04:00:00.000Z',
        confidence: 0.2, severity_hint: 'low', affected_asset_ids: ['dev-cluster-04'], affected_identity_ids: ['identity.platform-admin'],
        asset_criticality: 'low', identity_kind: 'user', indicators: [], technique_ids: [], evidence_refs: ['audit://changes/change-110'],
      }),
      decisions: {},
      expectations: [
        { field: 'incident_likely', operator: 'equals', value: false, description: 'Does not force every signal into incident response.' },
        { field: 'incident_record', operator: 'includes', value: 'closed as non-incident', description: 'Publishes an attributable triage closure.' },
      ],
    },
    {
      id: 'failed_recovery_change',
      label: 'Failed recovery change',
      description: 'Escalates a degraded recovery and rolls back the failed change while containment remains active.',
      graphId: 'cybersecurity_response.observe_recovery',
      input: {
        incident_id: 'incident-ransomware-901', incident_title: 'Encryption behavior and lateral movement detected', incident_severity: 'critical',
        recovery_id: 'recovery-77', change_ref: 'change://rebuild/77',
        recovery_status: 'degraded', containment_still_active: true,
        health_signals: [{ name: 'malware_scan', status: 'failed' }, { name: 'service_health', status: 'failed' }],
      },
      decisions: {},
      expectations: [
        { field: 'recovery_rollback_completed', operator: 'equals', value: true, description: 'Rolls back the failed recovery change.' },
        { field: 'recovery_record', operator: 'includes', value: 'Outcome: degraded', description: 'Publishes failed recovery evidence.' },
      ],
    },
  ],
  graphs: [incidentResponseGraph(), analyzeEvidenceGraph(), observeRecoveryGraph()],
};

function incidentResponseGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'cybersecurity_response.incident_response', version: 1, name: 'Signal-to-recovery incident response',
    description: 'Preserve evidence, classify a signal, govern containment and recovery, and publish lessons learned.',
    trigger: {
      type: 'event', eventType: 'security.signal_observed', correlationField: 'case_key',
      inputSchema: {
        type: 'object', properties: {
          signal_id: { type: 'string' }, source: { type: 'string' }, title: { type: 'string' }, observed_at: { type: 'string' },
          confidence: { type: 'number' }, severity_hint: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          affected_asset_ids: { type: 'array', items: { type: 'string' } }, asset_criticality: { type: 'string' },
          affected_identity_ids: { type: 'array', items: { type: 'string' } }, identity_kind: { type: 'string' },
          indicators: { type: 'array', items: { type: 'string' } }, technique_ids: { type: 'array', items: { type: 'string' } },
          evidence_refs: { type: 'array', items: { type: 'string' } }, notification_audience: { type: 'array', items: { type: 'string' } },
          control_improvements: { type: 'array', items: { type: 'string' } },
        },
        required: ['signal_id', 'source', 'title', 'observed_at', 'confidence', 'severity_hint', 'affected_asset_ids', 'asset_criticality', 'affected_identity_ids', 'identity_kind', 'indicators', 'technique_ids', 'evidence_refs', 'notification_audience', 'control_improvements'],
        additionalProperties: false,
      },
    },
    state: { fields: incidentStateFields() },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Security signal', description: 'Accept a typed correlated signal.', reads: ['case_key', 'signal_id', 'source', 'title', 'observed_at', 'confidence', 'severity_hint', 'affected_asset_ids', 'asset_criticality', 'affected_identity_ids', 'identity_kind', 'indicators', 'technique_ids', 'evidence_refs', 'notification_audience', 'control_improvements'], writes: [], config: {} },
      { id: 'normalize_signal', kind: 'function', label: 'Normalize signal', description: 'Create an attributable triage boundary.', handler: 'cybersecurity_response.normalize_signal', reads: ['case_key', 'signal_id', 'source', 'title', 'observed_at', 'confidence'], writes: ['signal_record'], config: { roleId: 'soc_analyst', toolIds: ['siem_signal_read'] } },
      { id: 'prepare_evidence', kind: 'function', label: 'Prepare evidence', description: 'Require explicit evidence sources before classification.', handler: 'cybersecurity_response.prepare_evidence', reads: ['evidence_refs'], writes: ['evidence_items'], config: { roleId: 'forensic_analyst', evaluationId: 'evidence_integrity' } },
      { id: 'analyze_evidence', kind: 'map', label: 'Preserve evidence', description: 'Preserve evidence concurrently with bounded fan-out.', reads: ['evidence_items'], writes: ['evidence_results'], config: { graphId: 'cybersecurity_response.analyze_evidence', itemsField: 'evidence_items', itemField: 'evidence_ref', resultField: 'result', outputField: 'evidence_results', inputMapping: {}, maxItems: 100, maxConcurrency: 6 } },
      { id: 'correlate_and_classify', kind: 'function', label: 'Correlate and classify', description: 'Determine incident likelihood and severity from preserved evidence.', handler: 'cybersecurity_response.correlate_and_classify', reads: ['evidence_results', 'indicators', 'technique_ids', 'confidence', 'severity_hint'], writes: ['incident_likely', 'severity_assessment'], config: { roleId: 'soc_analyst', evaluationId: 'severity_classification', toolIds: ['asset_inventory_read', 'identity_context_read'] } },
      { id: 'triage_route', kind: 'router', label: 'Route triage', description: 'Separate non-incidents from declaration candidates.', reads: ['incident_likely'], writes: [], config: {} },
      { id: 'publish_non_incident', kind: 'function', label: 'Publish triage closure', description: 'Preserve evidence for a signal below the incident threshold.', handler: 'cybersecurity_response.publish_non_incident', reads: ['signal_id', 'confidence', 'evidence_results'], writes: ['incident_record'], config: { roleId: 'soc_analyst', toolIds: ['incident_record_upsert'] } },
      { id: 'incident_declaration_approval', kind: 'human', label: 'Declare incident', description: 'Confirm incident status and severity.', reads: ['signal_record', 'severity_assessment', 'evidence_results', 'affected_asset_ids', 'affected_identity_ids'], writes: ['incident_declared'], config: { decisionField: 'incident_declared', roleId: 'incident_commander', evaluationId: 'incident_declaration' } },
      { id: 'declaration_route', kind: 'router', label: 'Route declaration', description: 'Continue only with a declared incident.', reads: ['incident_declared'], writes: [], config: {} },
      { id: 'declare_incident', kind: 'function', label: 'Create incident', description: 'Create the governed incident record.', handler: 'cybersecurity_response.declare_incident', reads: ['case_key', 'title', 'severity_assessment', 'affected_asset_ids', 'affected_identity_ids'], writes: ['incident'], config: { roleId: 'incident_commander', toolIds: ['incident_record_upsert'] } },
      { id: 'plan_containment', kind: 'function', label: 'Plan containment', description: 'Scope reversible actions to affected assets and identities.', handler: 'cybersecurity_response.plan_containment', reads: ['incident', 'affected_asset_ids', 'affected_identity_ids', 'evidence_results'], writes: ['containment_plan'], config: { roleId: 'incident_commander' } },
      { id: 'containment_approval', kind: 'human', label: 'Approve containment', description: 'Authorize high-impact isolation and identity actions.', reads: ['incident', 'containment_plan', 'severity_assessment'], writes: ['containment_approved'], config: { decisionField: 'containment_approved', roleId: 'containment_approver', evaluationId: 'containment_approval' } },
      { id: 'containment_route', kind: 'router', label: 'Route containment', description: 'Execute only approved containment.', reads: ['containment_approved'], writes: [], config: {} },
      { id: 'execute_containment', kind: 'function', label: 'Execute containment', description: 'Request approved actions from external security authorities.', handler: 'cybersecurity_response.execute_containment', reads: ['containment_plan'], writes: ['containment_results', 'containment_completed'], config: { roleId: 'containment_approver', toolIds: ['containment_execute'] } },
      { id: 'notify_stakeholders', kind: 'function', label: 'Notify stakeholders', description: 'Coordinate accountable incident notification.', handler: 'cybersecurity_response.notify_stakeholders', reads: ['incident', 'notification_audience'], writes: ['notification_receipt'], config: { roleId: 'communications_lead', toolIds: ['notification_publish'] } },
      { id: 'containment_join', kind: 'join', label: 'Join containment', description: 'Wait for technical and communication evidence.', reads: ['containment_results', 'notification_receipt'], writes: [], config: { mode: 'all' } },
      { id: 'prepare_recovery', kind: 'function', label: 'Prepare recovery', description: 'Plan eradication, restoration and verification.', handler: 'cybersecurity_response.prepare_recovery', reads: ['incident', 'containment_results'], writes: ['recovery_plan'], config: { roleId: 'recovery_owner' } },
      { id: 'recovery_approval', kind: 'human', label: 'Approve recovery', description: 'Authorize eradication and controlled restoration.', reads: ['incident', 'recovery_plan', 'containment_results'], writes: ['recovery_approved'], config: { decisionField: 'recovery_approved', roleId: 'recovery_owner', evaluationId: 'recovery_approval' } },
      { id: 'recovery_route', kind: 'router', label: 'Route recovery', description: 'Execute only approved recovery.', reads: ['recovery_approved'], writes: [], config: {} },
      { id: 'execute_recovery', kind: 'function', label: 'Execute recovery', description: 'Request approved eradication and restoration changes.', handler: 'cybersecurity_response.execute_recovery', reads: ['incident', 'recovery_plan'], writes: ['recovery_result'], config: { roleId: 'recovery_owner', toolIds: ['recovery_change_execute'] } },
      { id: 'capture_lessons', kind: 'function', label: 'Capture lessons', description: 'Turn incident evidence into control improvements.', handler: 'cybersecurity_response.capture_lessons', reads: ['incident', 'control_improvements'], writes: ['lessons_learned'], config: { roleId: 'incident_commander' } },
      { id: 'publish_incident', kind: 'function', label: 'Publish response record', description: 'Publish the governed incident-to-recovery record.', handler: 'cybersecurity_response.publish_incident', reads: ['title', 'incident', 'severity_assessment', 'evidence_results', 'containment_results', 'recovery_result', 'lessons_learned'], writes: ['incident_record'], config: { roleId: 'incident_commander', toolIds: ['incident_record_upsert'] } },
      { id: 'record_rejection', kind: 'function', label: 'Record rejected action', description: 'Preserve the decision that stopped response execution.', handler: 'cybersecurity_response.record_rejection', reads: ['incident_declared', 'containment_approved', 'recovery_approved'], writes: ['rejection_reason'], config: {} },
    ],
    edges: [
      { id: 'e_start_normalize', source: 'start', target: 'normalize_signal', on: 'success' },
      { id: 'e_normalize_prepare', source: 'normalize_signal', target: 'prepare_evidence', on: 'success' },
      { id: 'e_prepare_analyze', source: 'prepare_evidence', target: 'analyze_evidence', on: 'success' },
      { id: 'e_analyze_classify', source: 'analyze_evidence', target: 'correlate_and_classify', on: 'success' },
      { id: 'e_classify_route', source: 'correlate_and_classify', target: 'triage_route', on: 'success' },
      { id: 'e_triage_close', source: 'triage_route', target: 'publish_non_incident', on: 'success', condition: { field: 'incident_likely', operator: 'equals', value: false }, label: 'Non-incident' },
      { id: 'e_triage_declare', source: 'triage_route', target: 'incident_declaration_approval', on: 'success', condition: { field: 'incident_likely', operator: 'equals', value: true }, label: 'Incident candidate' },
      { id: 'e_declaration_route', source: 'incident_declaration_approval', target: 'declaration_route', on: 'success' },
      { id: 'e_declaration_create', source: 'declaration_route', target: 'declare_incident', on: 'success', condition: { field: 'incident_declared', operator: 'equals', value: true }, label: 'Declared' },
      { id: 'e_declaration_reject', source: 'declaration_route', target: 'record_rejection', on: 'success', condition: { field: 'incident_declared', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_declare_plan', source: 'declare_incident', target: 'plan_containment', on: 'success' },
      { id: 'e_plan_approve', source: 'plan_containment', target: 'containment_approval', on: 'success' },
      { id: 'e_containment_route', source: 'containment_approval', target: 'containment_route', on: 'success' },
      { id: 'e_containment_execute', source: 'containment_route', target: 'execute_containment', on: 'success', condition: { field: 'containment_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_containment_notify', source: 'containment_route', target: 'notify_stakeholders', on: 'success', condition: { field: 'containment_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_containment_reject', source: 'containment_route', target: 'record_rejection', on: 'success', condition: { field: 'containment_approved', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_execute_join', source: 'execute_containment', target: 'containment_join', on: 'success' },
      { id: 'e_notify_join', source: 'notify_stakeholders', target: 'containment_join', on: 'success' },
      { id: 'e_join_recovery', source: 'containment_join', target: 'prepare_recovery', on: 'success' },
      { id: 'e_recovery_approve', source: 'prepare_recovery', target: 'recovery_approval', on: 'success' },
      { id: 'e_recovery_route', source: 'recovery_approval', target: 'recovery_route', on: 'success' },
      { id: 'e_recovery_execute', source: 'recovery_route', target: 'execute_recovery', on: 'success', condition: { field: 'recovery_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_recovery_reject', source: 'recovery_route', target: 'record_rejection', on: 'success', condition: { field: 'recovery_approved', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_execute_lessons', source: 'execute_recovery', target: 'capture_lessons', on: 'success' },
      { id: 'e_lessons_publish', source: 'capture_lessons', target: 'publish_incident', on: 'success' },
    ],
    budget: { maxSteps: 128, maxDurationMs: 300_000, maxConcurrency: 6 },
  };
}

function analyzeEvidenceGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'cybersecurity_response.analyze_evidence', version: 1, name: 'Preserve and analyze evidence',
    description: 'Reusable child graph for one attributable evidence source.',
    state: { fields: {
      evidence_ref: field('string', true, 'Evidence locator.'), result: field('object', false, 'Preservation result.'),
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Evidence source', description: 'Accept one evidence reference.', reads: ['evidence_ref'], writes: [], config: {} },
      { id: 'analyze', kind: 'function', label: 'Preserve evidence', description: 'Produce deterministic reference digest and custody evidence.', handler: 'cybersecurity_response.analyze_evidence', reads: ['evidence_ref'], writes: ['result'], config: { roleId: 'forensic_analyst', toolIds: ['evidence_preserve'] } },
    ],
    edges: [{ id: 'e_start_analyze', source: 'start', target: 'analyze', on: 'success' }],
    budget: { maxSteps: 8, maxDurationMs: 30_000, maxConcurrency: 1 },
  };
}

function observeRecoveryGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'cybersecurity_response.observe_recovery', version: 1, name: 'Observe security recovery',
    description: 'Accept recovery health signals, close healthy changes or visibly roll back failed recovery while preserving containment.',
    trigger: {
      type: 'event', eventType: 'security.recovery_observed', correlationField: 'incident_id',
      inputSchema: {
        type: 'object', properties: {
          incident_title: { type: 'string' }, incident_severity: { type: 'string' }, recovery_id: { type: 'string' }, change_ref: { type: 'string' }, recovery_status: { type: 'string' },
          containment_still_active: { type: 'boolean' }, health_signals: { type: 'array', items: { type: 'object' } },
        }, required: ['incident_title', 'incident_severity', 'recovery_id', 'change_ref', 'recovery_status', 'containment_still_active', 'health_signals'], additionalProperties: false,
      },
    },
    state: { fields: {
      incident_id: field('string', true, 'Incident identifier.'), incident_title: field('string', true, 'Incident title.'),
      incident_severity: field('string', true, 'Incident severity.'), recovery_id: field('string', true, 'Recovery identifier.'),
      change_ref: field('string', true, 'Recovery change reference.'), recovery_status: field('string', true, 'Observed status.'),
      containment_still_active: field('boolean', true, 'Whether containment remains active.'), health_signals: field('array', true, 'Recovery health signals.'),
      recovery_healthy: field('boolean', false, 'Health decision.'), recovery_observation: field('object', false, 'Recovery observation.'),
      recovery_rollback_completed: field('boolean', false, 'Failed-change rollback result.'), recovery_rollback_reference: field('string', false, 'Rollback evidence.'),
      recovery_record: field('string', false, 'Recovery record.'),
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Recovery observed', description: 'Accept correlated recovery health evidence.', reads: ['incident_id', 'incident_title', 'incident_severity', 'recovery_id', 'change_ref', 'recovery_status', 'containment_still_active', 'health_signals'], writes: [], config: {} },
      { id: 'assess_recovery', kind: 'function', label: 'Assess recovery', description: 'Require positive post-change health evidence.', handler: 'cybersecurity_response.assess_recovery', reads: ['incident_id', 'recovery_id', 'recovery_status', 'health_signals'], writes: ['recovery_healthy', 'recovery_observation'], config: { roleId: 'recovery_owner', evaluationId: 'recovery_health' } },
      { id: 'recovery_route', kind: 'router', label: 'Route recovery health', description: 'Separate healthy closure from failed-change handling.', reads: ['recovery_healthy'], writes: [], config: {} },
      { id: 'publish_healthy', kind: 'function', label: 'Publish healthy recovery', description: 'Preserve verified healthy recovery evidence.', handler: 'cybersecurity_response.publish_healthy_recovery', reads: ['incident_id', 'change_ref', 'containment_still_active'], writes: ['recovery_record'], config: { roleId: 'recovery_owner', toolIds: ['incident_record_upsert'] } },
      { id: 'escalate_failure', kind: 'escalation', label: 'Escalate failed recovery', description: 'Raise accountable response without removing containment.', reads: ['incident_id', 'recovery_observation'], writes: [], config: { reason: 'Recovery health failed; keep containment active and reassess eradication.', severity: 'critical', roleId: 'incident_commander' } },
      { id: 'rollback_recovery', kind: 'compensation', label: 'Rollback recovery change', description: 'Revert only the failed recovery change while preserving containment.', handler: 'cybersecurity_response.rollback_recovery_change', reads: ['recovery_id', 'change_ref', 'containment_still_active'], writes: ['recovery_rollback_completed', 'recovery_rollback_reference'], config: { compensates: ['assess_recovery'] } },
      { id: 'failure_join', kind: 'join', label: 'Join failure response', description: 'Wait for escalation and rollback evidence.', reads: ['recovery_rollback_completed', 'recovery_rollback_reference'], writes: [], config: { mode: 'all' } },
      { id: 'publish_failed', kind: 'function', label: 'Publish failed recovery', description: 'Preserve degraded health and safe rollback evidence.', handler: 'cybersecurity_response.publish_failed_recovery', reads: ['incident_id', 'recovery_rollback_reference'], writes: ['recovery_record'], config: { roleId: 'incident_commander', toolIds: ['incident_record_upsert'] } },
    ],
    edges: [
      { id: 'e_start_assess', source: 'start', target: 'assess_recovery', on: 'success' },
      { id: 'e_assess_route', source: 'assess_recovery', target: 'recovery_route', on: 'success' },
      { id: 'e_route_healthy', source: 'recovery_route', target: 'publish_healthy', on: 'success', condition: { field: 'recovery_healthy', operator: 'equals', value: true }, label: 'Healthy' },
      { id: 'e_route_escalate', source: 'recovery_route', target: 'escalate_failure', on: 'success', condition: { field: 'recovery_healthy', operator: 'equals', value: false }, label: 'Degraded' },
      { id: 'e_route_rollback', source: 'recovery_route', target: 'rollback_recovery', on: 'success', condition: { field: 'recovery_healthy', operator: 'equals', value: false }, label: 'Degraded' },
      { id: 'e_escalate_join', source: 'escalate_failure', target: 'failure_join', on: 'success' },
      { id: 'e_rollback_join', source: 'rollback_recovery', target: 'failure_join', on: 'success' },
      { id: 'e_join_publish', source: 'failure_join', target: 'publish_failed', on: 'success' },
    ],
    budget: { maxSteps: 24, maxDurationMs: 60_000, maxConcurrency: 2 },
  };
}

function incidentStateFields(): IndustryPackManifest['graphs'][number]['state']['fields'] {
  return {
    case_key: field('string', true, 'Correlation key.'), signal_id: field('string', true, 'Signal identifier.'),
    source: field('string', true, 'Signal source.'), title: field('string', true, 'Signal title.'),
    observed_at: field('string', true, 'Observation timestamp.'), confidence: field('number', true, 'Signal confidence.'),
    severity_hint: field('string', true, 'Source severity hint.'), affected_asset_ids: field('array', true, 'Affected assets.'),
    asset_criticality: field('string', true, 'Affected asset criticality.'), affected_identity_ids: field('array', true, 'Affected identities.'),
    identity_kind: field('string', true, 'Affected identity category.'), indicators: field('array', true, 'Observed indicators.'),
    technique_ids: field('array', true, 'ATT&CK technique references.'), evidence_refs: field('array', true, 'Evidence locators.'),
    notification_audience: field('array', true, 'Notification audience.'), control_improvements: field('array', true, 'Proposed control improvements.'),
    signal_record: field('object', false, 'Normalized signal.'), evidence_items: field('array', false, 'Bounded evidence list.'),
    evidence_results: field('array', false, 'Preservation results.'), incident_likely: field('boolean', false, 'Incident threshold result.'),
    severity_assessment: field('object', false, 'Severity assessment.'), incident_declared: field('boolean', false, 'Declaration decision.'),
    incident: field('object', false, 'Declared incident.'), containment_plan: field('object', false, 'Containment plan.'),
    containment_approved: field('boolean', false, 'Containment decision.'), containment_results: field('array', false, 'Containment results.'),
    containment_completed: field('boolean', false, 'Containment completion.'), notification_receipt: field('object', false, 'Notification evidence.'),
    recovery_plan: field('object', false, 'Recovery plan.'), recovery_approved: field('boolean', false, 'Recovery decision.'),
    recovery_result: field('object', false, 'Recovery result.'), lessons_learned: field('object', false, 'Lessons learned.'),
    incident_record: field('string', false, 'Incident response record.'), rejection_reason: field('string', false, 'Rejection reason.'),
  };
}

function incidentInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    notification_audience: ['security-leadership', 'service-owner'],
    control_improvements: ['strengthen identity session controls', 'expand correlated detection coverage'],
  };
}

function field(type: 'string' | 'number' | 'boolean' | 'object' | 'array', required: boolean, description: string) {
  return { type, required, description } as const;
}

function typedQuery(
  id: string, label: string, description: string,
  inputProperties: Record<string, unknown>, inputRequired: string[],
  outputProperties: Record<string, unknown>, outputRequired: string[],
): IndustryPackManifest['tools'][number] {
  return {
    id, label, description, risk: 'read', operation: 'query', idempotency: 'intrinsic',
    inputSchema: { type: 'object', properties: inputProperties, required: inputRequired, additionalProperties: false },
    outputSchema: { type: 'object', properties: outputProperties, required: outputRequired, additionalProperties: false },
  } as IndustryPackManifest['tools'][number];
}

function typedCommand(
  id: string, label: string, description: string, risk: 'write' | 'external',
  inputProperties: Record<string, unknown>, inputRequired: string[],
  outputProperties: Record<string, unknown>, outputRequired: string[],
): IndustryPackManifest['tools'][number] {
  return {
    id, label, description, risk, operation: 'command', idempotency: 'keyed', idempotencyKeyField: 'idempotency_key',
    inputSchema: { type: 'object', properties: inputProperties, required: inputRequired, additionalProperties: false },
    outputSchema: { type: 'object', properties: outputProperties, required: outputRequired, additionalProperties: false },
  } as IndustryPackManifest['tools'][number];
}
