# Industry Pack Authoring

An Industry Pack is the unit of domain reuse. It contains business meaning;
the kernel contains execution and governance mechanisms.

## Pack contract

Every Pack exports a serializable manifest with seven parts:

1. **Ontology** — typed context objects and allowed relations.
2. **Roles** — missions, permitted tools and forbidden actions.
3. **Tools** — governed external operations, typed I/O and idempotency.
4. **Graphs** — versioned state, nodes, edges and run budgets.
5. **Evaluations** — named quality gates, including blocking gates.
6. **Deliverables** — named output fields and their media types.
7. **Fixtures** — executable example inputs, decisions and expected outcomes.

A Pack may also export runtime adapters:

- handler functions for `agent`, `function` and `compensation` nodes;
- Agent and tool adapters registered through runtime bindings;
- context projectors that turn approved run state into durable objects and
  relations with run/node provenance;
- later, prompts, UI projections and external tool adapters.

## Kernel boundary

Keep these in the kernel:

- graph compilation, scheduling, concurrency and conditional routing;
- state schemas and node-level read/write permissions;
- event traces, budgets, checkpoints, human pause/resume and durable waits;
- versioned context-object storage interfaces and ontology validation.

Keep these in a Pack:

- industry nouns, object fields and relation meanings;
- SOP order, role missions, tool choices and evaluation criteria;
- domain prompts and the mapping from run outputs into context objects;
- example inputs and expected deliverables.

If adding a second industry requires changing the scheduler, the kernel is
probably missing a mechanism. If the scheduler contains an industry noun, the
domain boundary has leaked.

## Typed tools and connectors

Tools are the connector boundary; a Pack does not need a second connector
abstraction. Existing tools may keep the compact `id`, `label`, `description`
and `risk` contract. A typed tool additionally declares all of:

- `operation`: `query` or `command`;
- standard JSON Schema `inputSchema` and `outputSchema`;
- `idempotency`: `intrinsic`, `keyed` or `none`;
- `idempotencyKeyField` when the mode is `keyed`.

Query tools must be intrinsically idempotent. The runtime validates input before
authorization or adapter execution and validates output before returning it to
an Agent. For keyed commands, the validated key is passed to the adapter in
`ToolExecutionContext.idempotencyKey`. Pack roles and node `toolIds` remain the
permission model; risk policy remains the authorization model.

## Portable artifacts and evidence

The existing Deliverable declaration is also the artifact boundary; Packs do
not create a second output store. Add `artifactType`, `evidenceFields` and an
optional `approvalField` to opt into the portable format. The graph compiler
verifies every referenced state field.

For a completed deliverable, the runtime emits a versioned `PortableArtifact`
containing the content and SHA-256 digest, immutable Evidence snapshots and
digests, Pack/graph/run/producer identity, and the accountable approval Actor
when available. Artifact and Evidence values keep their Pack-owned domain shape;
the portable envelope supplies cross-Pack identity, integrity and provenance.

Portable artifacts travel in Workbench run snapshots and audit bundles. Context
projectors may still create richer domain objects and relations; the artifact
envelope does not replace the organizational context graph.

## Durable orchestration

A graph may declare one external `trigger` in addition to its entry node:

- `webhook` binds an HTTP method, path and optional JSON Schema body;
- `schedule` binds a cron expression, timezone and validated graph input;
- `event` binds a typed event and optional correlation field.

The runtime deliberately does not interpret cron. A scheduler owns calendar
evaluation and submits a stable occurrence ID and timestamp; Graph Workbench
uses that ID to make retries resolve to the same Run. Typed event IDs receive
the same replay protection.

Use orchestration nodes when the behavior belongs in the portable graph:

- `wait` persists either a due timestamp or an event type plus correlation key;
- `subgraph` maps child inputs as `{ childField: parentField }` and outputs as
  `{ parentField: childField }`;
- `loop` calls a child graph while an explicit condition matches and stops at
  `maxIterations`;
- `map` calls a child graph for a bounded array with declared item, result,
  item-count and concurrency limits;
- `escalation` records severity, reason and optional accountable role;
- `compensation` executes a handler on an explicit failure edge and declares
  which nodes it compensates.

Every mapped parent input must appear in `reads`; every mapped parent output
must appear in `writes`. Child graphs keep their own state and execution budget.
Cross-graph dependency cycles, unbounded loops, undeclared mappings and unknown
compensation targets fail compilation.

## Minimal workflow

1. Run `pnpm graph-workbench pack init <pack-id>` or copy `packs/research`.
2. Define the ontology before prompts or UI.
3. Declare graph state and each node's exact `reads` and `writes`.
4. Run `pnpm graph-workbench pack validate <module>`; do not bypass compiler errors.
5. Use `definePack` and `defineHandlers` from `@graph-workbench/pack-sdk`.
6. Implement deterministic handlers first, then add an Agent SDK adapter.
7. Declare at least one deliverable and one zero-key fixture.
8. Run `pnpm graph-workbench pack test <module>` and add one context-projection test.
9. Build and inspect the distributable artifact:
   `pnpm graph-workbench pack build <module> --output dist/<id>-<version>.gpack`.
10. Install it with explicit local trust, or publish it through a signed
    Registry, then run by Pack ID:
    `pnpm graph-workbench pack install <artifact> --trust`, then
    `pnpm graph-workbench pack run <id> --installed --set topic=hello`.
11. For a first-party reference Pack, capture its primary executable graph after
    **Fit View**, add it to `docs/assets/pack-graphs`, and update the
    [Industry Pack Gallery](PACK_GALLERY.md).
12. Prove the Pack without changing `packages/core`.

`pack validate` checks both the serialized graph contracts and every declared
executable handler binding. The detailed node-by-node acceptance criteria are in
[Node runtime conformance](NODE_RUNTIME_CONFORMANCE.md).

See [`.gpack` Package Format](PACK_FORMAT.md) for compatibility, integrity,
permissions, side-by-side versions and rollback behavior. Installed third-party
handlers and projectors run in network-denied, read-only containers by default; see
[Registry trust and Worker isolation](TRUST_AND_ISOLATION.md).
Registry operators can use the reusable release definition and CI flow in the
[Registry publishing guide](REGISTRY_PUBLISHING.md).

## Current constraints

- One trigger per graph.
- Top-level execution graphs are directed acyclic graphs. Bounded repetition is
  encapsulated by `loop` and `map` nodes.
- `join` uses `mode: "all"` to synchronize every incoming branch (the default),
  or `mode: "any"` to merge mutually exclusive routes after the first arrival.
- A human decision is supplied by node ID and written to its declared field.
- Context stores include in-memory, local SQLite and shared PostgreSQL adapters.
- Nodes may declare bounded `execution.timeoutMs` and
  `execution.retry.maxAttempts/backoffMs` policies.
- An external abort signal cancels the run and preserves a resumable checkpoint.
- A directly called subgraph may preserve a nested pause. Loop and Map child
  graphs must complete without suspension; move a durable wait outside those
  nodes when human or event input is required between iterations.
- Distributed workers consume the same versioned Pack and graph contracts as
  local execution.
