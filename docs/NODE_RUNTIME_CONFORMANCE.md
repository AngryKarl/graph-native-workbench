# Node runtime conformance

Graph Workbench treats a node as implemented only when it has all four of the
following: a public contract, compile-time validation, runtime behavior and an
executable test path. A shape on the canvas is not a node implementation.

| Node | Concrete runtime behavior | Compile-time protection | Executable evidence |
| --- | --- | --- | --- |
| `trigger` | Starts a manual run or accepts a validated webhook, schedule occurrence or typed event | Exactly one entry node; external input and correlation fields are validated | trigger-dispatch tests and reference Pack fixtures |
| `agent` | Invokes a provider-neutral model adapter with governed tools, or its deterministic zero-key handler | Handler, role, tool and evaluation references are validated | adapter tests and Agent-bearing Pack fixtures |
| `function` | Executes a bound handler with declared read/write state boundaries | Handler and state fields are required | runtime tests and every reference Pack fixture suite |
| `router` | Selects outgoing edges from state predicates and success/failure outcomes | Edge fields and targets are validated | exclusive-route and Pack branch tests |
| `join` | `all` synchronizes every branch; `any` continues after the first arriving branch | Mode and distinct incoming branches are validated | parallel research flow and exclusive-route merge tests |
| `human` | Persists a checkpoint, enforces the responsible role and records the resolving Actor | Decision field, write permission and role reference are validated | pause/resume, authority and approval-provenance tests |
| `wait` | Persists a timer or correlated-event suspension and resumes durably | Timer/event shape, correlation reads and payload writes are validated | SQLite checkpoint and event-correlation tests |
| `subgraph` | Calls another graph through explicit input/output mappings and preserves a nested suspension | Graph existence, mappings and dependency cycles are validated | reusable and resumable subgraph tests |
| `loop` | Repeats a child graph while an explicit condition matches, bounded by `maxIterations` | Child graph, mappings, condition and iteration bound are validated | bounded-loop tests and Customer Success schedule flow |
| `map` | Runs a child graph over a bounded collection with controlled concurrency and ordered results | Item/result fields, mappings, size and concurrency bounds are validated | dynamic-map tests and multiple reference Packs |
| `escalation` | Emits a severity-, reason- and role-attributed escalation into the run audit | Severity, reason and role are validated | governed failure and industry recovery tests |
| `compensation` | Executes a recovery handler and records compensation start/completion/failure events | Handler and compensated node references are validated | governed failure and industry rollback tests |

## Pack-level guarantee

`validatePackHandlerCoverage` checks every executable node in every graph, not
only nodes reached by a happy-path fixture. `pack validate` and fixture
conformance use this check, so a Pack cannot be reported as runnable while a
declared handler is missing.

The reference-Pack conformance test also requires the first-party Pack set to
demonstrate every public node kind. Domain fixture suites then prove complete
zero-key outcomes, approval paths and recovery paths with real Pack handlers.

## Deliberate boundaries

- Router policy belongs to typed edge predicates; there is no second hidden
  routing language in node configuration.
- A join synchronizes actual upstream arrivals. Use `any` after mutually
  exclusive routing and `all` for parallel fan-out/fan-in work.
- Loop and Map child graphs must complete without suspension. Put human or
  external-event waits outside the iterative node.
- Specialist systems still execute their own domain operations. Typed tools
  and handlers are the replaceable integration boundary; the graph records the
  governed workflow, decisions and evidence.
