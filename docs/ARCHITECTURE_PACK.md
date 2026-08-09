# Architecture Concept Design Pack

The Architecture Pack is the first deep vertical for Graphwork. It
turns a structured project intake into an evidence-backed concept design brief
without adding architecture-specific behavior to the kernel.

## Workflow

The reference workflow follows four domain stages:

1. collect project goals, constraints, site context and located source claims;
2. audit evidence and run site and program analysis in parallel;
3. develop and compare distinct concept directions;
4. pass blocking quality checks, pause for human review and publish a brief.

The output remains an early concept record. It does not claim statutory,
engineering, cost or constructability approval.

## Context projection

An approved run can be projected into typed project records:

```text
source evidence ──supports──> requirement / constraint / finding
project brief ──contains──> requirement / constraint
finding ──informs──> design direction
constraint ──governs──> design direction
decision ──governs──> deliverable
finding / direction ──included in──> deliverable
```

Every projected record carries its producing run and node. Source-derived
records also retain links to the source evidence objects used by the run.

## Migrating embedded domain logic

When moving an existing architecture workflow into a Pack, map each concern to
one of these boundaries:

| Existing concern | Pack location |
| --- | --- |
| Project vocabulary and stable business objects | `ontology.objectTypes` |
| Allowed semantic links | `ontology.relationTypes` |
| Stage sequence and approval gates | execution graph |
| Architect, analyst and reviewer behavior | roles and handlers |
| Evidence and option readiness checks | evaluations and quality-gate nodes |
| Concept brief or presentation output | deliverables |
| Representative projects and acceptance criteria | fixtures |
| Approved facts, decisions and artifacts | context projector |

Database tables, queues, routes and screens are adapters or projections. They
should not be copied into the Pack contract. UI layout is likewise a view of the
same versioned graph facts, not the source of workflow truth.

## Verify

```bash
pnpm graphwork pack validate packs/architecture/src/index.ts
pnpm graphwork pack inspect packs/architecture/src/index.ts
pnpm graphwork pack test packs/architecture/src/index.ts
pnpm demo:architecture
```

The fixtures cover an adaptive-reuse street renewal and a transit-oriented
cultural hub. The first produces Chinese output and the second produces English
output. Both execute with deterministic handlers and require no model key.

To use the interactive project input and review flow:

```bash
pnpm workbench
```

Open `http://127.0.0.1:4311` and run the preloaded project to its design-review
checkpoint. Approval generates the deliverable and its typed context projection.
