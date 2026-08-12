# npm Distribution

The `graph-workbench` package is a self-contained distribution of the CLI, bundled
reference Packs, isolated Worker and built Workbench interface. `esbuild`
compiles user Packs; `pg` and `pg-boss` provide optional PostgreSQL team
execution without a second distribution.

## Build and verify locally

```bash
pnpm dist:check
pnpm dist:pack
pnpm release:check
```

`dist:check` validates the packaged version command, zero-key demo,
dependency-free Pack scaffolding, Pack validation/build/execution and the
actual Workbench HTTP API and static client. `dist:pack` creates
`release/npm/graph-workbench-<version>.tgz` and prints every included file.

Test the tarball through the same temporary installation path used by `dlx`:

```bash
pnpm dlx /absolute/path/to/release/npm/graph-workbench-0.4.1.tgz --version
pnpm dlx /absolute/path/to/release/npm/graph-workbench-0.4.1.tgz demo
```

The public user entrypoints are:

```bash
pnpm dlx graph-workbench
pnpm dlx graph-workbench demo
pnpm dlx graph-workbench pack init customer_success
```

Stable public-alpha releases use the `latest` tag. Prerelease builds use
`next`, so the default commands always select the maintained public release.

The first command starts the Workbench on `127.0.0.1:4311`, opens the browser
and persists the workspace in `.graph-workbench` under the caller's current
directory. The packaged scaffolder emits a standalone `.mjs` Pack so the first
validate, test, build and run do not require a project dependency installation.
`release:check` additionally installs the packed tarball into a clean temporary
project and repeats the full smoke journey through the installed bytes.

## Publishing

The package version and public metadata live in
`apps/distribution/package.json`. Published versions are immutable; increment
that version before every release.

[`release-npm.yml`](../.github/workflows/release-npm.yml) is manually triggered
and defaults to a non-publishing dry run. It repeats type checking, tests and
distribution smoke checks before npm inspects the package. Actual publication
requires `publish=true` and an npm trusted-publishing setup or repository
`NPM_TOKEN`, and refuses to replace an existing version. Public releases request
an npm provenance attestation through GitHub Actions OIDC.

Run the dry rehearsal:

```bash
gh workflow run release-npm.yml -f npm_tag=next -f publish=false
```

Publishing is an external release action. Confirm the package version, npm tag,
README and public repository timing before running with `publish=true`.

`graphwork@0.1.0` was the initial `latest` release on 2026-08-05.
`graphwork@0.2.0-rc.1` was published with provenance on 2026-08-08 under the
`next` tag. `graphwork@0.2.0` was the first stable public-alpha release;
`graphwork@0.2.1` and `graphwork@0.2.2` followed as interaction and security
patches. `graph-workbench@0.3.0` is the first release under the final public
name. The former `graphwork` package is deprecated with a migration notice.
