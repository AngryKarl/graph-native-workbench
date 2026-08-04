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

## Reference Registry

The reference Pack catalog is defined in `registry/reference.json` and built by
the same Pack SDK used by third-party publishers. Follow the
[Registry publishing guide](REGISTRY_PUBLISHING.md) for signing-key setup,
non-publishing rehearsals, GitHub Pages deployment and key rotation.
