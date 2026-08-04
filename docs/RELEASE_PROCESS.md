# Release Process

This project uses semantic versioning for published packages. Public contracts
remain pre-1.0 and may change between minor releases; breaking changes must be
documented in the changelog with a migration note.

## Release checklist

- Install with the committed lockfile using `pnpm install --frozen-lockfile`.
- Run type checking, tests, build and the zero-key demo on Windows and Linux.
- Confirm all public packages declare a compatible license.
- Add tests and documentation for new public behavior.
- Record public API changes, migrations and known limitations in the changelog.
- Validate every included Industry Pack with the current compiler.
- Run the README commands from a clean checkout.

## Package compatibility

Industry Packs declare their own semantic version and version each execution
graph independently. Before 1.0, a Pack should pin compatible minor versions of
the contracts, core and Pack SDK. `.gpack` inspection and signed Registry
verification enforce the declared Graphwork engine range before installation.
