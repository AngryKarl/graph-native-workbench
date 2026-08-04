# `.gpack` Package Format v1

`.gpack` is the portable distribution unit for an Industry Pack. It is a ZIP
archive with three allowed files:

```text
graphwork.pack.json   Package identity, compatibility, permissions and hashes
manifest.json         Serializable Industry Pack manifest
dist/index.mjs        Bundled ESM handlers and optional runtime exports
```

The deliberately small file set makes a package easy to inspect, hash, cache
and move between local development, CI, a future registry and an air-gapped
installation.

## Descriptor

`graphwork.pack.json` uses this shape:

```json
{
  "formatVersion": 1,
  "pack": {
    "id": "customer_success",
    "version": "0.1.0",
    "manifest": "manifest.json",
    "entry": "dist/index.mjs"
  },
  "engine": { "graphwork": "^0.1.0" },
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

## Build and inspect

```bash
pnpm graphwork pack build packs/customer_success/src/index.ts \
  --output dist/customer_success-0.1.0.gpack
pnpm graphwork pack inspect dist/customer_success-0.1.0.gpack
```

Building executes the local source module to validate its manifest, then
bundles the entry for Node.js. A standard `projector` export automatically adds
the `context.write` permission. Build only source you trust.

## Install and run

```bash
pnpm graphwork pack install dist/customer_success-0.1.0.gpack --trust
pnpm graphwork pack list
pnpm graphwork pack run customer_success --installed --set "topic=renewal risk"
```

Installation verifies the format, file whitelist, expanded size, semantic
identity, engine range and every declared SHA-256 digest before writing into
`.graphwork/packs/<id>/<version>`. Executable handlers are rejected unless the
operator supplies `--trust`.

The Workbench discovers trusted active versions from `.graphwork/packs` when it
starts. You can also open the **Packs** view, choose **Import .gpack**, review
the compatibility range, permissions and SHA-256 fingerprint, then select
**Trust & install**. The newly imported Pack opens immediately.

## Versions and rollback

Versions are stored side by side. A newly installed version becomes active by
default; use `--no-activate` to stage it.

```bash
pnpm graphwork pack activate customer_success@0.1.0
pnpm graphwork pack rollback customer_success
pnpm graphwork pack uninstall customer_success --version 0.2.0
```

`rollback` selects the most recently installed non-active version. The active
version cannot be removed while another version remains; activate the desired
replacement first.

## Security boundary

A checksum proves that installed bytes match the artifact; it does not prove
who authored those bytes or that the code is safe. Until signed registry
metadata and worker isolation land:

- obtain Packs from a source you can audit;
- inspect permissions and checksums before installation;
- use a dedicated OS/container boundary for untrusted code;
- never put secrets in a Pack manifest or artifact;
- do not treat `--trust` as a sandbox.
