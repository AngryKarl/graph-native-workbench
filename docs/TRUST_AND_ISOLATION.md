# Registry trust and Worker isolation

Graph Workbench treats publisher identity and code execution as separate
security boundaries.

## Signed Registry v1

A Registry document contains a versioned payload and a detached Ed25519
signature. The payload binds every Pack identity and version to:

- the artifact URL and SHA-256 checksum;
- the required Graph Workbench engine range;
- the declared executable permissions;
- a generation time and mandatory expiry time.

The publisher public key is not downloaded from the Registry. Operators provide
trusted keys out of band, keyed by a stable `keyId`. Verification rejects an
unknown key, an invalid signature, expired or future-dated metadata, duplicate
Pack versions, insecure HTTP, cross-origin artifacts by default, and any
artifact whose identity, checksum, engine range or permissions differ from the
signed entry.

Generate an Ed25519 key pair with your organization’s normal key-management
system. For local evaluation, OpenSSL can generate compatible PEM files:

```bash
openssl genpkey -algorithm Ed25519 -out registry-private.pem
openssl pkey -in registry-private.pem -pubout -out registry-public.pem
```

Create a payload containing the Registry metadata and Pack entries, then sign
and verify it:

```bash
pnpm graph-workbench pack registry sign registry-payload.json \
  --key-id acme.release --private-key registry-private.pem \
  --output registry.json

pnpm graph-workbench pack registry verify registry.json \
  --key acme.release=registry-public.pem
```

Install a Pack from an HTTPS Registry:

```bash
pnpm graph-workbench pack registry install support_ops@0.1.0 \
  --registry https://packs.example.com/registry.json \
  --key acme.release=registry-public.pem
```

`--allow-http` exists only for loopback development and tests. Publisher private
keys must never be committed to a Pack repository or served with Registry
metadata.

### Workbench Registry catalog

The Workbench reads trusted Registry sources from `.graph-workbench/trust.json` by
default. Set `GRAPH_WORKBENCH_TRUST` to use a different file. Public-key paths
are resolved relative to the trust file:

```json
{
  "formatVersion": 1,
  "registries": [
    {
      "id": "acme",
      "name": "Acme Industry Packs",
      "url": "https://packs.example.com/registry.json",
      "trustedKeys": [
        {
          "keyId": "acme.release",
          "publicKeyPath": "keys/acme-release.pem"
        }
      ]
    }
  ]
}
```

Restart `pnpm workbench`, then open **Packs → Signed Registries**. Catalog
metadata is displayed only after signature and expiry verification. Selecting
**Verify & install** downloads the artifact and repeats verification against the
configured key, signed checksum, engine range and permission list before the
Pack becomes active. Trust keys cannot be added from the browser interface.

Multiple keys can be listed during publisher key rotation. Cross-origin
artifacts remain disabled unless `allowCrossOriginArtifacts` is explicitly set.
Plain HTTP is accepted only for loopback sources with `allowInsecureHttp: true`.

## Isolated Worker

Installed third-party Pack handlers and context projectors execute in a fresh,
network-denied container by default. Bundled reference Packs continue to execute
in process because they are part of the reviewed distribution.

The default container boundary provides:

- no inherited parent environment or application secrets;
- read-only mounts limited to the Worker and installed Pack directories;
- no filesystem writes, child processes, native add-ons or Worker threads;
- a 128 MB V8 old-space limit;
- a 30-second execution ceiling, with cancellation terminating the process;
- IPC-only state patches and recorded context projection operations;
- a fresh process for each handler or projector invocation.

Packs declaring filesystem access require a purpose-built container policy and
are rejected by the default adapter. Load an installed Pack with the default
deny-by-default network boundary:

```ts
const loaded = await loadInstalledPackIsolated('customer_success', packRoot, {
  container: { runtime: 'docker', network: 'none' }, // also the default policy
});
```

The adapter invokes Docker or Podman without a shell and applies `network=none`,
a read-only root filesystem, a non-root user, no Linux capabilities, no-new-
privileges, bounded memory/CPU/PIDs and a small no-exec temporary filesystem.
Only the Worker and Pack artifact are mounted read-only. Explicit environment
values are passed by name so their contents do not appear on the command line.

The CLI uses the same mode for installed Pack workers:

```bash
graph-workbench worker start customer_success --installed \
  --database "$GRAPH_WORKBENCH_POSTGRES_URL"
```

Use `--container-network <network> --allow-network` only after reviewing a Pack
that requires network access. Host filesystem roots and Pack-spawned child
processes are rejected in container mode; required files should be packaged in
the signed artifact.

`--unsafe-process-isolation` runs Pack code as the current OS user and exists only
for reviewed development fixtures. Node's permission model is not a security
sandbox for malicious code, and Node 24 cannot deny network access in this mode.

These boundaries reduce blast radius; they do not make unknown code safe. Signed
metadata establishes publisher identity and artifact integrity, not publisher
trustworthiness.
