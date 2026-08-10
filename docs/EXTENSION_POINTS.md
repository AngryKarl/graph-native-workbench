# Extension points

Graph Workbench keeps domain meaning in Industry Packs and exposes a small set of
mechanism-level extension points. Choose the narrowest boundary that solves the
problem; a new core abstraction should be the last option.

## Industry Pack

Use a Pack when the change introduces business nouns, roles, SOP steps, quality
rules or deliverables. A Pack can provide:

- ontology object and relation types;
- one or more executable work graphs;
- deterministic handlers or provider-backed Agent intent;
- roles, permitted tools and forbidden actions;
- blocking evaluations and human decisions;
- golden fixtures and declared deliverables;
- a projector that confirms approved run output in the context graph.

Start with:

```bash
pnpm graph-workbench pack init claims_review
pnpm graph-workbench pack test packs/claims_review/src/index.ts
```

Use the [Customer Success Pack](../packs/customer-success/README.md) as the
compact full example and the [Architecture Pack](ARCHITECTURE_PACK.md) as the
deeper vertical example.

## Model provider adapter

Use a provider adapter when a model endpoint cannot be represented by the
existing OpenAI-compatible, Anthropic Messages or Gemini GenerateContent
protocol adapters. Packs must not import provider SDKs or depend on provider
response shapes. The adapter returns the normalized Agent result and usage
record expected by the runtime.

Authority: [`packages/core/src/adapters.ts`](../packages/core/src/adapters.ts)
and [`packages/core/src/model-providers.ts`](../packages/core/src/model-providers.ts).

## Tool adapter

Use a tool adapter to connect a Pack-declared tool to an external system. The
Pack owns the tool's business meaning and risk class; the adapter owns API
transport, secret names and result normalization. Runtime policy still decides
whether a call is allowed, denied or requires approval.

Authority: [`packages/core/src/adapters.ts`](../packages/core/src/adapters.ts).

## Persistence adapter

Use a storage adapter when runs or context must live somewhere other than the
built-in memory, SQLite and PostgreSQL stores. Preserve event ordering,
checkpoint semantics, versioned context records and optimistic recovery
behavior.

Authorities: [`packages/core/src/run-store.ts`](../packages/core/src/run-store.ts)
and [`packages/core/src/context-store.ts`](../packages/core/src/context-store.ts).

## Execution isolation adapter

Use an isolation adapter to change where untrusted Pack code runs. The bundled
child worker and Docker/Podman boundary are reference implementations. An
adapter must preserve time, memory, filesystem, environment and network policy
instead of silently weakening them.

Authority: [`packages/pack-sdk/src/isolation.ts`](../packages/pack-sdk/src/isolation.ts).

## Workbench projection

The Workbench is a projection of public contracts, not a second workflow
format. UI additions should consume the existing manifest, graph, run, event
and context APIs. Extend a public contract only when the capability also makes
sense to CLI and non-React consumers.

## Before proposing a core extension

Open a mechanism proposal and answer three questions:

1. Which user workflow is blocked?
2. Which two credible domains need the same mechanism?
3. Why can the behavior not live in a Pack or adapter?

This protects Pack portability and prevents domain-specific rules from leaking
into the kernel.
