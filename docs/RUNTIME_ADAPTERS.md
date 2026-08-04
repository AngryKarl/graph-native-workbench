# Runtime Adapters

Graph and Pack contracts do not depend on a model vendor, Agent SDK, tool
protocol or database. Runtime bindings connect those contracts to concrete
implementations.

## Agent adapters

An Agent node's `handler` identifies an adapter. The adapter receives:

- the run and node identity;
- a read-only state snapshot;
- the compiled Pack role and declared tool IDs;
- an abort signal;
- a governed `invokeTool` function.

It returns a state patch and optional model, token and cost metadata. The runtime
validates the patch against the node's declared `writes` before applying it.
Deterministic node handlers remain available for tests and non-model work.

## Tool governance

A tool call succeeds only when all of these conditions hold:

1. the Pack declares the tool and its risk level;
2. the Agent node includes the tool in `config.toolIds`;
3. the node's Pack role includes the tool in `allowedTools`;
4. a matching runtime adapter is registered;
5. the runtime authorizer approves the call.

Without an authorizer, only `read` tools are allowed. `draft`, `write` and
`external` tools require an explicit authorization decision. Requested,
started, completed, denied and failed tool calls produce ordered events.

## Secret boundary

Tool adapters declare `requiredSecrets`. The runtime resolves exactly those
names immediately before execution and passes an immutable value map to that
tool adapter. Agent adapters, graph state, Pack manifests and events never
receive the secret provider or resolved values.

The current interface protects framework boundaries; a production deployment
must still use an operating-system or cloud secret manager and restrict process
access appropriately.

## Durable runs

`SQLiteRunStore` persists run records, ordered events and the latest checkpoint.
The runtime updates the checkpoint after each completed scheduling batch. A new
runtime instance can call `resumeStored` after a process restart. Successful
completion clears the checkpoint while retaining the final run and event trace.

The CLI exposes this through `pack run --database` and `pack resume`.

## Reliability policies

Function and Agent nodes may declare a bounded timeout and retry policy in the
graph contract. Each attempt receives an abort signal. Retry, timeout and final
failure are recorded as ordered events so an adapter failure remains visible.

A caller may also pass a run-level abort signal. Cancellation is distinct from
failure: the run is stored as `cancelled`, the interrupted ready set is retained
in a checkpoint, and a later caller may resume it with a fresh signal.
