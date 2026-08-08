# Industry Pack Authoring

An Industry Pack is the unit of domain reuse. It contains business meaning;
the kernel contains execution and governance mechanisms.

## Pack contract

Every Pack exports a serializable manifest with seven parts:

1. **Ontology** — typed context objects and allowed relations.
2. **Roles** — missions, permitted tools and forbidden actions.
3. **Tools** — capability declarations and their risk level.
4. **Graphs** — versioned state, nodes, edges and run budgets.
5. **Evaluations** — named quality gates, including blocking gates.
6. **Deliverables** — named output fields and their media types.
7. **Fixtures** — executable example inputs, decisions and expected outcomes.

A Pack may also export runtime adapters:

- handler functions for `agent` and `function` nodes;
- Agent and tool adapters registered through runtime bindings;
- context projectors that turn approved run state into durable objects and
  relations with run/node provenance;
- later, prompts, UI projections and external tool adapters.

## Kernel boundary

Keep these in the kernel:

- graph compilation, scheduling, concurrency and conditional routing;
- state schemas and node-level read/write permissions;
- event traces, budgets, checkpoints and human pause/resume;
- versioned context-object storage interfaces and ontology validation.

Keep these in a Pack:

- industry nouns, object fields and relation meanings;
- SOP order, role missions, tool choices and evaluation criteria;
- domain prompts and the mapping from run outputs into context objects;
- example inputs and expected deliverables.

If adding a second industry requires changing the scheduler, the kernel is
probably missing a mechanism. If the scheduler contains an industry noun, the
domain boundary has leaked.

## Minimal workflow

1. Run `pnpm graphwork pack init <pack-id>` or copy `packs/research`.
2. Define the ontology before prompts or UI.
3. Declare graph state and each node's exact `reads` and `writes`.
4. Run `pnpm graphwork pack validate <module>`; do not bypass compiler errors.
5. Use `definePack` and `defineHandlers` from `@graph-native/pack-sdk`.
6. Implement deterministic handlers first, then add an Agent SDK adapter.
7. Declare at least one deliverable and one zero-key fixture.
8. Run `pnpm graphwork pack test <module>` and add one context-projection test.
9. Build and inspect the distributable artifact:
   `pnpm graphwork pack build <module> --output dist/<id>-<version>.gpack`.
10. Install it with explicit local trust, or publish it through a signed
    Registry, then run by Pack ID:
    `pnpm graphwork pack install <artifact> --trust`, then
    `pnpm graphwork pack run <id> --installed --set topic=hello`.
11. Prove the Pack without changing `packages/core`.

See [`.gpack` Package Format](PACK_FORMAT.md) for compatibility, integrity,
permissions, side-by-side versions and rollback behavior. Installed third-party
handlers and projectors run in network-denied, read-only containers by default; see
[Registry trust and Worker isolation](TRUST_AND_ISOLATION.md).
Registry operators can use the reusable release definition and CI flow in the
[Registry publishing guide](REGISTRY_PUBLISHING.md).

## Version 0.1 constraints

- One trigger per graph.
- Execution graphs are directed acyclic graphs.
- `join` waits for every statically declared incoming source.
- A human decision is supplied by node ID and written to its declared field.
- Context stores include in-memory, local SQLite and shared PostgreSQL adapters.
- Nodes may declare bounded `execution.timeoutMs` and
  `execution.retry.maxAttempts/backoffMs` policies.
- An external abort signal cancels the run and preserves a resumable checkpoint.
- Dynamic subgraphs and compensation are future mechanisms and must not be
  simulated through Pack-specific kernel changes. Distributed workers consume
  the same versioned Pack and graph contracts as local execution.
