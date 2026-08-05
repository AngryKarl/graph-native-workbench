# Roadmap

The roadmap follows the Product Charter: mechanisms enter the kernel; domain
meaning enters Industry Packs. Priorities may change when user evidence changes,
but the boundary does not change casually.

## 0.1 — Executable foundation

- [x] Dual execution/context graph contracts
- [x] Graph and Pack compiler
- [x] Parallel execution, joins, routing and human checkpoints
- [x] Provenance-linked context projection
- [x] Deterministic Research Pack

## 0.2 — Plug-and-play Pack experience

- [x] Pack SDK and `init / validate / inspect / run` CLI
- [x] In-memory and SQLite context stores
- [x] GitHub community health files and cross-platform CI
- [x] JSON Schema export for editor completion
- [x] `.gpack` compatibility, version activation and rollback commands
- [x] Reproducible `graphwork` npm tarball and cross-platform distribution smoke tests
- [x] Publish `graphwork` and activate the public `pnpm dlx graphwork` path

## 0.3 — Real Agent and tool adapters

- [x] Runtime-neutral Agent adapter interface
- [ ] First Pi/OpenAI-compatible adapters outside Pack contracts
- [x] Tool permission enforcement and secret boundaries
- [x] Durable SQLite run/event/checkpoint repository
- [x] Retry, timeout and failure-policy contracts

## 0.4 — First deep vertical

- [x] Architecture ontology and workflow Pack
- [x] Domain fixtures and golden evaluations
- [x] Migration guide from embedded architecture logic to Pack semantics
- [x] Evidence that a second Pack needs no kernel branching

## 0.5 — Graph-native Workbench UI

- [x] Read-only run and context graph explorer
- [x] Human inbox and checkpoint resume experience
- [x] Responsive local interface and zero-key vertical workflow

## 0.6 — Visual authoring and durable workspace

- [x] Visual authoring as a projection of the same versioned contracts
- [x] Node, edge, handler, state-access and execution-policy editing
- [x] Autosaved drafts, undo/redo, run history and checkpoint persistence

## 0.7 — Portable local Pack ecosystem

- [x] `.gpack` build, inspection, integrity and compatibility contract
- [x] Side-by-side installation, activation, rollback and removal
- [x] Workbench Pack import with explicit executable-code trust review
- [x] Trusted local third-party Pack discovery and execution
- [x] Bundled Pack installation, activation and configuration

## 0.8 — Registry trust and execution isolation

- [x] Ed25519-signed remote Registry metadata with expiry and trusted-key verification
- [x] Registry-bound artifact identity, checksum, compatibility and permissions
- [x] HTTPS Registry install and CLI publisher trust workflow
- [x] Restricted child-process handlers and context projectors for third-party Packs
- [x] Environment, filesystem, child-process, memory and execution-time boundaries
- [ ] OS/container network isolation adapter

## 0.9 — Registry experience and distribution

- [x] Workbench catalog for configured signed Registries
- [x] Verified publisher, expiry, compatibility and permission presentation
- [x] One-action Registry installation with server-side re-verification
- [x] Out-of-band local trust configuration and publisher key rotation
- [x] Reproducible reference Registry build and automated signed publishing workflow
- [ ] Activate the public Reference Registry after repository visibility and signing-key setup

## Before 1.0

- Stable compatibility policy and migrations
- PostgreSQL and distributed worker adapters
- Threat model, audit export and policy evaluation
- Performance baselines and larger production reference deployments
