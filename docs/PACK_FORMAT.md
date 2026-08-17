# `.gpack` Package Format v1

`.gpack` is the portable distribution unit for an Industry Pack. It is a ZIP
archive with three allowed files:

```text
graph-workbench.pack.json   Package identity, compatibility, permissions and hashes
manifest.json         Serializable Industry Pack manifest
dist/index.mjs        Bundled ESM handlers and optional runtime exports
```

The deliberately small file set makes a package easy to inspect, hash, cache
and move between local development, CI, a future registry and an air-gapped
installation.

## Descriptor

`graph-workbench.pack.json` uses this shape:

```json
{
  "formatVersion": 1,
  "pack": {
    "id": "customer_success",
    "version": "0.6.0",
    "manifest": "manifest.json",
    "entry": "dist/index.mjs"
  },
  "engine": { "graph-workbench": "^0.6.0" },
  "permissions": ["handlers.execute"],
  "integrity": {
    "algorithm": "sha256",
    "files": {
      "manifest.json": "...",
      "dist/index.mjs": "..."
    }
  }
}
```

Pack and engine versions use semantic versions. The current permission
vocabulary is `handlers.execute`, `context.write`, `network` and `filesystem`.
Permissions are review metadata in format v1; process-level enforcement is a
separate runtime milestone and must not be assumed.

Graph Workbench `0.3.x` also reads legacy `graphwork.pack.json` descriptors
whose engine key is `graphwork`. New builds always emit the canonical filename
and `graph-workbench` engine key.

## Build and inspect

```bash
pnpm graph-workbench pack build packs/customer_success/src/index.ts \
  --output dist/customer_success-0.6.0.gpack
pnpm graph-workbench pack inspect dist/customer_success-0.6.0.gpack
```

Building executes the local source module to validate its manifest, then
bundles the entry for Node.js. A standard `projector` export automatically adds
the `context.write` permission. Build only source you trust.

## Install and run

```bash
pnpm graph-workbench pack install dist/customer_success-0.6.0.gpack --trust
pnpm graph-workbench pack list
pnpm graph-workbench pack run customer_success --installed --set "topic=renewal risk"
```

Installation verifies the format, file whitelist, expanded size, semantic
identity, engine range and every declared SHA-256 digest before writing into
`.graph-workbench/packs/<id>/<version>`. Executable handlers are rejected unless the
operator supplies `--trust`. The local installation record also pins the
descriptor digest so permission metadata cannot be changed after installation
without detection.

The Workbench discovers trusted active versions from `.graph-workbench/packs` when it
starts. You can also open the **Packs** view, choose **Import .gpack**, review
the compatibility range, permissions and SHA-256 fingerprint, then select
**Trust & install**. The newly imported Pack opens immediately.

## Versions and rollback

Versions are stored side by side. A newly installed version becomes active by
default; use `--no-activate` to stage it.

```bash
pnpm graph-workbench pack activate customer_success@0.6.0
pnpm graph-workbench pack rollback customer_success
pnpm graph-workbench pack uninstall customer_success --version 0.2.0
```

`rollback` selects the most recently installed non-active version. The active
version cannot be removed while another version remains; activate the desired
replacement first.

## Security boundary

A checksum proves that installed bytes match the artifact; it does not prove
who authored those bytes or that the code is safe. Until signed registry
metadata is configured, local artifacts still rely on explicit operator trust:

- obtain Packs from a source you can audit;
- inspect permissions and checksums before installation;
- use a dedicated OS/container boundary for untrusted code;
- never put secrets in a Pack manifest or artifact;
- do not treat `--trust` as a sandbox.

Signed Registry metadata can bind publisher identity to the artifact checksum,
compatibility and permissions. Signed entries may also carry the Pack name,
description and license used by verified catalogs. Workbench and installed-Pack CLI execution use a
network-denied, read-only container for third-party handlers and projectors by default. See
[Registry trust and Worker isolation](TRUST_AND_ISOLATION.md) for the exact
guarantees and remaining boundary.
