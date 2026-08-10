# Release Process

This project uses semantic versioning for published packages. Public contracts
remain pre-1.0 and may change between minor releases; breaking changes must be
documented in the changelog with a migration note.

## Release checklist

- Install with the committed lockfile using `pnpm install --frozen-lockfile`.
- Run type checking, tests, build and the zero-key demo on Windows and Linux.
- Run performance budgets and the real-browser Workbench approval journey.
- Confirm all public packages declare a compatible license.
- Add tests and documentation for new public behavior.
- Record public API changes, migrations and known limitations in the changelog.
- Validate every included Industry Pack with the current compiler.
- Run the README commands from a clean checkout.
- Install the packed npm tarball into a clean temporary project and repeat the
  CLI and Workbench smoke journey.

## Package compatibility

Industry Packs declare their own semantic version and version each execution
graph independently. Before 1.0, a Pack should pin compatible minor versions of
the contracts, core and Pack SDK. `.gpack` inspection and signed Registry
verification enforce the declared Graph Workbench engine range before installation.

Compatibility is evaluated by the Pack SDK and exposed as a structured result:
compatible, requires a newer engine, requires an older engine, or unsupported.
The CLI, Workbench artifact review and signed Registry catalog use this same
result so installation behavior and guidance cannot drift between surfaces.

Published Pack bytes are immutable. A change to Pack behavior requires a new
Pack semantic version; a change to a graph contract requires a new graph
version. Existing Pack versions remain installed side by side and may be
reactivated or rolled back.

## Workspace migrations

Workbench data has an independent integer `formatVersion`. The current format
is version 2 and includes a stable workspace identity plus creation and update
timestamps. When Graph Workbench opens a version 1 workspace it:

1. validates the legacy top-level structure;
2. writes the untouched source to `workbench.json.v1.backup`;
3. migrates it in memory without dropping Packs, drafts, runs, checkpoints or
   model-provider selection;
4. atomically replaces the workspace file with format version 2.

The backup is created once. Unknown future formats fail closed and are never
rewritten. Every future workspace format change must add a deterministic
migration test, preserve an untouched backup and document any user-visible
behavior change here and in the changelog.

## Reference Registry

The reference Pack catalog is defined in `registry/reference.json` and built by
the same Pack SDK used by third-party publishers. Follow the
[Registry publishing guide](REGISTRY_PUBLISHING.md) for signing-key setup,
non-publishing rehearsals, GitHub Pages deployment and key rotation.

## npm distribution

The public `graph-workbench` package is built and smoke-tested independently of the
workspace source layout. Follow the [npm distribution guide](NPM_DISTRIBUTION.md)
for tarball inspection, the default dry-run workflow, provenance and immutable
version checks.

Run `pnpm release:check` for the complete local gate and review the
[release-readiness audit](RELEASE_READINESS.md) before any external publication.
