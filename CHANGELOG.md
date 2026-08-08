# Changelog

All notable changes will be documented here. The project follows semantic
versioning once public packages begin publishing.

## Unreleased

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
