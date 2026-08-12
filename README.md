# Graph Workbench

**Build governed AI workflows that remember why every decision was made.**

[![CI](https://img.shields.io/github/actions/workflow/status/AngryKarl/graph-workbench/ci.yml?branch=main&label=CI)](https://github.com/AngryKarl/graph-workbench/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/graph-workbench)](https://www.npmjs.com/package/graph-workbench)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Industry Packs](https://img.shields.io/badge/standard%20Industry%20Packs-6-6f42c1)](docs/PACK_GALLERY.md)

[简体中文](README.zh-CN.md) · [Pack Gallery](docs/PACK_GALLERY.md) · [Why two graphs?](docs/WHY_TWO_GRAPHS.md) · [Roadmap](ROADMAP.md)

Graph Workbench is an open-source, graph-native workbench for complex industry
work. It turns an SOP into an executable graph of **Agents, functions, tools,
human decisions and recovery paths**, then projects approved work into a durable
**organizational context graph** of evidence, decisions, artifacts and provenance.

Package the complete operating model—ontology, roles, tools, workflows, quality
rules, fixtures and deliverables—as an installable **Industry Pack**.

![A Robotics and Fleet Operations run paused at an accountable safety decision](docs/assets/product-journey-approval.png)

## What makes it different

Many workflow tools stop when a run finishes. Graph Workbench connects the graph
that performs the work to the graph that preserves what the organization learned.

| A workflow answers | Graph Workbench also preserves |
| --- | --- |
| What runs next? | Why it ran, which policy applied and who approved it |
| What did the Agent produce? | Which sources, tools and decisions made the result valid |
| How does data move? | Versioned objects and relations that survive the run |
| Can I export a flow? | Can I install an entire industry operating model? |

- **Execution graph + context graph** — coordinate work and retain its evidence,
  provenance, versions, decisions and reusable artifacts.
- **Real governance** — role-owned human gates, tool-risk approvals, retries,
  durable checkpoints, escalation, compensation and integrity-checked audit bundles.
- **Installable Industry Packs** — ship domain semantics without forking the
  kernel or replacing specialist systems.
- **Provider-neutral Agents** — use the zero-key deterministic runtime or connect
  OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Kimi, Grok, Mistral, Groq,
  OpenRouter, Ollama or an OpenAI-compatible endpoint.

## Quick start

Requires Node.js 24+. No account, database or model key is required.

```bash
npx graph-workbench
```

The Workbench opens in your browser and stores everything locally under
`.graph-workbench`. To run the zero-key terminal demo instead:

```bash
npx graph-workbench demo
```

The `0.4.0` public alpha includes the complete six-Pack catalog and Pack system
map. To work from source:

```bash
git clone https://github.com/AngryKarl/graph-workbench.git
cd graph-workbench
corepack enable
pnpm install
pnpm workbench
```

## One run becomes reusable organizational context

The screenshots below come from the real Robotics and Fleet Operations Pack:
parallel robot bidding, Agent allocation, resource reservation, an accountable
safety gate, external dispatch, a portable artifact and a typed context graph.

| Human decision | Portable deliverable | Durable context graph |
| --- | --- | --- |
| ![Safety-supervisor approval](docs/assets/product-journey-approval.png) | ![SHA-256-bound fleet dispatch artifact](docs/assets/product-journey-output.png) | ![Fleet objects, relations and provenance](docs/assets/product-journey-context.png) |

## Six executable industry Packs

Every standard Pack includes real handlers, typed tools, success and rejection
fixtures, recovery behavior, deliverables and a connected context projection.
They run without external credentials and keep specialist execution authority
outside Graph Workbench.

![Six standard Industry Packs in the Workbench](docs/assets/reference-packs.png)

| Industry Pack | Representative information flow |
| --- | --- |
| [Professional Software Delivery](docs/PACK_GALLERY.md#professional-software-delivery) | Issue → parallel verification → code/release approvals → deploy → observe or rollback |
| [Data and MLOps Asset Release](docs/PACK_GALLERY.md#data-and-mlops-asset-release) | Partitions → quality and lineage → approval → registry → backfill or recovery |
| [Cybersecurity Incident Response](docs/PACK_GALLERY.md#cybersecurity-incident-response) | Signal → evidence → declare → contain → recover → compensate and learn |
| [Quantitative Finance Governance](docs/PACK_GALLERY.md#quantitative-finance-governance) | Hypothesis → instrument backtests → risk/compliance/execution gates → reconcile fills |
| [Healthcare Diagnostic Coordination](docs/PACK_GALLERY.md#healthcare-diagnostic-coordination) | Consent → parallel advisory analysis → specialist decision → report → safe follow-up |
| [Robotics and Fleet Operations](docs/PACK_GALLERY.md#robotics-and-fleet-operations) | Task → robot bid Map → safety approval → dispatch → telemetry → bounded replan |

[Open the full gallery of executable graphs →](docs/PACK_GALLERY.md)

## Nodes are executable semantics, not canvas decoration

The public graph contract covers:

- **work:** `agent`, `function`, `human`;
- **control:** `router`, `join`, `map`, `loop`, `subgraph`;
- **long-running work:** webhook, schedule and typed-event `trigger`, plus
  durable timer or correlated-event `wait`;
- **recovery:** `escalation` and `compensation`.

Pack validation checks every declared executable node for a real handler binding,
including nodes not reached by a happy-path fixture. Compiler, runtime and Pack
tests cover the behavior behind every node kind. See the
[node runtime conformance matrix](docs/NODE_RUNTIME_CONFORMANCE.md).

## Industry Packs are the extension boundary

An Industry Pack bundles:

1. a domain ontology and context relations;
2. roles and responsibility boundaries;
3. typed query and command tools;
4. one or more execution graphs;
5. quality evaluations and human gates;
6. zero-key golden fixtures;
7. deliverables and a context projector.

Create and validate one without changing the kernel:

```bash
pnpm graph-workbench pack init claims_operations
pnpm graph-workbench pack validate packs/claims_operations/src/index.ts
pnpm graph-workbench pack test packs/claims_operations/src/index.ts
```

Packs can be packaged as integrity-checked `.gpack` artifacts or published
through an Ed25519-signed Registry. Third-party handlers and projectors run in
network-denied, read-only containers by default.

## Architecture

```mermaid
flowchart LR
  SOP["SOP + roles + tools + quality rules"] --> Pack["Industry Pack"]
  Pack --> Execution["Execution graph"]
  Execution --> Events["Events + durable checkpoints"]
  Execution --> Artifact["Approved artifact"]
  Events --> Context["Organizational context graph"]
  Artifact --> Context
  Context --> Future["Future runs and decisions"]
  Future --> Execution
```

The kernel owns execution, governance, provenance and portable contracts.
Industry Packs own business semantics. GitHub, CI runners, SIEM/EDR, Airflow,
FHIR/PACS, trading systems and robot middleware remain specialist authorities
connected through typed adapters.

For teams, execution and context can use PostgreSQL with durable workers,
leases, heartbeats and resumable checkpoints. Local use defaults to SQLite and
requires no infrastructure.

## Documentation

- [Why execution and context graphs must connect](docs/WHY_TWO_GRAPHS.md)
- [Industry workflow analysis](docs/INDUSTRY_WORKFLOW_ANALYSIS.md)
- [Pack Authoring Guide](docs/PACK_AUTHORING.md)
- [Runtime and trigger adapters](docs/RUNTIME_ADAPTERS.md)
- [Trust, Registry and isolation boundary](docs/TRUST_AND_ISOLATION.md)
- [Reference deployment](docs/DEPLOYMENT.md)
- [Product Charter](docs/PRODUCT_CHARTER.md) and [Roadmap](ROADMAP.md)

## Contributing

Graph Workbench is a young public alpha. The most useful contributions are new
Industry Pack fixtures, connector adapters, validation improvements and evidence
from real operating workflows. Start with [CONTRIBUTING.md](CONTRIBUTING.md) or
an issue labeled [`good first issue`](https://github.com/AngryKarl/graph-workbench/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22).

If graph-native industry work is a direction you want to see develop, star the
repository and tell us which Industry Pack should come next in
[Discussions](https://github.com/AngryKarl/graph-workbench/discussions).

MIT licensed. See [SECURITY.md](SECURITY.md), [GOVERNANCE.md](GOVERNANCE.md)
and [SUPPORT.md](SUPPORT.md).
