# Registry trust and Worker isolation

Graph Native Workbench treats publisher identity and code execution as separate
security boundaries.

## Signed Registry v1

A Registry document contains a versioned payload and a detached Ed25519
signature. The payload binds every Pack identity and version to:

- the artifact URL and SHA-256 checksum;
- the required Graphwork engine range;
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
pnpm graphwork pack registry sign registry-payload.json \
  --key-id acme.release --private-key registry-private.pem \
  --output registry.json

pnpm graphwork pack registry verify registry.json \
  --key acme.release=registry-public.pem
```

Install a Pack from an HTTPS Registry:

```bash
pnpm graphwork pack registry install support_ops@0.1.0 \
  --registry https://packs.example.com/registry.json \
  --key acme.release=registry-public.pem
```

`--allow-http` exists only for loopback development and tests. Publisher private
keys must never be committed to a Pack repository or served with Registry
metadata.

## Isolated Worker

Installed third-party Pack handlers and context projectors execute in a fresh
child process. Bundled reference Packs continue to execute in process because
they are part of the reviewed distribution.

The default Worker boundary provides:

- no inherited parent environment or application secrets;
- Node’s permission model with read access limited to the Worker and installed
  Pack directories;
- no filesystem writes, child processes, native add-ons or Worker threads;
- a 128 MB V8 old-space limit;
- a 30-second execution ceiling, with cancellation terminating the process;
- IPC-only state patches and recorded context projection operations;
- a fresh process for each handler or projector invocation.

Packs declaring filesystem access require explicit read/write roots. Packs
declaring network access require explicit operator approval, but Node’s
permission model does not provide network isolation. Use an OS sandbox or
container when network denial, syscall filtering, tenant isolation or stronger
resource guarantees are required.

The Worker reduces blast radius; it does not make unknown code safe. Signed
metadata establishes publisher identity and artifact integrity, not publisher
trustworthiness.
