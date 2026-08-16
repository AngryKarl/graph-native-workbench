# Roadmap

Graph Workbench's first public alpha is available. The roadmap separates what ships
today from the evidence still required before a stable 1.0 release.

## Public-alpha release candidate

- [x] Dual execution and context graph contracts
- [x] Parallel execution, joins, routing and human checkpoints
- [x] Typed state permissions, retry, timeout, cancellation and resumable runs
- [x] Provider-neutral model execution and governed tool loops
- [x] Memory, SQLite and PostgreSQL persistence
- [x] Distributed PostgreSQL workers and reference deployment
- [x] Visual graph authoring, run history, approvals and context exploration
- [x] Portable `.gpack` lifecycle with compatibility and integrity checks
- [x] Signed Registry verification and isolated third-party Pack execution
- [x] Six standard industry Packs plus Architecture, Customer Success and Research authoring examples
- [x] Clean-install, browser E2E, performance and release-readiness gates

## Public launch

- [x] Publish the `0.2.0-rc.1` npm release under the `next` tag
- [x] Promote the verified public alpha as `0.2.0` under the `latest` tag
- [x] Make the GitHub repository public and enable Discussions and private
  vulnerability reporting
- [x] Activate and verify the signed Reference Registry on GitHub Pages
- [x] Publish the first maintained `good first issue` set
- [x] Ship the `0.2.1` graph-editing interaction polish patch
- [ ] Collect onboarding feedback from external Pack authors

## 0.4 — organizational context and governed boundaries

- [x] Aggregate persisted context across runs in the Workbench API and explorer
- [x] Add storage-neutral context query and traversal
- [x] Add workspace identity, role assignment and approval ownership
- [x] Define typed connector operations, results, permissions and idempotency
- [x] Validate portable Artifact and Evidence contracts across Packs

## 0.5 — durable event-driven orchestration

- [x] Add webhook, schedule and typed event triggers
- [x] Add durable wait/timer and event-correlation checkpoints
- [x] Add reusable subgraphs with explicit state boundaries
- [x] Add budgeted loops and dynamic map execution
- [x] Add visible escalation and compensation paths

The evidence, boundary decision and acceptance criteria behind these milestones
are recorded in the [industry workflow analysis](docs/INDUSTRY_WORKFLOW_ANALYSIS.md).

## 0.6 — visual semantics and Pack system maps

- [x] Give Agents, gates, routers, joins, waits, composites and recovery nodes distinct visual grammar
- [x] Add semantic zoom and stage-aware automatic layout for complex workflows
- [x] Expose every graph, trigger, reusable dependency and deliverable in a Pack-level system map
- [x] Allow direct editing and execution of every graph in a multi-graph Pack
- [x] Refresh the six first-party Pack gallery images with the visual-semantic canvas

## Six-industry standard Pack program

- [x] Professional Software Delivery — issue-to-release governance and deployment recovery
- [x] Data and MLOps — asset release, lineage, quality gates and backfill control
- [x] Cybersecurity Operations — signal-to-recovery incident response
- [x] Quantitative Finance — research-to-reconciled execution governance
- [x] Healthcare Diagnostics — consent-aware request-to-report coordination
- [x] Robotics and Fleet Operations — request-to-dispatch, replanning and maintenance

These first-party Packs are built and tested in this repository. External users
may validate them, but their implementation is not a prerequisite for progress.

## 0.6 — depth in one industry

The six-industry program proved the kernel generalizes. It did not prove the
project can take over real work: every standard Pack's adapters returned
deterministic values. Development is now focused on making Professional Software
Delivery genuinely usable rather than adding a seventh industry.

- [x] Ship the first real connector (GitHub) behind the existing Pack contract
- [x] Resolve tool credentials through the declared secret boundary
- [x] Keep the credential-free first run unchanged when a token is present
- [x] State how far each Pack reaches, instead of listing them as equals
- [ ] Trigger a run from a GitHub webhook instead of a manual start
- [ ] Bind workspace identity to GitHub, mapping approvals to CODEOWNERS
- [ ] Move Workbench run and event storage to the existing SQLite run store
- [ ] Measure how many first runs reach an outcome

The acceptance test for this milestone is not "issue to release runs". It is
**a second run reusing the first run's approved release context**, because that
is the capability branch protection does not have.

## Before stable 1.0

- [x] Complete and validate all six first-party standard Industry Packs
- [ ] Complete one real team pilot using shared PostgreSQL execution
- [ ] Bind workspace identities to production authentication and authorization
- [ ] Publish compatibility guarantees for stable Pack contracts
- [ ] Measure first-run success and Pack-authoring completion time
- [ ] Complete an independent security review of Pack isolation and Registry
  trust boundaries

Priorities may change as public usage provides evidence. Domain-specific
capabilities continue to ship as Packs; the core remains focused on execution,
governance, provenance and portable extension contracts.
