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
- [x] Research, Architecture and Customer Success reference Packs
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

## Before stable 1.0

- [ ] Validate at least three independently authored Industry Packs
- [ ] Complete one real team pilot using shared PostgreSQL execution
- [ ] Add team identity, workspace authorization and approval ownership
- [ ] Publish compatibility guarantees for stable Pack contracts
- [ ] Measure first-run success and Pack-authoring completion time
- [ ] Complete an independent security review of Pack isolation and Registry
  trust boundaries

Priorities may change as public usage provides evidence. Domain-specific
capabilities continue to ship as Packs; the core remains focused on execution,
governance, provenance and portable extension contracts.
