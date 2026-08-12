# Changelog

All notable changes will be documented here. The project follows semantic
versioning once public packages begin publishing.

## Unreleased

## 0.4.1 - 2026-08-12

### Fixed

- Corrected standalone Industry Pack scaffolds so generated instructions use
  the public `npx graph-workbench` CLI instead of repository-only pnpm commands.
- Added a directly runnable Pack command to generated READMEs and terminal
  guidance, including quoted paths for directories containing spaces.

### Documentation

- Added a zero-install Pack-authoring path to the English, Chinese and npm
  READMEs so users can move from the Workbench demo to their own executable
  Pack without cloning the repository or configuring a model key.

## 0.4.0 - 2026-08-12

### Added

- Added standard Quantitative Finance, Healthcare Diagnostic Coordination and
  Robotics/Fleet Operations Packs with zero-key success, rejection and recovery
  fixtures, typed tools and connected context projections.
- Added a Pack system map, semantic node treatments and stage-aware layout for
  reading multi-graph workflows, Agent nodes, human gates, routing, joins,
  bounded loops, Map fan-out, escalation and compensation directly on canvas.
- Added handler-coverage conformance checks so Pack validation rejects declared
  executable nodes that do not have a real implementation.

### Fixed

- Made join semantics explicit and executable for both `all` and `any` modes.
- Kept node movement synchronized throughout pointer drag while preserving the
  saved graph and undo history.
- Resolved each run's portable deliverable through the Industry Pack manifest,
  so Packs that publish to domain-specific state fields render their output.
- Bounded test-worker concurrency so Pack build and Registry integrity tests do
  not contend for enough CPU and filesystem capacity to trip false timeouts.

### Documentation

- Reframed the English, Chinese and npm READMEs around the execution-graph plus
  organizational-context-graph product loop, with current product screenshots.
- Replaced legacy Customer Success screenshots and added a real Robotics and
  Fleet Operations approval-to-artifact-to-context journey.

## 0.3.0 - 2026-08-10

### Changed

- Renamed the product, repository, npm package, CLI and internal package scope
  to Graph Workbench and `graph-workbench`.
- Renamed the default workspace directory to `.graph-workbench`, environment
  variables to `GRAPH_WORKBENCH_*` and new Pack descriptors to
  `graph-workbench.pack.json` with the `graph-workbench` engine key.
- Promoted all bundled reference Packs to version `0.3.0` so published
  artifacts remain immutable across the engine transition.

### Compatibility

- Copy an existing `.graphwork` workspace on first launch without deleting the
  source directory.
- Accept legacy `GRAPHWORK_*` environment variables and legacy Graphwork Pack
  descriptors while emitting only the new public identifiers.
- Move new installations to the `graph-workbench` npm package; the former
  `graphwork` package remains available only as a deprecated migration path.

## 0.2.2 - 2026-08-09

### Changed

- Unified the public product, repository, CLI and internal package namespace
  under the Graphwork name.
- Renamed Workbench environment variables from `GRAPH_WORKBENCH_*` to
  `GRAPHWORK_*` and removed the legacy `graph-native` CLI alias.

### Security

- Reject oversized Pack archives before decompression and bound streamed
  Registry and model-provider responses.
- Require authentication for non-loopback Workbench listeners, reject
  cross-origin state changes and enforce request media types.
- Prevent credentialed provider presets from sending secrets to overridden
  endpoints.
- Run installed third-party Packs in network-denied, read-only containers by
  default; unsafe process isolation now requires an explicit development flag.

## 0.2.1 - 2026-08-08

### Fixed

- Kept node positions synchronized with React Flow throughout pointer movement,
  making canvas dragging responsive while preserving save and undo history.
- Reduced canvas obstruction with a smaller desktop minimap and a hidden mobile
  minimap, and moved the mobile inspector handle clear of title controls.
- Kept completed historical run consoles collapsed after reload so the graph
  retains the primary workspace.

### Tests

- Added a browser regression covering continuous node movement, save and
  position persistence after reload.

## 0.2.0 - 2026-08-08

### Changed

- Promoted the release candidate to the first stable public-alpha npm release.
- Bundled Pack installation now opens the installed Pack immediately.
- Added a compact approval-to-context visual journey to the English and Chinese
  README files and aligned all public Pack descriptions.

### Fixed

- Pointed the default quickstart at the maintained `latest` npm release instead
  of leaving public-alpha users on the earlier `0.1.0` package.
- Kept mobile notifications above the bottom navigation.

## 0.2.0-rc.1 - 2026-08-08

### Added

- Dual execution/context graph contracts and Industry Pack manifest.
- Governed DAG runtime with parallel branches, joins, routing and human gates.
- In-memory and SQLite context graph adapters.
- Research reference Pack and zero-key demo.
- Pack SDK and `graphwork pack init / validate / inspect / run` commands.
- Runtime-neutral Agent and governed tool adapter contracts.
- Role/tool authorization, risk gates and tool-scoped secret injection.
- Durable SQLite run, event and checkpoint storage with CLI resume support.
- Bounded node retry and timeout policies with resumable run cancellation.
- Declared Pack deliverables, executable golden fixtures and `graphwork pack test/demo`.
- Architecture Concept Design Pack with two zero-key fixtures and a typed context projector.
- Responsive local Workbench for project input, execution inspection, human review,
  Chinese/English deliverables and provenance-chain exploration.
- Contract-native visual graph authoring with autosaved drafts, undo/redo and
  execution of the saved graph through the same compiler and runtime.
- Portable `.gpack` artifacts with compatibility metadata, permission review,
  SHA-256 integrity, side-by-side versions, activation and rollback.
- Workbench Pack management for bundled and explicitly trusted local artifacts.
- Ed25519-signed Pack Registry verification and HTTPS installation with
  out-of-band publisher trust keys, mandatory expiry and signed artifact metadata.
- Restricted child-process execution for installed third-party Pack handlers and
  context projectors, with environment, filesystem, memory and time boundaries.
- Zero-install `graphwork` npm distribution with the bundled Workbench, CLI,
  reference Packs and isolated Worker.
- Multi-provider Agent execution for OpenAI-compatible, Anthropic Messages and
  Gemini GenerateContent APIs, with Workbench configuration, normalized usage
  events and server-only credential handling.
- Provider-neutral model-directed tool loops that reuse Pack role permissions,
  risk authorization, secret isolation and ordered runtime tool events.
- Structured Pack engine compatibility reports shared by artifact inspection,
  signed Registry catalogs and installation errors.
- Automatic, backed-up Workbench workspace migration from format v1 to v2 with
  stable workspace identity and lifecycle timestamps.
- Ordered declarative tool policies with input-bound approval checkpoints that
  resume the original model exchange without duplicate provider calls.
- Portable SHA-256-verified run audit bundles from the Workbench and CLI.
- PostgreSQL run and context stores with schema initialization and the same
  validation contracts as local persistence.
- pg-boss-backed distributed run workers with version-bound requests,
  heartbeats, retries and checkpoint recovery.
- Docker/Podman Pack isolation with network-deny defaults and bounded container
  capabilities, resources and mounts.
- Cross-platform performance budgets and a Docker Compose reference deployment
  for the Workbench, PostgreSQL and distributed Workers.
- Playwright browser E2E, clean npm-install smoke and release-readiness metadata
  gates for the complete onboarding and approval journey.
- Customer Success Renewal Pack with two golden fixtures, an approval-gated
  success plan and evidence-linked context projection.
- Public extension-point guide, maintained good-first-issue scopes, a dual-graph
  architecture article and an end-to-end customer-success industry case.

### Changed

- Adopted the MIT License to minimize integration friction.
