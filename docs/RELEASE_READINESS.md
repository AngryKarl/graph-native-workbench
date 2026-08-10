# Release readiness

Graph Workbench has one local release gate:

```bash
pnpm release:check
```

It runs type checking, unit and integration tests, deterministic performance
budgets, the Chromium Workbench journey, distribution smoke tests, npm packing,
a clean temporary npm installation and public metadata validation.

## Covered release boundaries

| Boundary | Evidence |
| --- | --- |
| First five minutes | clean npm install; Workbench health, API, static client and zero-key demo |
| Browser product loop | open fresh workspace, run Architecture Pack, approve, complete and inspect context |
| Public contracts | compiler, runtime, Pack lifecycle, compatibility and migration tests |
| Governance | policy evaluation, bound approvals, ordered events and portable audit verification |
| Team execution | PostgreSQL Store and pg-boss retry tests on embedded PostgreSQL |
| Supply chain | `.gpack` checksums, signed Registry verification, restricted Worker tests |
| Operations | performance budgets, container build CI and Compose configuration validation |
| Community | MIT license, contribution, conduct, governance, support and security policies |

## External release actions

The local gate does not publish or change external systems. Before a public
release, a maintainer must:

1. choose and apply the release version, changelog date and npm tag;
2. make the source repository public and enable npm trusted publishing or
   configure the release token;
3. enable GitHub Private Vulnerability Reporting and Discussions;
4. configure the Registry Ed25519 signing secret and GitHub Pages;
5. run both release workflows in dry-run mode, review their artifacts, then
   explicitly authorize npm and Registry publication;
6. verify the public untagged stable release (or explicitly tagged prerelease)
   and Registry URLs from a clean machine.

These are intentionally separate from code completion because they create
irreversible public artifacts and require repository-owner credentials.
