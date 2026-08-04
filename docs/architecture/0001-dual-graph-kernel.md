# ADR-0001: Dual-graph kernel with Industry Packs

- Status: accepted
- Date: 2026-08-03

## Context

Agent workflow products commonly model only execution: nodes perform work and
edges route state. Industry work also depends on a second, longer-lived graph of
sources, facts, evidence, artifacts, versions and decisions. If those two graphs
are disconnected, Agent output becomes disposable chat and organizational
knowledge becomes an ungoverned retrieval index.

An initial architecture-domain prototype demonstrated valuable domain behavior,
but also showed how generic Agent mechanics can become coupled to domain-specific
workspaces, document types and roles. The new kernel separates those concerns.

## Decision

The product has two explicit graph models:

1. **Execution graph**: versioned definitions and runtime instances containing
   agent loops, deterministic functions, tools, routers, joins and human gates.
2. **Context graph**: versioned business objects and typed relations carrying
   provenance, validity, confirmation state and producing-run identity.

Industry Packs supply domain semantics on top of both graphs. The kernel remains
domain-neutral and storage-neutral.

The execution graph is hybrid:

- known structure is declared and compiled;
- runtime variability may create bounded child work later;
- dynamic topology must pass deterministic policy checks before execution;
- a single Agent loop is a valid one-node graph and remains the default for work
  that does not benefit from multi-node coordination.

## Consequences

- The visual canvas is a projection of graph facts, never their source of truth.
- Node handlers are adapters; the first Agent adapter may use Pi, but Pack and
  graph contracts cannot depend on Pi.
- PostgreSQL/SQLite adjacency tables are sufficient initially. Neo4j, Graphiti
  and other graph stores can be optional adapters.
- Architecture-specific objects and prompts belong in an Architecture Pack.
- Event traces, state write permissions, budgets and human gates are kernel
  responsibilities because Packs cannot enforce them by prompt convention.
