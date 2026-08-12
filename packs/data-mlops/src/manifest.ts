import type { IndustryPackManifest } from '@graph-workbench/contracts';

export const dataMlopsPack: IndustryPackManifest = {
  id: 'data_mlops',
  version: '0.4.1',
  name: 'Data and MLOps Asset Release Pack',
  description:
    'A governed data and model asset workflow for partition quality, lineage, accountable registry publication, controlled backfill, post-release monitoring, escalation and rollback.',
  license: 'MIT',
  ontology: {
    objectTypes: [
      {
        id: 'data_asset',
        label: 'Data asset',
        description: 'A governed dataset, feature set or model with an accountable owner.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Stable asset identifier.' },
          name: { type: 'string', required: true, description: 'Human-readable asset name.' },
          kind: { type: 'string', required: true, description: 'Dataset, feature set or model.' },
          owner: { type: 'string', required: true, description: 'Accountable owner.' },
        },
      },
      {
        id: 'asset_version',
        label: 'Asset version',
        description: 'An immutable version proposed or published through a registry.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Parent asset identifier.' },
          version: { type: 'string', required: true, description: 'Immutable version.' },
          source_uri: { type: 'string', required: true, description: 'Materialized source locator.' },
          status: { type: 'string', required: true, description: 'Release status.' },
        },
      },
      {
        id: 'data_partition',
        label: 'Data partition',
        description: 'A bounded materialization or backfill partition.',
        fields: {
          partition_key: { type: 'string', required: true, description: 'Partition key.' },
          digest: { type: 'string', required: true, description: 'Partition content digest.' },
          row_count: { type: 'number', required: true, description: 'Observed row count.' },
          status: { type: 'string', required: true, description: 'Processing status.' },
        },
      },
      {
        id: 'schema_contract',
        label: 'Schema contract',
        description: 'The expected fields, types and compatibility policy for an asset.',
        fields: {
          contract_id: { type: 'string', required: true, description: 'Contract identifier.' },
          version: { type: 'string', required: true, description: 'Contract version.' },
          compatibility: { type: 'string', required: true, description: 'Compatibility policy.' },
        },
      },
      {
        id: 'quality_evaluation',
        label: 'Quality evaluation',
        description: 'A blocking asset-quality result with attributable evidence.',
        fields: {
          status: { type: 'string', required: true, description: 'Gate status.' },
          partition_count: { type: 'number', required: true, description: 'Evaluated partitions.' },
          minimum_completeness: { type: 'number', required: true, description: 'Observed completeness.' },
          maximum_freshness_minutes: { type: 'number', required: true, description: 'Observed freshness lag.' },
        },
      },
      {
        id: 'lineage_source',
        label: 'Lineage source',
        description: 'An upstream asset or transformation dependency.',
        fields: {
          uri: { type: 'string', required: true, description: 'Source locator.' },
          role: { type: 'string', required: true, description: 'Input or transformation.' },
        },
      },
      {
        id: 'governance_decision',
        label: 'Governance decision',
        description: 'An accountable approval at an asset-release or backfill gate.',
        fields: {
          gate: { type: 'string', required: true, description: 'Gate identity.' },
          approved: { type: 'boolean', required: true, description: 'Decision outcome.' },
        },
      },
      {
        id: 'registry_release',
        label: 'Registry release',
        description: 'A published dataset or model version and its named alias.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Published asset.' },
          version: { type: 'string', required: true, description: 'Published version.' },
          registry: { type: 'string', required: true, description: 'Registry locator.' },
          alias: { type: 'string', required: true, description: 'Named release alias.' },
          status: { type: 'string', required: true, description: 'Registry status.' },
        },
      },
      {
        id: 'backfill',
        label: 'Backfill',
        description: 'An approved bounded reprocessing request and outcome.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Reprocessed asset.' },
          reprocess_behavior: { type: 'string', required: true, description: 'Missing, failed or completed behavior.' },
          partition_count: { type: 'number', required: true, description: 'Reprocessed partitions.' },
          dry_run: { type: 'boolean', required: true, description: 'Whether execution was a dry run.' },
        },
      },
      {
        id: 'quality_incident',
        label: 'Quality incident',
        description: 'A post-publication quality degradation and recovery result.',
        fields: {
          asset_id: { type: 'string', required: true, description: 'Affected asset.' },
          registry_entry_id: { type: 'string', required: true, description: 'Affected registry entry.' },
          signal_count: { type: 'number', required: true, description: 'Observed signals.' },
          rollback_completed: { type: 'boolean', required: true, description: 'Recovery outcome.' },
        },
      },
      {
        id: 'data_delivery_record',
        label: 'Data delivery record',
        description: 'A portable asset release, backfill or monitoring record.',
        fields: {
          record_type: { type: 'string', required: true, description: 'Record category.' },
          content: { type: 'string', required: true, description: 'Markdown record.' },
        },
      },
    ],
    relationTypes: [
      { id: 'has_version', label: 'Has version', description: 'An asset owns a version.', sourceTypes: ['data_asset'], targetTypes: ['asset_version'] },
      { id: 'partition_of', label: 'Partition of', description: 'A partition belongs to an asset version.', sourceTypes: ['data_partition'], targetTypes: ['asset_version'] },
      { id: 'conforms_to', label: 'Conforms to', description: 'An asset version conforms to a schema contract.', sourceTypes: ['asset_version'], targetTypes: ['schema_contract'] },
      { id: 'validates_asset', label: 'Validates asset', description: 'A quality evaluation validates an asset version.', sourceTypes: ['quality_evaluation'], targetTypes: ['asset_version'] },
      { id: 'derived_from', label: 'Derived from', description: 'An asset version derives from an upstream source.', sourceTypes: ['asset_version'], targetTypes: ['lineage_source'] },
      { id: 'governs_release', label: 'Governs release', description: 'A decision governs registry publication.', sourceTypes: ['governance_decision'], targetTypes: ['registry_release'] },
      { id: 'publishes_version', label: 'Publishes version', description: 'A registry release publishes an asset version.', sourceTypes: ['registry_release'], targetTypes: ['asset_version'] },
      { id: 'reprocesses', label: 'Reprocesses', description: 'A backfill reprocesses an asset version.', sourceTypes: ['backfill'], targetTypes: ['asset_version'] },
      { id: 'affects_release', label: 'Affects release', description: 'A quality incident affects a registry release.', sourceTypes: ['quality_incident'], targetTypes: ['registry_release'] },
      { id: 'documents_data_work', label: 'Documents', description: 'A record documents a release, backfill or quality incident.', sourceTypes: ['data_delivery_record'], targetTypes: ['registry_release', 'backfill', 'quality_incident'] },
    ],
  },
  roles: [
    {
      id: 'data_product_owner',
      label: 'Data product owner',
      mission: 'Own asset meaning, consumers, acceptance criteria and release accountability.',
      allowedTools: ['catalog_asset_read', 'lineage_read'],
      forbiddenActions: ['Approving an asset without a named owner or consumer contract'],
    },
    {
      id: 'data_engineer',
      label: 'Data engineer',
      mission: 'Materialize reproducible partitions while preserving source and run identity.',
      allowedTools: ['catalog_asset_read', 'orchestrator_run_read', 'lineage_read', 'backfill_create'],
      forbiddenActions: ['Reprocessing unbounded history', 'Hiding failed partitions'],
    },
    {
      id: 'quality_reviewer',
      label: 'Data quality reviewer',
      mission: 'Enforce schema, completeness, freshness and attributable evidence gates.',
      allowedTools: ['catalog_asset_read', 'orchestrator_run_read', 'lineage_read'],
      forbiddenActions: ['Waiving a blocking quality failure without a recorded decision'],
    },
    {
      id: 'model_risk_reviewer',
      label: 'Model risk reviewer',
      mission: 'Review declared model evaluation metrics, lineage and deployment fitness.',
      allowedTools: ['catalog_asset_read', 'lineage_read'],
      forbiddenActions: ['Approving a model without declared evaluation metrics'],
    },
    {
      id: 'release_steward',
      label: 'Registry release steward',
      mission: 'Publish only approved immutable versions and control aliases or tags.',
      allowedTools: ['catalog_asset_read', 'registry_publish', 'model_alias_set'],
      forbiddenActions: ['Publishing a mutable or unapproved asset version'],
    },
    {
      id: 'platform_operator',
      label: 'Data platform operator',
      mission: 'Own bounded backfills, operational incidents, quarantine and registry rollback.',
      allowedTools: ['orchestrator_run_read', 'backfill_create', 'model_alias_set'],
      forbiddenActions: ['Starting an unapproved destructive backfill'],
    },
  ],
  tools: [
    typedQuery('catalog_asset_read', 'Read catalog asset', 'Read asset ownership and registration metadata.', {
      asset_id: { type: 'string' },
    }, ['asset_id'], {
      asset_id: { type: 'string' }, status: { type: 'string' }, owner: { type: 'string' },
    }, ['asset_id', 'status', 'owner']),
    typedQuery('orchestrator_run_read', 'Read orchestrator run', 'Read an Airflow, Dagster or compatible run without controlling it.', {
      run_id: { type: 'string' },
    }, ['run_id'], {
      run_id: { type: 'string' }, status: { type: 'string' }, logical_date: { type: 'string' },
    }, ['run_id', 'status', 'logical_date']),
    typedQuery('lineage_read', 'Read lineage', 'Read upstream lineage from the authoritative catalog.', {
      asset_id: { type: 'string' },
    }, ['asset_id'], {
      asset_id: { type: 'string' }, upstream: { type: 'array', items: { type: 'string' } },
    }, ['asset_id', 'upstream']),
    typedCommand('registry_publish', 'Publish registry entry', 'Publish an approved immutable asset version.', 'external', {
      idempotency_key: { type: 'string' }, asset_id: { type: 'string' }, version: { type: 'string' }, registry: { type: 'string' },
    }, ['idempotency_key', 'asset_id', 'version', 'registry'], {
      registry_id: { type: 'string' }, status: { type: 'string' },
    }, ['registry_id', 'status']),
    typedCommand('backfill_create', 'Create backfill', 'Request bounded partition reprocessing from the execution authority.', 'external', {
      idempotency_key: { type: 'string' }, asset_id: { type: 'string' }, partitions: { type: 'array', items: { type: 'string' } }, reprocess_behavior: { type: 'string' },
    }, ['idempotency_key', 'asset_id', 'partitions', 'reprocess_behavior'], {
      backfill_id: { type: 'string' }, status: { type: 'string' },
    }, ['backfill_id', 'status']),
    typedCommand('model_alias_set', 'Set model alias', 'Assign or restore a named model-version alias.', 'external', {
      idempotency_key: { type: 'string' }, model_name: { type: 'string' }, alias: { type: 'string' }, version: { type: 'string' },
    }, ['idempotency_key', 'model_name', 'alias', 'version'], {
      model_name: { type: 'string' }, alias: { type: 'string' }, version: { type: 'string' }, status: { type: 'string' },
    }, ['model_name', 'alias', 'version', 'status']),
  ],
  evaluations: [
    { id: 'schema_compatibility', label: 'Schema compatibility', description: 'The asset declares an approved compatibility contract.', blocking: true },
    { id: 'partition_quality', label: 'Partition quality', description: 'Every released partition meets completeness and freshness thresholds.', blocking: true },
    { id: 'lineage_completeness', label: 'Lineage completeness', description: 'Every asset version records source and transformation lineage.', blocking: true },
    { id: 'data_owner_approval', label: 'Data-owner approval', description: 'The accountable data-product owner approves release evidence.', blocking: true },
    { id: 'model_risk_approval', label: 'Model-risk approval', description: 'Model releases receive independent metric and lineage review.', blocking: true },
    { id: 'registry_approval', label: 'Registry approval', description: 'A release steward approves immutable publication.', blocking: true },
    { id: 'backfill_approval', label: 'Backfill approval', description: 'An operator approves bounded reprocessing behavior and concurrency.', blocking: true },
    { id: 'monitoring_health', label: 'Monitoring health', description: 'Published asset signals remain healthy or trigger recovery.', blocking: true },
  ],
  deliverables: [
    {
      id: 'asset_release_record', label: 'Asset release record', description: 'A governed dataset or model publication record.',
      graphId: 'data_mlops.asset_release', stateField: 'asset_release_record', mediaType: 'text/markdown',
      artifactType: 'data_asset_release', evidenceFields: ['partition_results', 'quality_summary', 'lineage_record', 'model_metrics'], approvalField: 'release_approved',
    },
    {
      id: 'backfill_record', label: 'Backfill record', description: 'An approved bounded backfill record.',
      graphId: 'data_mlops.controlled_backfill', stateField: 'backfill_record', mediaType: 'text/markdown',
      artifactType: 'data_backfill_record', evidenceFields: ['backfill_plan', 'partition_results'], approvalField: 'backfill_approved',
    },
    {
      id: 'monitoring_record', label: 'Asset monitoring record', description: 'A healthy observation or recovered quality incident.',
      graphId: 'data_mlops.monitor_asset', stateField: 'monitoring_record', mediaType: 'text/markdown',
      artifactType: 'data_monitoring_record', evidenceFields: ['quality_signals', 'incident_summary'],
    },
  ],
  fixtures: [
    {
      id: 'daily_customer_dataset',
      label: 'Daily customer dataset release',
      description: 'Publishes two validated daily partitions with lineage and approvals.',
      graphId: 'data_mlops.asset_release',
      input: releaseInput({
        asset_id: 'analytics.customer_360', asset_name: 'Customer 360', asset_kind: 'dataset', asset_version: '2026.08.11',
        owner: 'customer-analytics', source_uri: 'warehouse://raw/customer-events', target_registry: 'catalog://analytics',
        partitions: ['2026-08-10', '2026-08-11'], lineage_inputs: ['raw.customer_events', 'crm.accounts'],
        transformation_ref: 'git://data-platform/customer-360@a1b2c3', model_metrics: {},
      }),
      decisions: { data_owner_approval: true, release_approval: true },
      expectations: [
        { field: 'partition_results', operator: 'min_items', value: 2, description: 'Validates every declared partition.' },
        { field: 'quality_summary', operator: 'exists', description: 'Produces a blocking aggregate quality result.' },
        { field: 'asset_release_record', operator: 'includes', value: '# Data asset release', description: 'Publishes the approved asset record.' },
      ],
    },
    {
      id: 'churn_model_candidate',
      label: 'Churn model candidate',
      description: 'Requires model metrics and independent model-risk review before alias publication.',
      graphId: 'data_mlops.asset_release',
      input: releaseInput({
        asset_id: 'ml.customer_churn', asset_name: 'Customer churn propensity', asset_kind: 'model', asset_version: '17',
        owner: 'retention-ml', source_uri: 'mlflow://runs/churn-training-17', target_registry: 'models://retention',
        partitions: ['training-run-17'], lineage_inputs: ['features.customer_30d', 'labels.churn_90d'],
        transformation_ref: 'git://ml/churn@d4e5f6', model_metrics: { auc: 0.89, calibration_error: 0.03, drift_baseline: 0.01 },
      }),
      decisions: { data_owner_approval: true, model_risk_approval: true, release_approval: true },
      expectations: [
        { field: 'model_risk_approved', operator: 'equals', value: true, description: 'Records independent model-risk approval.' },
        { field: 'asset_release_record', operator: 'includes', value: 'champion-candidate', description: 'Publishes a named candidate alias.' },
      ],
    },
    {
      id: 'failed_only_backfill',
      label: 'Failed-only backfill',
      description: 'Reprocesses a bounded historical window with explicit behavior and concurrency.',
      graphId: 'data_mlops.controlled_backfill',
      input: {
        asset_id: 'analytics.customer_360', asset_version: '2026.08.11', source_uri: 'warehouse://raw/customer-events',
        partitions: ['2026-08-01', '2026-08-02', '2026-08-03'],
        schema_contract: schemaContract(), quality_thresholds: qualityThresholds(),
        reprocess_behavior: 'failed', max_active_runs: 2, dry_run: false,
      },
      decisions: { backfill_approval: true },
      expectations: [
        { field: 'partition_results', operator: 'min_items', value: 3, description: 'Processes the approved partition window.' },
        { field: 'backfill_record', operator: 'includes', value: 'Reprocess behavior: failed', description: 'Preserves reprocessing policy.' },
      ],
    },
    {
      id: 'model_quality_degradation',
      label: 'Model quality degradation',
      description: 'Escalates drift and restores the previous registry alias.',
      graphId: 'data_mlops.monitor_asset',
      input: {
        asset_id: 'ml.customer_churn', asset_version: '17', registry_entry_id: 'models://retention/customer_churn/17',
        registry: 'models://retention', alias: 'champion-candidate', asset_kind: 'model',
        quality_signals: [{ name: 'prediction_drift', status: 'failed', value: 0.21 }, { name: 'calibration', status: 'failed', value: 0.12 }],
      },
      decisions: {},
      expectations: [
        { field: 'rollback_completed', operator: 'equals', value: true, description: 'Completes registry rollback or quarantine.' },
        { field: 'monitoring_record', operator: 'includes', value: 'Outcome: degraded', description: 'Publishes incident evidence.' },
      ],
    },
  ],
  graphs: [assetReleaseGraph(), processPartitionGraph(), controlledBackfillGraph(), monitorAssetGraph()],
};

function assetReleaseGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'data_mlops.asset_release', version: 1, name: 'Data and model asset release',
    description: 'Validate materialized partitions, aggregate quality, capture lineage and require appropriate owner, model-risk and registry approvals.',
    trigger: {
      type: 'event', eventType: 'data.asset_materialized', correlationField: 'asset_id',
      inputSchema: {
        type: 'object', properties: {
          asset_name: { type: 'string' }, asset_kind: { type: 'string', enum: ['dataset', 'feature_set', 'model'] }, asset_version: { type: 'string' },
          owner: { type: 'string' }, source_uri: { type: 'string' }, target_registry: { type: 'string' },
          partitions: { type: 'array', items: { type: 'string' } }, schema_contract: { type: 'object' }, quality_thresholds: { type: 'object' },
          lineage_inputs: { type: 'array', items: { type: 'string' } }, transformation_ref: { type: 'string' }, model_metrics: { type: 'object' },
        },
        required: ['asset_name', 'asset_kind', 'asset_version', 'owner', 'source_uri', 'target_registry', 'partitions', 'schema_contract', 'quality_thresholds', 'lineage_inputs', 'transformation_ref', 'model_metrics'],
        additionalProperties: false,
      },
    },
    state: { fields: releaseStateFields() },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Asset materialized', description: 'Accept a correlated materialization event.', reads: ['asset_id', 'asset_name', 'asset_kind', 'asset_version', 'owner', 'source_uri', 'target_registry', 'partitions', 'schema_contract', 'quality_thresholds', 'lineage_inputs', 'transformation_ref', 'model_metrics'], writes: [], config: {} },
      { id: 'normalize_asset', kind: 'function', label: 'Normalize asset', description: 'Create a stable asset and processing boundary.', handler: 'data_mlops.normalize_asset', reads: ['asset_id', 'asset_name', 'asset_kind', 'asset_version', 'owner', 'source_uri', 'target_registry'], writes: ['asset_definition', 'processing_mode'], config: { roleId: 'data_product_owner' } },
      { id: 'prepare_partitions', kind: 'function', label: 'Prepare partitions', description: 'Bound the materialization set before dynamic execution.', handler: 'data_mlops.prepare_partitions', reads: ['partitions'], writes: ['processing_partitions'], config: {} },
      { id: 'process_partitions', kind: 'map', label: 'Validate partitions', description: 'Run partition validation with bounded concurrency.', reads: ['processing_partitions', 'source_uri', 'schema_contract', 'quality_thresholds', 'processing_mode'], writes: ['partition_results'], config: { graphId: 'data_mlops.process_partition', itemsField: 'processing_partitions', itemField: 'partition', resultField: 'result', outputField: 'partition_results', inputMapping: { source_uri: 'source_uri', schema_contract: 'schema_contract', quality_thresholds: 'quality_thresholds', processing_mode: 'processing_mode' }, maxItems: 500, maxConcurrency: 8 } },
      { id: 'quality_gate', kind: 'function', label: 'Aggregate quality', description: 'Apply schema, completeness and freshness gates.', handler: 'data_mlops.aggregate_quality', reads: ['partition_results', 'quality_thresholds', 'schema_contract'], writes: ['quality_summary'], config: { roleId: 'quality_reviewer', evaluationId: 'partition_quality' } },
      { id: 'quality_failure', kind: 'escalation', label: 'Escalate quality failure', description: 'Make a blocked asset release visible.', reads: ['asset_id'], writes: [], config: { reason: 'Asset quality gate failed before governance review.', severity: 'high', roleId: 'data_product_owner' } },
      { id: 'record_quality_failure', kind: 'function', label: 'Record quality failure', description: 'Preserve the blocking failure.', handler: 'data_mlops.record_quality_failure', reads: ['asset_id'], writes: ['rejection_reason'], config: {} },
      { id: 'capture_lineage', kind: 'function', label: 'Capture lineage', description: 'Bind upstream sources and transformation identity.', handler: 'data_mlops.capture_lineage', reads: ['asset_id', 'asset_version', 'source_uri', 'lineage_inputs', 'transformation_ref'], writes: ['lineage_record'], config: { evaluationId: 'lineage_completeness' } },
      { id: 'data_owner_approval', kind: 'human', label: 'Data-owner approval', description: 'Approve meaning, consumers, quality and lineage.', reads: ['asset_definition', 'quality_summary', 'lineage_record'], writes: ['data_owner_approved'], config: { decisionField: 'data_owner_approved', roleId: 'data_product_owner', evaluationId: 'data_owner_approval' } },
      { id: 'owner_route', kind: 'router', label: 'Route owner decision', description: 'Continue only with approved owner evidence.', reads: ['data_owner_approved'], writes: [], config: {} },
      { id: 'asset_kind_route', kind: 'router', label: 'Route asset kind', description: 'Require an additional independent review for models.', reads: ['asset_kind'], writes: [], config: {} },
      { id: 'model_risk_approval', kind: 'human', label: 'Model-risk approval', description: 'Independently review model metrics and lineage.', reads: ['asset_definition', 'quality_summary', 'lineage_record', 'model_metrics'], writes: ['model_risk_approved'], config: { decisionField: 'model_risk_approved', roleId: 'model_risk_reviewer', evaluationId: 'model_risk_approval' } },
      { id: 'model_route', kind: 'router', label: 'Route model decision', description: 'Continue only with approved model risk.', reads: ['model_risk_approved'], writes: [], config: {} },
      { id: 'prepare_release', kind: 'function', label: 'Prepare registry release', description: 'Create an immutable version and candidate alias.', handler: 'data_mlops.prepare_registry_release', reads: ['asset_id', 'asset_name', 'asset_kind', 'asset_version', 'target_registry', 'quality_summary', 'model_metrics'], writes: ['registry_release'], config: {} },
      { id: 'release_approval', kind: 'human', label: 'Registry approval', description: 'Authorize publication of the immutable asset version.', reads: ['registry_release', 'quality_summary', 'lineage_record'], writes: ['release_approved'], config: { decisionField: 'release_approved', roleId: 'release_steward', evaluationId: 'registry_approval' } },
      { id: 'release_route', kind: 'router', label: 'Route release decision', description: 'Publish only approved versions.', reads: ['release_approved'], writes: [], config: {} },
      { id: 'publish_asset', kind: 'function', label: 'Publish registry entry', description: 'Publish the approved record and candidate alias.', handler: 'data_mlops.publish_asset', reads: ['asset_id', 'asset_name', 'asset_kind', 'asset_version', 'owner', 'target_registry', 'quality_summary', 'lineage_record', 'model_metrics', 'registry_release', 'data_owner_approved', 'model_risk_approved', 'release_approved'], writes: ['registry_entry', 'asset_release_record'], config: { roleId: 'release_steward', toolIds: ['registry_publish', 'model_alias_set'] } },
      { id: 'record_rejection', kind: 'function', label: 'Record rejection', description: 'Preserve the decision that stopped publication.', handler: 'data_mlops.record_release_rejection', reads: ['data_owner_approved', 'model_risk_approved', 'release_approved'], writes: ['rejection_reason'], config: {} },
    ],
    edges: [
      { id: 'e_start_normalize', source: 'start', target: 'normalize_asset', on: 'success' },
      { id: 'e_normalize_prepare', source: 'normalize_asset', target: 'prepare_partitions', on: 'success' },
      { id: 'e_prepare_process', source: 'prepare_partitions', target: 'process_partitions', on: 'success' },
      { id: 'e_process_quality', source: 'process_partitions', target: 'quality_gate', on: 'success' },
      { id: 'e_quality_lineage', source: 'quality_gate', target: 'capture_lineage', on: 'success' },
      { id: 'e_quality_escalate', source: 'quality_gate', target: 'quality_failure', on: 'failure' },
      { id: 'e_failure_record', source: 'quality_failure', target: 'record_quality_failure', on: 'success' },
      { id: 'e_lineage_owner', source: 'capture_lineage', target: 'data_owner_approval', on: 'success' },
      { id: 'e_owner_route', source: 'data_owner_approval', target: 'owner_route', on: 'success' },
      { id: 'e_owner_approved', source: 'owner_route', target: 'asset_kind_route', on: 'success', condition: { field: 'data_owner_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_owner_reject', source: 'owner_route', target: 'record_rejection', on: 'success', condition: { field: 'data_owner_approved', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_kind_model', source: 'asset_kind_route', target: 'model_risk_approval', on: 'success', condition: { field: 'asset_kind', operator: 'equals', value: 'model' }, label: 'Model' },
      { id: 'e_kind_dataset', source: 'asset_kind_route', target: 'prepare_release', on: 'success', condition: { field: 'asset_kind', operator: 'not_equals', value: 'model' }, label: 'Data asset' },
      { id: 'e_model_route', source: 'model_risk_approval', target: 'model_route', on: 'success' },
      { id: 'e_model_release', source: 'model_route', target: 'prepare_release', on: 'success', condition: { field: 'model_risk_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_model_reject', source: 'model_route', target: 'record_rejection', on: 'success', condition: { field: 'model_risk_approved', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_prepare_approval', source: 'prepare_release', target: 'release_approval', on: 'success' },
      { id: 'e_approval_route', source: 'release_approval', target: 'release_route', on: 'success' },
      { id: 'e_release_publish', source: 'release_route', target: 'publish_asset', on: 'success', condition: { field: 'release_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_release_reject', source: 'release_route', target: 'record_rejection', on: 'success', condition: { field: 'release_approved', operator: 'equals', value: false }, label: 'Rejected' },
    ],
    budget: { maxSteps: 96, maxDurationMs: 180_000, maxConcurrency: 8 },
  };
}

function processPartitionGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'data_mlops.process_partition', version: 1, name: 'Process and validate partition',
    description: 'Reusable child graph for a bounded release or backfill partition.',
    state: { fields: {
      partition: field('string', true, 'Partition key.'), source_uri: field('string', true, 'Source locator.'),
      schema_contract: field('object', true, 'Schema contract.'), quality_thresholds: field('object', true, 'Quality thresholds.'),
      processing_mode: field('string', true, 'Release or backfill mode.'), result: field('object', false, 'Partition result.'),
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Partition input', description: 'Accept one bounded partition.', reads: ['partition', 'source_uri', 'schema_contract', 'quality_thresholds', 'processing_mode'], writes: [], config: {} },
      { id: 'process', kind: 'function', label: 'Process partition', description: 'Produce deterministic reference quality evidence.', handler: 'data_mlops.process_partition', reads: ['partition', 'source_uri', 'schema_contract', 'quality_thresholds', 'processing_mode'], writes: ['result'], config: { roleId: 'data_engineer' } },
    ],
    edges: [{ id: 'e_start_process', source: 'start', target: 'process', on: 'success' }],
    budget: { maxSteps: 8, maxDurationMs: 30_000, maxConcurrency: 1 },
  };
}

function controlledBackfillGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'data_mlops.controlled_backfill', version: 1, name: 'Controlled partition backfill',
    description: 'Approve reprocessing behavior and bounded concurrency before executing historical partitions.',
    trigger: {
      type: 'webhook', method: 'POST', path: '/data-mlops/backfill',
      inputSchema: {
        type: 'object', properties: {
          asset_id: { type: 'string' }, asset_version: { type: 'string' }, source_uri: { type: 'string' }, partitions: { type: 'array', items: { type: 'string' } },
          schema_contract: { type: 'object' }, quality_thresholds: { type: 'object' },
          reprocess_behavior: { type: 'string', enum: ['none', 'failed', 'completed'] }, max_active_runs: { type: 'number' }, dry_run: { type: 'boolean' },
        },
        required: ['asset_id', 'asset_version', 'source_uri', 'partitions', 'schema_contract', 'quality_thresholds', 'reprocess_behavior', 'max_active_runs', 'dry_run'],
        additionalProperties: false,
      },
    },
    state: { fields: {
      asset_id: field('string', true, 'Asset identifier.'), asset_version: field('string', true, 'Asset version.'), source_uri: field('string', true, 'Source locator.'),
      partitions: field('array', true, 'Requested partitions.'), schema_contract: field('object', true, 'Schema contract.'),
      quality_thresholds: field('object', true, 'Quality thresholds.'), reprocess_behavior: field('string', true, 'Reprocessing behavior.'),
      max_active_runs: field('number', true, 'Maximum external active runs.'), dry_run: field('boolean', true, 'Dry-run flag.'),
      processing_mode: field('string', false, 'Backfill mode.'), processing_partitions: field('array', false, 'Bounded partitions.'),
      backfill_plan: field('object', false, 'Approved backfill plan.'), backfill_approved: field('boolean', false, 'Operator decision.'),
      partition_results: field('array', false, 'Backfill results.'), backfill_record: field('string', false, 'Backfill record.'),
      rejection_reason: field('string', false, 'Rejection reason.'),
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Backfill request', description: 'Accept a schema-validated bounded request.', reads: ['asset_id', 'source_uri', 'partitions', 'schema_contract', 'quality_thresholds', 'reprocess_behavior', 'max_active_runs', 'dry_run'], writes: [], config: {} },
      { id: 'plan_backfill', kind: 'function', label: 'Plan backfill', description: 'Make partition range, behavior and concurrency explicit.', handler: 'data_mlops.plan_backfill', reads: ['asset_id', 'partitions', 'reprocess_behavior', 'max_active_runs', 'dry_run'], writes: ['processing_mode', 'processing_partitions', 'backfill_plan'], config: {} },
      { id: 'backfill_approval', kind: 'human', label: 'Approve backfill', description: 'Authorize bounded reprocessing before external execution.', reads: ['backfill_plan', 'schema_contract', 'quality_thresholds'], writes: ['backfill_approved'], config: { decisionField: 'backfill_approved', roleId: 'platform_operator', evaluationId: 'backfill_approval' } },
      { id: 'approval_route', kind: 'router', label: 'Route decision', description: 'Execute only approved backfills.', reads: ['backfill_approved'], writes: [], config: {} },
      { id: 'process_partitions', kind: 'map', label: 'Reprocess partitions', description: 'Execute the approved bounded window.', reads: ['processing_partitions', 'source_uri', 'schema_contract', 'quality_thresholds', 'processing_mode'], writes: ['partition_results'], config: { graphId: 'data_mlops.process_partition', itemsField: 'processing_partitions', itemField: 'partition', resultField: 'result', outputField: 'partition_results', inputMapping: { source_uri: 'source_uri', schema_contract: 'schema_contract', quality_thresholds: 'quality_thresholds', processing_mode: 'processing_mode' }, maxItems: 1_000, maxConcurrency: 8 } },
      { id: 'publish_backfill', kind: 'function', label: 'Publish backfill record', description: 'Preserve policy, partition and evidence results.', handler: 'data_mlops.publish_backfill', reads: ['asset_id', 'backfill_plan', 'partition_results', 'backfill_approved'], writes: ['backfill_record'], config: { roleId: 'platform_operator', toolIds: ['backfill_create'] } },
      { id: 'record_rejection', kind: 'function', label: 'Record rejection', description: 'Preserve rejected backfill policy.', handler: 'data_mlops.record_backfill_rejection', reads: ['backfill_approved'], writes: ['rejection_reason'], config: {} },
    ],
    edges: [
      { id: 'e_start_plan', source: 'start', target: 'plan_backfill', on: 'success' },
      { id: 'e_plan_approval', source: 'plan_backfill', target: 'backfill_approval', on: 'success' },
      { id: 'e_approval_route', source: 'backfill_approval', target: 'approval_route', on: 'success' },
      { id: 'e_route_process', source: 'approval_route', target: 'process_partitions', on: 'success', condition: { field: 'backfill_approved', operator: 'equals', value: true }, label: 'Approved' },
      { id: 'e_route_reject', source: 'approval_route', target: 'record_rejection', on: 'success', condition: { field: 'backfill_approved', operator: 'equals', value: false }, label: 'Rejected' },
      { id: 'e_process_publish', source: 'process_partitions', target: 'publish_backfill', on: 'success' },
    ],
    budget: { maxSteps: 64, maxDurationMs: 180_000, maxConcurrency: 8 },
  };
}

function monitorAssetGraph(): IndustryPackManifest['graphs'][number] {
  return {
    id: 'data_mlops.monitor_asset', version: 1, name: 'Post-release asset monitoring',
    description: 'Accept typed quality signals, publish health or visibly escalate and restore a safe registry state.',
    trigger: {
      type: 'event', eventType: 'data.asset_quality_observed', correlationField: 'asset_id',
      inputSchema: {
        type: 'object', properties: {
          asset_version: { type: 'string' }, registry_entry_id: { type: 'string' }, registry: { type: 'string' }, alias: { type: 'string' },
          asset_kind: { type: 'string' }, quality_signals: { type: 'array', items: { type: 'object' } },
        }, required: ['asset_version', 'registry_entry_id', 'registry', 'alias', 'asset_kind', 'quality_signals'], additionalProperties: false,
      },
    },
    state: { fields: {
      asset_id: field('string', true, 'Asset identifier.'), asset_version: field('string', true, 'Observed asset version.'),
      registry_entry_id: field('string', true, 'Registry entry.'), registry: field('string', true, 'Registry locator.'), alias: field('string', true, 'Observed alias.'),
      asset_kind: field('string', true, 'Asset kind.'), quality_signals: field('array', true, 'Monitoring signals.'),
      asset_healthy: field('boolean', false, 'Health result.'), incident_summary: field('object', false, 'Incident summary.'),
      rollback_completed: field('boolean', false, 'Rollback or quarantine result.'), rollback_reference: field('string', false, 'Recovery evidence.'),
      monitoring_record: field('string', false, 'Monitoring record.'),
    } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Quality observed', description: 'Accept correlated quality signals.', reads: ['asset_id', 'registry_entry_id', 'asset_kind', 'quality_signals'], writes: [], config: {} },
      { id: 'assess_health', kind: 'function', label: 'Assess asset health', description: 'Evaluate post-publication quality signals.', handler: 'data_mlops.assess_quality_incident', reads: ['asset_id', 'registry_entry_id', 'quality_signals'], writes: ['asset_healthy', 'incident_summary'], config: { evaluationId: 'monitoring_health' } },
      { id: 'health_route', kind: 'router', label: 'Route health', description: 'Separate healthy observations from recovery.', reads: ['asset_healthy'], writes: [], config: {} },
      { id: 'publish_healthy', kind: 'function', label: 'Publish healthy record', description: 'Preserve healthy monitoring evidence.', handler: 'data_mlops.publish_healthy_monitoring', reads: ['asset_id', 'registry_entry_id', 'quality_signals', 'incident_summary'], writes: ['monitoring_record'], config: {} },
      { id: 'escalate_incident', kind: 'escalation', label: 'Escalate quality incident', description: 'Raise accountable platform response.', reads: ['asset_id', 'registry_entry_id', 'incident_summary'], writes: [], config: { reason: 'Published asset quality degraded; quarantine or registry rollback is required.', severity: 'critical', roleId: 'platform_operator' } },
      { id: 'rollback_registry', kind: 'compensation', label: 'Rollback registry state', description: 'Restore the previous alias or quarantine the dataset version.', handler: 'data_mlops.rollback_registry', reads: ['asset_id', 'registry_entry_id', 'asset_kind'], writes: ['rollback_completed', 'rollback_reference'], config: { compensates: ['assess_health'] } },
      { id: 'recovery_join', kind: 'join', label: 'Join recovery', description: 'Wait for escalation and recovery evidence.', reads: ['rollback_completed', 'rollback_reference'], writes: [], config: { mode: 'all' } },
      { id: 'publish_incident', kind: 'function', label: 'Publish incident record', description: 'Record degraded quality and recovery outcome.', handler: 'data_mlops.publish_quality_incident', reads: ['asset_id', 'registry_entry_id', 'quality_signals', 'incident_summary', 'rollback_completed', 'rollback_reference'], writes: ['monitoring_record'], config: {} },
    ],
    edges: [
      { id: 'e_start_assess', source: 'start', target: 'assess_health', on: 'success' },
      { id: 'e_assess_route', source: 'assess_health', target: 'health_route', on: 'success' },
      { id: 'e_route_healthy', source: 'health_route', target: 'publish_healthy', on: 'success', condition: { field: 'asset_healthy', operator: 'equals', value: true }, label: 'Healthy' },
      { id: 'e_route_escalate', source: 'health_route', target: 'escalate_incident', on: 'success', condition: { field: 'asset_healthy', operator: 'equals', value: false }, label: 'Degraded' },
      { id: 'e_route_rollback', source: 'health_route', target: 'rollback_registry', on: 'success', condition: { field: 'asset_healthy', operator: 'equals', value: false }, label: 'Degraded' },
      { id: 'e_escalate_join', source: 'escalate_incident', target: 'recovery_join', on: 'success' },
      { id: 'e_rollback_join', source: 'rollback_registry', target: 'recovery_join', on: 'success' },
      { id: 'e_join_publish', source: 'recovery_join', target: 'publish_incident', on: 'success' },
    ],
    budget: { maxSteps: 24, maxDurationMs: 60_000, maxConcurrency: 2 },
  };
}

function releaseStateFields(): IndustryPackManifest['graphs'][number]['state']['fields'] {
  return {
    asset_id: field('string', true, 'Asset identifier.'), asset_name: field('string', true, 'Asset name.'),
    asset_kind: field('string', true, 'Dataset, feature set or model.'), asset_version: field('string', true, 'Asset version.'),
    owner: field('string', true, 'Accountable owner.'), source_uri: field('string', true, 'Materialized source.'),
    target_registry: field('string', true, 'Publication registry.'), partitions: field('array', true, 'Materialized partitions.'),
    schema_contract: field('object', true, 'Schema compatibility contract.'), quality_thresholds: field('object', true, 'Quality thresholds.'),
    lineage_inputs: field('array', true, 'Upstream assets.'), transformation_ref: field('string', true, 'Transformation identity.'),
    model_metrics: field('object', true, 'Model metrics or empty object for data assets.'), asset_definition: field('object', false, 'Normalized asset.'),
    processing_mode: field('string', false, 'Release processing mode.'), processing_partitions: field('array', false, 'Bounded partitions.'),
    partition_results: field('array', false, 'Partition evidence.'), quality_summary: field('object', false, 'Aggregate quality result.'),
    lineage_record: field('object', false, 'Source and transformation lineage.'), data_owner_approved: field('boolean', false, 'Owner decision.'),
    model_risk_approved: field('boolean', false, 'Model-risk decision.'), registry_release: field('object', false, 'Proposed registry release.'),
    release_approved: field('boolean', false, 'Release-steward decision.'), registry_entry: field('object', false, 'Published registry entry.'),
    asset_release_record: field('string', false, 'Asset release record.'), rejection_reason: field('string', false, 'Rejection reason.'),
  };
}

function releaseInput(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, schema_contract: schemaContract(), quality_thresholds: qualityThresholds() };
}

function schemaContract() {
  return { contract_id: 'contract.customer-domain', version: '3', compatibility: 'backward' };
}

function qualityThresholds() {
  return { minimum_completeness: 0.99, maximum_freshness_minutes: 60 };
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
