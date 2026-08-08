# Threat Model

This document describes the security boundaries of Graph Native Workbench 0.x.
It complements the concrete Registry and Worker controls in
[Trust and isolation](TRUST_AND_ISOLATION.md).

## Protected assets

- model and tool credentials held by the local server;
- Pack source, installed artifacts and publisher trust configuration;
- workflow input, state, checkpoints, decisions and deliverables;
- organizational context objects, relations and provenance;
- ordered execution and approval evidence.

## Trust boundaries

1. **Browser to local server** — the browser receives workflow data and model
   metadata, but never provider or tool secrets.
2. **Pack to runtime kernel** — Pack manifests declare semantics; the compiler
   validates graphs and the runtime enforces state writes, budgets, roles and
   tool scope.
3. **Model to tools** — model output is untrusted. Tool calls must match the
   node, role, Pack declaration and operator policy before an adapter runs.
4. **Registry to installer** — Registry data is untrusted until publisher
   signature, expiry, artifact identity, checksum, compatibility and permission
   metadata all verify.
5. **Third-party code to host** — installed handlers and projectors run in a
   restricted child process; stronger network and tenant isolation requires the
   deployment boundary described below.

## Threats and controls

| Threat | Primary controls | Residual risk |
| --- | --- | --- |
| Prompt injection requests an unsafe tool | Node tool scope, role allowlist, ordered policy, input-bound human approval | A reviewer can still approve a malicious request |
| A Pack reads unrelated credentials | Tool-scoped secret lookup; Workers inherit no parent environment | Bundled in-process Packs are trusted distribution code |
| A Pack modifies undeclared workflow state | Node `writes` validation and typed state contracts | Approved fields can still contain poor-quality data |
| Registry metadata or artifacts are replaced | Ed25519 metadata signature, expiry, SHA-256 artifact and file integrity | A trusted publisher key can sign malicious code |
| Installed Pack files are changed locally | Descriptor and file digests are rechecked before execution | A host administrator can alter both code and trust state |
| Approval is replayed for different input | Approval id binds run, node, role, tool and canonical input digest | Approval does not prove reviewer identity in local mode |
| Event or deliverable evidence is altered after export | Canonical audit-bundle SHA-256 verification | The bundle is not externally timestamped or signed |
| Worker escapes through network access | Network permission is explicit and visible | Node permissions do not isolate network; use the 0.13 OS/container adapter |
| Local HTTP API is reached by another process or browser origin | Loopback binding and JSON-only API behavior | Authentication and multi-tenant isolation are not yet provided |
| Resource exhaustion | Graph budgets, node timeouts, Worker memory/time limits | In-process bundled adapters share the server process |

## Deployment assumptions

The default Workbench is a single-user local application bound to loopback. It
is not a multi-tenant service and must not be exposed directly to an untrusted
network. Production deployments must add authentication, TLS, an external
secret manager, database access controls, process identity and OS/container
isolation appropriate to their environment.

## Security invariants

- secrets never enter Pack manifests, graph state, browser responses or audit
  events;
- unknown future workspace and artifact formats fail closed;
- approval-required tools never execute before a matching bound decision;
- a rejected tool request produces ordered approval and denial evidence;
- third-party executable artifacts are never installed without explicit local
  trust or a configured publisher key;
- audit verification fails when protected bundle content changes.

Changes that weaken an invariant require a security review, regression tests
and a release-note migration warning.
