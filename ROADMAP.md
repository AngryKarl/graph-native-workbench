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
- [x] Software Delivery, Data and MLOps, Research, Architecture and Customer Success reference Packs
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

## Six-industry standard Pack program

- [x] Professional Software Delivery — issue-to-release governance and deployment recovery
- [x] Data and MLOps — asset release, lineage, quality gates and backfill control
- [ ] Cybersecurity Operations — signal-to-recovery incident response
- [ ] Quantitative Finance — research-to-reconciled execution governance
- [ ] Healthcare Diagnostics — consent-aware request-to-report coordination
- [ ] Robotics and Fleet Operations — request-to-dispatch, replanning and maintenance

These first-party Packs are built and tested in this repository. External users
may validate them, but their implementation is not a prerequisite for progress.

## Before stable 1.0

- [ ] Complete and validate all six first-party standard Industry Packs
- [ ] Complete one real team pilot using shared PostgreSQL execution
- [ ] Bind workspace identities to production authentication and authorization
- [ ] Publish compatibility guarantees for stable Pack contracts
- [ ] Measure first-run success and Pack-authoring completion time
- [ ] Complete an independent security review of Pack isolation and Registry
  trust boundaries

Priorities may change as public usage provides evidence. Domain-specific
capabilities continue to ship as Packs; the core remains focused on execution,
governance, provenance and portable extension contracts.
