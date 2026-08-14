# Industry Pack Gallery

Every standard Industry Pack runs in the same Graph Workbench editor, runtime,
approval inbox, artifact console and context explorer. Start the public Workbench,
open **Packs**, choose a Pack and select **Install Pack**:

```bash
npx graph-workbench
```

The bundled adapters are deterministic **reference runtime** implementations.
They make every graph, human gate, rejection path, artifact and context projection
executable without credentials. They do not claim to be live connections to
GitHub, CI/CD, a SIEM, a registry, an EHR, a broker or robot middleware. Production
teams replace those adapters while preserving the Pack's roles, contracts and
governance path.

The source commands below run the named zero-key fixture after cloning this
repository and installing dependencies. The images are captured from the real
workflow definitions after **Fit View**, not redrawn concept diagrams.

## Professional Software Delivery

![Professional Software Delivery workflow](assets/pack-graphs/software-delivery.png)

- **For:** engineering, platform and release teams governing a change across
  source control, verification and deployment boundaries.
- **Entry:** an accepted work item with testable criteria, repository, target
  environment and immutable artifact digest.
- **Human gates:** independent code-owner review and release-manager approval.
- **Deliverable:** release readiness record or deployment observation record.
- **Context:** Work item, Change set, Change request, Verification, Review decision,
  Build provenance, Release, Deployment and Delivery incident.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/software-delivery/src/index.ts --fixture standard_feature_release
  ```

The primary path performs parallel unit, integration, security and supply-chain
verification. A separate deployment-observation graph either records health or
visibly escalates and rolls back an unhealthy release. When both run in the same
workspace, the observation graph queries the prior approved Release object,
records its ID, version and source run, and links the new Deployment back to it.

## Data and MLOps Asset Release

![Data and MLOps Asset Release workflow](assets/pack-graphs/data-mlops-asset-release.png)

- **For:** data product, platform, MLOps and model-risk teams releasing governed
  datasets and model assets.
- **Entry:** a dataset or model candidate with partitions, schema, lineage and
  quality expectations.
- **Human gates:** data-owner approval, model-risk approval when applicable,
  registry approval and explicit backfill approval.
- **Deliverable:** asset release, controlled backfill or monitoring record.
- **Context:** Data asset, Asset version, Partition, Schema contract, Quality
  evaluation, Lineage source, Governance decision, Registry release and incident.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/data-mlops/src/index.ts --fixture daily_customer_dataset
  ```

The Pack maps partitions with bounded concurrency, preserves lineage and quality
evidence, and exposes backfill, escalation and post-release recovery paths.

## Cybersecurity Incident Response

![Cybersecurity Incident Response workflow](assets/pack-graphs/cybersecurity-incident-response.png)

- **For:** security operations, incident commanders, containment owners and
  recovery teams.
- **Entry:** a security signal with affected asset, identity, indicators and
  attributable evidence.
- **Human gates:** incident declaration, containment authorization and recovery
  approval.
- **Deliverable:** incident response record or recovery observation record.
- **Context:** Signal, Indicator, Asset, Identity, Evidence, Incident, Severity,
  Response action, Security decision, Recovery observation and lessons learned.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/cybersecurity-response/src/index.ts --fixture privileged_credential_compromise
  ```

Evidence preservation runs concurrently before accountable containment. Failure
paths retain escalation, compensation and the decisions that stopped or changed
the response.

## Quantitative Finance Governance

![Quantitative Finance Governance workflow](assets/pack-graphs/quantitative-finance-governance.png)

- **For:** quantitative researchers, independent risk and compliance reviewers,
  and execution teams.
- **Entry:** a falsifiable strategy hypothesis, research universe, backtest
  evidence and declared risk limits.
- **Human gates:** independent risk approval, compliance approval and execution
  authorization.
- **Deliverable:** strategy execution governance or fill reconciliation record.
- **Context:** Mandate, Hypothesis, Backtest evidence, Portfolio proposal, Risk
  assessment, Approval, Order intent, Execution, Fill, Reconciliation and exception.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/quantitative-finance/src/index.ts --fixture market_neutral_research
  ```

Market data, backtesting, OMS/EMS, routing and books-and-records remain external
authorities; the Pack governs the evidence and decisions crossing those systems.

## Healthcare Diagnostic Coordination

![Healthcare Diagnostic Coordination workflow](assets/pack-graphs/healthcare-diagnostic-coordination.png)

- **For:** non-clinical workflow designers, authorized practitioners, diagnostic
  specialists and healthcare integration teams.
- **Entry:** a FHIR-shaped service request with consent, study or specimen evidence
  and identity-scoped access requirements.
- **Human gates:** authorized clinical access and accountable specialist
  interpretation.
- **Deliverable:** diagnostic coordination or follow-up record.
- **Context:** ServiceRequest, Consent, Study or specimen, Observation, Practitioner
  decision, DiagnosticReport, Follow-up plan and Clinical review.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/healthcare-diagnostics/src/index.ts --fixture routine_imaging_review
  ```

This is a non-clinical reference Pack. Identity, EHR/FHIR, PACS/LIS, scheduling
and all clinical decision authority remain outside Graph Workbench.

## Robotics and Fleet Operations

![Robotics and Fleet Operations workflow](assets/pack-graphs/robotics-fleet-dispatch.png)

- **For:** fleet operators, planners, resource managers, safety supervisors and
  maintenance coordinators.
- **Entry:** an event-correlated fleet task with candidate robots, shared-resource
  requirements and safety constraints.
- **Human gate:** safety-supervisor approval before external dispatch.
- **Deliverable:** fleet dispatch or mission observation record.
- **Context:** Fleet task, Robot, Bid, Mission plan, Resource reservation, Safety
  decision, Dispatch, Telemetry, Replan and Maintenance action.
- **Run:**

  ```bash
  pnpm graph-workbench pack demo packs/robotics-fleet/src/index.ts --fixture hospital_delivery_dispatch
  ```

Robot bidding runs concurrently. Degraded telemetry follows a bounded replan,
visible escalation and maintenance path while ROS 2/OpenRMF and device safety
controllers remain external authorities.

Architecture Concept Design, Customer Success Renewal and Cross-industry Research
remain bundled as additional authoring examples. The signed Reference Registry
publishes the six standard Packs above.
