import { createHash } from 'node:crypto';
import type { HandlerRegistry } from '@graph-workbench/core';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
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

interface PartitionResult {
  partition_key: string;
  status: string;
  digest: string;
  row_count: number;
  completeness: number;
  freshness_minutes: number;
  evidence_uri: string;
}

function partitionResults(value: unknown): PartitionResult[] {
  return items(value);
}

export const dataMlopsHandlers: HandlerRegistry = {
  'data_mlops.normalize_asset': ({ state }) => ({
    asset_definition: {
      asset_id: text(state.asset_id),
      name: text(state.asset_name),
      kind: text(state.asset_kind),
      version: text(state.asset_version),
      owner: text(state.owner),
      source_uri: text(state.source_uri),
      target_registry: text(state.target_registry),
    },
    processing_mode: 'release',
  }),

  'data_mlops.prepare_partitions': ({ state }) => {
    const partitions = items<string>(state.partitions);
    if (partitions.length === 0) throw new Error('Asset release requires at least one partition.');
    return { processing_partitions: partitions };
  },

  'data_mlops.process_partition': ({ state }) => {
    const partitionKey = text(state.partition);
    const mode = text(state.processing_mode);
    return {
      result: {
        partition_key: partitionKey,
        status: 'passed',
        digest: `sha256:${createHash('sha256').update(partitionKey).digest('hex')}`,
        row_count: Math.max(1_000, partitionKey.length * 10_000),
        completeness: 1,
        freshness_minutes: mode === 'backfill' ? 0 : 5,
        evidence_uri: `reference://data-quality/${encodeURIComponent(partitionKey)}/${mode}`,
      },
    };
  },

  'data_mlops.aggregate_quality': ({ state }) => {
    const results = partitionResults(state.partition_results);
    const thresholds = object(state.quality_thresholds);
    const contract = object(state.schema_contract);
    if (!text(contract.contract_id) || !text(contract.version) || !text(contract.compatibility)) {
      throw new Error('Asset quality gate requires an identified schema contract and compatibility policy.');
    }
    const minimumCompleteness = number(thresholds.minimum_completeness);
    const maximumFreshnessMinutes = number(thresholds.maximum_freshness_minutes);
    const failed = results.filter((result) => result.status !== 'passed'
      || result.completeness < minimumCompleteness
      || result.freshness_minutes > maximumFreshnessMinutes);
    if (results.length === 0 || failed.length > 0) {
      throw new Error(`Asset quality gate failed for ${Math.max(failed.length, 1)} partition(s).`);
    }
    return {
      quality_summary: {
        status: 'passed',
        partition_count: results.length,
        total_rows: results.reduce((sum, result) => sum + result.row_count, 0),
        minimum_completeness: Math.min(...results.map((result) => result.completeness)),
        maximum_freshness_minutes: Math.max(...results.map((result) => result.freshness_minutes)),
        evidence_uris: results.map((result) => result.evidence_uri),
      },
    };
  },

  'data_mlops.capture_lineage': ({ state }) => ({
    lineage_record: {
      asset_id: text(state.asset_id),
      asset_version: text(state.asset_version),
      inputs: items(state.lineage_inputs),
      transformation: text(state.transformation_ref),
      source_uri: text(state.source_uri),
    },
  }),

  'data_mlops.prepare_registry_release': ({ state }) => {
    const kind = text(state.asset_kind);
    const modelMetrics = object(state.model_metrics);
    if (kind === 'model' && Object.keys(modelMetrics).length === 0) {
      throw new Error('Model release requires declared evaluation metrics.');
    }
    return {
      registry_release: {
        asset_id: text(state.asset_id),
        name: text(state.asset_name),
        kind,
        version: text(state.asset_version),
        registry: text(state.target_registry),
        alias: kind === 'model' ? 'champion-candidate' : 'current-candidate',
        quality_status: text(object(state.quality_summary).status),
        model_metrics: modelMetrics,
        status: 'proposed',
      },
    };
  },

  'data_mlops.publish_asset': ({ state }) => {
    const release = object(state.registry_release);
    const quality = object(state.quality_summary);
    return {
      registry_entry: {
        ...release,
        status: 'published',
      },
      asset_release_record: [
        `# Data asset release — ${text(state.asset_name)} ${text(state.asset_version)}`,
        '',
        `**Asset ID:** ${text(state.asset_id)}`,
        `**Kind:** ${text(state.asset_kind)}`,
        `**Owner:** ${text(state.owner)}`,
        `**Registry:** ${text(state.target_registry)}`,
        `**Alias:** ${text(release.alias)}`,
        '',
        '## Quality evidence',
        `- Partitions: ${String(quality.partition_count ?? 0)}`,
        `- Rows: ${String(quality.total_rows ?? 0)}`,
        `- Minimum completeness: ${String(quality.minimum_completeness ?? 0)}`,
        `- Maximum freshness: ${String(quality.maximum_freshness_minutes ?? 0)} minutes`,
        '',
        '## Governance',
        '- Data-product owner approval: approved',
        ...(text(state.asset_kind) === 'model' ? ['- Model-risk approval: approved'] : []),
        '- Release-steward approval: approved',
        '- Runtime execution remains in the external orchestrator or model platform.',
      ].join('\n'),
    };
  },

  'data_mlops.record_release_rejection': ({ state }) => ({
    rejection_reason: state.data_owner_approved === false
      ? 'Data-product owner rejected the asset evidence.'
      : state.model_risk_approved === false
        ? 'Model-risk reviewer rejected the model candidate.'
        : 'Release steward rejected registry publication.',
  }),

  'data_mlops.record_backfill_rejection': () => ({
    rejection_reason: 'Platform operator rejected the bounded backfill plan.',
  }),

  'data_mlops.record_quality_failure': ({ state }) => ({
    rejection_reason: `Blocking data-quality checks failed for ${text(state.asset_id)}.`,
  }),

  'data_mlops.plan_backfill': ({ state }) => {
    const partitions = items<string>(state.partitions);
    if (partitions.length === 0) throw new Error('Backfill requires at least one partition.');
    return {
      processing_mode: 'backfill',
      processing_partitions: partitions,
      backfill_plan: {
        asset_id: text(state.asset_id),
        partitions,
        reprocess_behavior: text(state.reprocess_behavior),
        max_active_runs: number(state.max_active_runs),
        dry_run: state.dry_run === true,
      },
    };
  },

  'data_mlops.publish_backfill': ({ state }) => {
    const plan = object(state.backfill_plan);
    const results = partitionResults(state.partition_results);
    return {
      backfill_record: [
        `# Controlled backfill — ${text(state.asset_id)}`,
        '',
        `Reprocess behavior: ${text(plan.reprocess_behavior)}`,
        `Max active runs: ${String(plan.max_active_runs ?? 0)}`,
        `Dry run: ${String(plan.dry_run === true)}`,
        `Partitions completed: ${results.length}`,
        ...results.map((result) => `- ${result.partition_key}: ${result.status} — ${result.evidence_uri}`),
      ].join('\n'),
    };
  },

  'data_mlops.assess_quality_incident': ({ state }) => {
    const signals = items<{ name: string; status: string; value?: unknown }>(state.quality_signals);
    const healthy = signals.length > 0 && signals.every((signal) => ['healthy', 'ok', 'passed'].includes(signal.status));
    return {
      asset_healthy: healthy,
      incident_summary: {
        asset_id: text(state.asset_id),
        registry_entry_id: text(state.registry_entry_id),
        signal_count: signals.length,
        healthy,
      },
    };
  },

  'data_mlops.rollback_registry': ({ state }) => ({
    rollback_completed: true,
    rollback_reference: `reference://registry-rollback/${encodeURIComponent(text(state.registry_entry_id))}`,
  }),

  'data_mlops.publish_healthy_monitoring': ({ state }) => ({
    monitoring_record: [
      `# Asset monitoring — ${text(state.asset_id)}`,
      '',
      `Registry entry: ${text(state.registry_entry_id)}`,
      'Outcome: healthy',
      `Signals: ${items(state.quality_signals).length}`,
    ].join('\n'),
  }),

  'data_mlops.publish_quality_incident': ({ state }) => ({
    monitoring_record: [
      `# Data quality incident — ${text(state.asset_id)}`,
      '',
      `Registry entry: ${text(state.registry_entry_id)}`,
      'Outcome: degraded',
      `Rollback or quarantine: ${state.rollback_completed === true ? 'completed' : 'not completed'}`,
      `Evidence: ${text(state.rollback_reference)}`,
    ].join('\n'),
  }),
};
