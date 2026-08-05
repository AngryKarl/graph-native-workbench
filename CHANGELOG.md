# Changelog

All notable changes will be documented here. The project follows semantic
versioning once public packages begin publishing.

## Unreleased

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

### Changed

- Adopted the MIT License to minimize integration friction.
