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

## Model providers

The Workbench keeps deterministic execution as the default and can bind Agent
nodes to one of three wire protocols without changing Pack contracts:

| Protocol | Included presets |
| --- | --- |
| OpenAI-compatible chat completions | OpenAI, DeepSeek, Alibaba Qwen, Moonshot Kimi, xAI Grok, Mistral AI, Groq, OpenRouter, Ollama and custom endpoints |
| Anthropic Messages | Anthropic Claude |
| Gemini GenerateContent | Google Gemini |

Open **Models** to select a provider, model identifier and base URL. Cloud
credentials are read from the Workbench server environment (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`,
`DASHSCOPE_API_KEY`, `MOONSHOT_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`,
`GROQ_API_KEY` or `OPENROUTER_API_KEY`). They are not returned to the browser or
persisted in `.graph-workbench/workbench.json`. Custom compatible endpoints may use
`GRAPH_WORKBENCH_MODEL_API_KEY`; Ollama and other local endpoints can run without a
credential.

A Pack opts into model execution by adding `config.modelInstructions` to an
Agent node. The provider returns a JSON state patch, which remains constrained
by the node's declared `writes`. Provider, protocol, model, token counts,
latency and request ID are normalized into the ordered runtime event stream so
context projectors can preserve model-call provenance alongside deliverables.

## Model-directed tool loop

Model-backed Agent nodes receive only the Pack tools declared in the node's
`config.toolIds` and allowed by its role. OpenAI-compatible function calls,
Anthropic tool-use blocks and Gemini function calls are normalized into the
same internal request, then executed through the existing governed
`context.invokeTool` boundary.

Each request therefore passes the Pack declaration, node scope, role
permission, runtime adapter, risk authorization and secret checks described
below. Calls run in provider order so tools with side effects remain
predictable. Results are returned to the model until it produces the final
state patch or reaches the bounded tool-round limit. Usage metadata is summed
across model rounds.

Tool inputs and outputs are not copied into runtime events. Events contain the
tool identity, risk, outcome and safe error details. When policy requires
approval, the model exchange and completed tool results are serialized into the
run checkpoint. Resuming therefore continues the same provider conversation
without repeating the model request or already completed tools.

## Tool governance

A tool call succeeds only when all of these conditions hold:

1. the Pack declares the tool and its risk level;
2. the Agent node includes the tool in `config.toolIds`;
3. the node's Pack role includes the tool in `allowedTools`;
4. a matching runtime adapter is registered;
5. the runtime policy allows the call or a reviewer approves its bound request.

Typed tools additionally validate standard JSON Schema input and output around
the adapter boundary. Their query/command operation and idempotency mode are
included in safe runtime events; payloads remain outside the event stream.
Keyed commands receive the validated key through
`ToolExecutionContext.idempotencyKey`.

The default policy allows `read` tools and checkpoints `draft`, `write` and
`external` tools for approval. Requested, approval-requested, approval-resolved,
started, completed, denied and failed tool calls produce ordered events. Each
approval is bound to the run, node, role, tool and a SHA-256 digest of its input.

Workbench reads an optional `.graph-workbench/policy.json` file. Set
`GRAPH_WORKBENCH_POLICY` or pass `graph-workbench workbench --policy <file>` to use a
different path:

```json
{
  "formatVersion": 1,
  "defaultEffect": "deny",
  "rules": [
    {
      "id": "review-external-publication",
      "effect": "require-approval",
      "roleIds": ["publisher"],
      "toolIds": ["external_publish"],
      "risks": ["external"],
      "reason": "External publication requires a reviewer."
    },
    {
      "id": "allow-approved-readers",
      "effect": "allow",
      "risks": ["read"]
    }
  ]
}
```

Rules are evaluated in order and can select run, node, role, tool and risk.
The first match wins; otherwise `defaultEffect` applies. Policy can return
`allow`, `deny` or `require-approval`.

## Approval ownership

A Human node's existing `config.roleId` is its responsible Pack role. Runtime
callers may provide an `ActorIdentity` in `RunOptions.actor`; workspace owners
may resolve any checkpoint, while members must carry the required role ID.
The runtime rejects a mismatched actor before resuming a stored checkpoint.

`human.requested` records the required role. `human.resolved`,
`tool.approval_resolved`, `run.started` and `run.resumed` record the acting
identity when supplied, so portable audit bundles retain both responsibility
and action. Calls without an actor remain compatible with pre-0.4 integrations,
but do not produce attributable approval evidence.

The local Workbench persists a workspace identity directory. The **Team** view
assigns Pack roles and selects the current identity, and every human or tool
decision records that identity. Workspace owners manage the directory; Pack
role assignments determine who may resolve each checkpoint. This selector is
for local and trusted-team operation. An internet-facing deployment must derive
`ActorIdentity` from an authenticated principal; the identity object is an
authorization input, not an authentication mechanism.

## Secret boundary

Tool adapters declare `requiredSecrets`. The runtime resolves exactly those
names immediately before execution and passes an immutable value map to that
tool adapter. Agent adapters, graph state, Pack manifests and events never
receive the secret provider or resolved values.

The current interface protects framework boundaries; a production deployment
must still use an operating-system or cloud secret manager and restrict process
access appropriately.

## Durable runs

`SQLiteRunStore` provides zero-setup local persistence. `PostgresRunStore`
implements the same interface for shared deployments; `PostgresContextGraphStore`
does the same for typed context objects and relations. Both PostgreSQL stores
initialize the versioned Graph Workbench schema and preserve the contract validation
used by the in-memory and SQLite adapters.

The runtime updates the checkpoint after each completed scheduling batch. A new
runtime instance can call `resumeStored` after a process restart. Successful
completion clears the checkpoint while retaining the final run and event trace.

The Workbench uses a separate `ContextGraphStore` as its organizational context
authority. With no configuration it creates `context.sqlite` next to
`workbench.json`, migrates legacy per-run projections idempotently, writes every
new approved projection to that authority and continues to keep the run-local
snapshot for portable audits. Set `GRAPH_WORKBENCH_CONTEXT_DATABASE` to a
PostgreSQL URL for a shared authority, or to an explicit SQLite file path.

## Trigger and wait adapters

`GraphTriggerDispatcher` validates webhook bodies, schedule occurrences and
typed external events before a Run starts. The Workbench exposes the same paths:

```text
POST|PUT|PATCH /hooks<Pack-declared path>
POST           /api/triggers/:packId/:graphId/schedule
POST           /api/events
POST           /api/runs/:runId/resume
```

Schedule requests contain `{ "id": "stable-occurrence-id", "scheduledFor":
"<ISO timestamp>" }`. A cron service, cloud scheduler or queue adapter evaluates
the Pack's cron expression and calls this endpoint; the kernel does not create a
second calendar scheduler. Event requests use the versioned `ExternalEvent`
contract: `id`, `type`, optional `correlationKey`, `payload` and `occurredAt`.
Webhook senders may provide a stable `Idempotency-Key` header; retries with the
same key resolve to the same Run before handlers execute.

Timer due times, event correlation data, nested subgraph checkpoints and
consumed event IDs live in the existing graph checkpoint. `resumeStored` can
therefore continue after a process restart. Durable wait time is excluded from
the active `maxDurationMs` budget; each resumed execution window and every child
graph still enforces its own duration and step budgets.

The CLI exposes this through `pack run --database` and `pack resume`.

```bash
graph-workbench pack run packs/research/src/index.ts \
  --database "$GRAPH_WORKBENCH_POSTGRES_URL" --set "goal=Durable team workflow"
graph-workbench pack resume packs/research/src/index.ts \
  --database "$GRAPH_WORKBENCH_POSTGRES_URL" --run <run-id> --decision approval=true
```

## Distributed PostgreSQL workers

`PostgresRunQueue` delegates job leases, heartbeats, expiry and retry recovery to
pg-boss rather than implementing another queue protocol. A queued request is a
versioned contract binding the run, Pack and graph versions to serializable
input. Workers reject requests for a different Pack or graph version.

Start one or more workers with the same installed Pack and PostgreSQL database:

```bash
graph-workbench worker start research --installed \
  --database "$GRAPH_WORKBENCH_POSTGRES_URL" --concurrency 4
```

Then enqueue work from any machine that has the same Pack contract:

```bash
graph-workbench pack enqueue research --installed \
  --database "$GRAPH_WORKBENCH_POSTGRES_URL" --set "goal=Review the operating model"
```

Workers persist checkpoints through `PostgresRunStore`. A failed job is retried
from its latest checkpoint; a crash after a completed or paused run is handled
idempotently. Human and governed tool checkpoints remain explicit and can be
resumed with `pack resume`.

## Portable audit bundles

Every Workbench run can be exported from the execution console as a portable
JSON audit bundle. It contains run identity and state, ordered events, the
current checkpoint when present, portable artifacts, projected context objects
and relations, and a canonical SHA-256 integrity digest. Tool secrets and raw
tool inputs remain outside the bundle.

SQLite- and PostgreSQL-backed CLI runs use the same format:

```bash
graph-workbench audit export --database runs.sqlite --run <run-id> --output run.audit.json
graph-workbench audit verify run.audit.json
```

Verification checks the digest, run identity, event ordering, checkpoint and
typed context records. The digest detects accidental or malicious modification;
it is not a publisher signature or timestamp-authority proof.

## Reliability policies

Function and Agent nodes may declare a bounded timeout and retry policy in the
graph contract. Each attempt receives an abort signal. Retry, timeout and final
failure are recorded as ordered events so an adapter failure remains visible.

A caller may also pass a run-level abort signal. Cancellation is distinct from
failure: the run is stored as `cancelled`, the interrupted ready set is retained
in a checkpoint, and a later caller may resume it with a fresh signal.
