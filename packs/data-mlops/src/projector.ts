import type { ContextObject, ContextRelation } from '@graph-workbench/contracts';
import type { ContextGraphStore, GraphState } from '@graph-workbench/core';

interface CompletedDataMlopsRun {
  readonly runId: string;
  readonly state: GraphState;
}

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

export async function projectDataMlopsRun(
  store: ContextGraphStore,
  run: CompletedDataMlopsRun,
): Promise<void> {
  if (typeof run.state.asset_release_record === 'string' && run.state.release_approved === true) {
    await projectAssetRelease(store, run);
    return;
  }
  if (typeof run.state.backfill_record === 'string' && run.state.backfill_approved === true) {
    await projectBackfill(store, run);
    return;
  }
  if (typeof run.state.monitoring_record === 'string' && typeof run.state.asset_healthy === 'boolean') {
    await projectMonitoring(store, run);
    return;
  }
  throw new Error('Data/MLOps context requires a published asset, approved backfill or completed monitoring observation.');
}

async function projectAssetRelease(store: ContextGraphStore, run: CompletedDataMlopsRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const version = object(run.state.registry_entry);
  const quality = object(run.state.quality_summary);
  const lineage = object(run.state.lineage_record);
  const schema = object(run.state.schema_contract);
  const partitions = items<Record<string, unknown>>(run.state.partition_results);
  const lineageInputs = items<string>(lineage.inputs);
  const ids = {
    asset: `${base}.asset`, version: `${base}.version`, schema: `${base}.schema`, quality: `${base}.quality`,
    ownerDecision: `${base}.decision.owner`, modelDecision: `${base}.decision.model-risk`,
    releaseDecision: `${base}.decision.registry`, release: `${base}.registry-release`, record: `${base}.record`,
  };
  const provenance = makeProvenance(run.runId, recordedAt);
  const objects: ContextObject[] = [
    contextObject(ids.asset, 'data_asset', {
      asset_id: text(run.state.asset_id), name: text(run.state.asset_name), kind: text(run.state.asset_kind), owner: text(run.state.owner),
    }, recordedAt, provenance('normalize_asset', 'role.data_product_owner')),
    contextObject(ids.version, 'asset_version', {
      asset_id: text(run.state.asset_id), version: text(run.state.asset_version), source_uri: text(run.state.source_uri), status: 'published',
    }, recordedAt, provenance('publish_asset', 'role.release_steward')),
    ...partitions.map((partition, index) => contextObject(`${base}.partition.${index + 1}`, 'data_partition', {
      partition_key: text(partition.partition_key), digest: text(partition.digest), row_count: numeric(partition.row_count), status: text(partition.status),
    }, recordedAt, provenance('process_partitions', 'role.data_engineer'))),
    contextObject(ids.schema, 'schema_contract', {
      contract_id: text(schema.contract_id), version: text(schema.version), compatibility: text(schema.compatibility),
    }, recordedAt, provenance('quality_gate', 'role.quality_reviewer')),
    contextObject(ids.quality, 'quality_evaluation', {
      status: text(quality.status), partition_count: numeric(quality.partition_count),
      minimum_completeness: numeric(quality.minimum_completeness), maximum_freshness_minutes: numeric(quality.maximum_freshness_minutes),
    }, recordedAt, provenance('quality_gate', 'role.quality_reviewer')),
    ...lineageInputs.map((uri, index) => contextObject(`${base}.lineage.input.${index + 1}`, 'lineage_source', {
      uri, role: 'input',
    }, recordedAt, provenance('capture_lineage'))),
    contextObject(`${base}.lineage.transformation`, 'lineage_source', {
      uri: text(lineage.transformation), role: 'transformation',
    }, recordedAt, provenance('capture_lineage')),
    contextObject(ids.ownerDecision, 'governance_decision', { gate: 'data_owner', approved: true }, recordedAt, provenance('data_owner_approval', 'role.data_product_owner')),
    ...(text(run.state.asset_kind) === 'model' ? [
      contextObject(ids.modelDecision, 'governance_decision', { gate: 'model_risk', approved: true }, recordedAt, provenance('model_risk_approval', 'role.model_risk_reviewer')),
    ] : []),
    contextObject(ids.releaseDecision, 'governance_decision', { gate: 'registry_release', approved: true }, recordedAt, provenance('release_approval', 'role.release_steward')),
    contextObject(ids.release, 'registry_release', {
      asset_id: text(run.state.asset_id), version: text(run.state.asset_version), registry: text(version.registry), alias: text(version.alias), status: text(version.status),
    }, recordedAt, provenance('publish_asset', 'role.release_steward')),
    contextObject(ids.record, 'data_delivery_record', { record_type: 'asset_release', content: run.state.asset_release_record }, recordedAt, provenance('publish_asset')),
  ];
  await appendObjects(store, objects);

  const relations: ContextRelation[] = [
    relation(`${base}.relation.asset.version`, 'has_version', ids.asset, ids.version, recordedAt, provenance('publish_asset')),
    ...partitions.map((_, index) => relation(`${base}.relation.partition.${index + 1}.version`, 'partition_of', `${base}.partition.${index + 1}`, ids.version, recordedAt, provenance('process_partitions'))),
    relation(`${base}.relation.version.schema`, 'conforms_to', ids.version, ids.schema, recordedAt, provenance('quality_gate')),
    relation(`${base}.relation.quality.version`, 'validates_asset', ids.quality, ids.version, recordedAt, provenance('quality_gate')),
    ...lineageInputs.map((_, index) => relation(`${base}.relation.version.lineage.${index + 1}`, 'derived_from', ids.version, `${base}.lineage.input.${index + 1}`, recordedAt, provenance('capture_lineage'))),
    relation(`${base}.relation.version.transformation`, 'derived_from', ids.version, `${base}.lineage.transformation`, recordedAt, provenance('capture_lineage')),
    relation(`${base}.relation.owner.release`, 'governs_release', ids.ownerDecision, ids.release, recordedAt, provenance('data_owner_approval')),
    ...(text(run.state.asset_kind) === 'model' ? [
      relation(`${base}.relation.model-risk.release`, 'governs_release', ids.modelDecision, ids.release, recordedAt, provenance('model_risk_approval')),
    ] : []),
    relation(`${base}.relation.registry-decision.release`, 'governs_release', ids.releaseDecision, ids.release, recordedAt, provenance('release_approval')),
    relation(`${base}.relation.release.version`, 'publishes_version', ids.release, ids.version, recordedAt, provenance('publish_asset')),
    relation(`${base}.relation.record.release`, 'documents_data_work', ids.record, ids.release, recordedAt, provenance('publish_asset')),
  ];
  await appendRelations(store, relations);
}

async function projectBackfill(store: ContextGraphStore, run: CompletedDataMlopsRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const plan = object(run.state.backfill_plan);
  const ids = { version: `${base}.version-reference`, backfill: `${base}.backfill`, record: `${base}.record` };
  const provenance = makeProvenance(run.runId, recordedAt);
  await appendObjects(store, [
    contextObject(ids.version, 'asset_version', {
      asset_id: text(run.state.asset_id), version: text(run.state.asset_version), source_uri: text(run.state.source_uri), status: 'backfilled',
    }, recordedAt, provenance('plan_backfill')),
    contextObject(ids.backfill, 'backfill', {
      asset_id: text(run.state.asset_id), reprocess_behavior: text(plan.reprocess_behavior),
      partition_count: items(plan.partitions).length, dry_run: plan.dry_run === true,
    }, recordedAt, provenance('publish_backfill', 'role.platform_operator')),
    contextObject(ids.record, 'data_delivery_record', { record_type: 'backfill', content: run.state.backfill_record }, recordedAt, provenance('publish_backfill')),
  ]);
  await appendRelations(store, [
    relation(`${base}.relation.backfill.version`, 'reprocesses', ids.backfill, ids.version, recordedAt, provenance('publish_backfill')),
    relation(`${base}.relation.record.backfill`, 'documents_data_work', ids.record, ids.backfill, recordedAt, provenance('publish_backfill')),
  ]);
}

async function projectMonitoring(store: ContextGraphStore, run: CompletedDataMlopsRun): Promise<void> {
  const recordedAt = new Date().toISOString();
  const base = run.runId;
  const healthy = run.state.asset_healthy === true;
  const ids = { release: `${base}.registry-release-reference`, incident: `${base}.quality-incident`, record: `${base}.record` };
  const provenance = makeProvenance(run.runId, recordedAt);
  await appendObjects(store, [
    contextObject(ids.release, 'registry_release', {
      asset_id: text(run.state.asset_id), version: text(run.state.asset_version), registry: text(run.state.registry), alias: text(run.state.alias), status: healthy ? 'healthy' : 'recovered',
    }, recordedAt, provenance('assess_health')),
    ...(!healthy ? [contextObject(ids.incident, 'quality_incident', {
      asset_id: text(run.state.asset_id), registry_entry_id: text(run.state.registry_entry_id),
      signal_count: items(run.state.quality_signals).length, rollback_completed: run.state.rollback_completed === true,
    }, recordedAt, provenance('publish_incident', 'role.platform_operator'))] : []),
    contextObject(ids.record, 'data_delivery_record', {
      record_type: healthy ? 'monitoring_health' : 'quality_incident', content: run.state.monitoring_record,
    }, recordedAt, provenance(healthy ? 'publish_healthy' : 'publish_incident')),
  ]);
  await appendRelations(store, [
    ...(!healthy ? [
      relation(`${base}.relation.incident.release`, 'affects_release', ids.incident, ids.release, recordedAt, provenance('publish_incident')),
      relation(`${base}.relation.record.incident`, 'documents_data_work', ids.record, ids.incident, recordedAt, provenance('publish_incident')),
    ] : [
      relation(`${base}.relation.record.release`, 'documents_data_work', ids.record, ids.release, recordedAt, provenance('publish_healthy')),
    ]),
  ]);
}

function makeProvenance(runId: string, recordedAt: string) {
  return (nodeId: string, actorId = 'system.runtime') => ({
    sourceIds: [], producedByRunId: runId, producedByNodeId: nodeId, actorId, recordedAt,
  });
}

function contextObject(
  id: string,
  type: string,
  data: Record<string, unknown>,
  recordedAt: string,
  provenance: ContextObject['provenance'],
): ContextObject {
  return { id, type, version: 1, status: 'confirmed', data, validFrom: recordedAt, validTo: null, provenance };
}

function relation(
  id: string,
  type: string,
  sourceId: string,
  targetId: string,
  recordedAt: string,
  provenance: ContextRelation['provenance'],
): ContextRelation {
  return { id, type, sourceId, targetId, version: 1, attributes: {}, validFrom: recordedAt, validTo: null, provenance };
}

async function appendObjects(store: ContextGraphStore, objects: readonly ContextObject[]): Promise<void> {
  for (const value of objects) await store.appendObject(value);
}

async function appendRelations(store: ContextGraphStore, relations: readonly ContextRelation[]): Promise<void> {
  for (const value of relations) await store.appendRelation(value);
}
