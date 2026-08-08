# Good first issues

These contribution slices are intentionally small, testable and independent of
unpublished product plans. Maintainers should keep the matching GitHub issues
labeled `good first issue` and `help wanted`.

## Add a fixture to the Customer Success Pack

Add a zero-key fixture for a mid-market renewal with incomplete stakeholder
coverage. The fixture should pass the existing graph without changing the core,
exercise at least one medium-risk path and assert a visible deliverable detail.

Acceptance:

- only `packs/customer-success` and its tests change;
- `pnpm graphwork pack test packs/customer-success/src/index.ts` passes;
- the fixture documents why it represents a realistic renewal workflow.

## Improve one validation error with an actionable path

Choose a compiler or Pack validation error that currently names the invalid
field but not the corrective action. Add one focused failing test, improve the
message and keep the underlying validation contract unchanged.

Acceptance:

- the test proves the previous error was insufficient;
- the new error names the object, expected value and next action;
- no new dependency or validation layer is introduced.

## Add a community Pack recipe

Write a short Pack recipe for an industry workflow you understand. Define the
SOP, roles, evidence, blocking quality gate, deliverable and a single golden
fixture. A recipe may remain documentation-only until a maintainer confirms the
domain boundary.

Acceptance:

- uses the template in [Pack Authoring](PACK_AUTHORING.md);
- identifies at least one human decision and one provenance relation;
- contains no proprietary data or unverifiable compliance claim.

## Contribution workflow

Comment on the GitHub issue before starting. Maintainers will confirm scope and
point to the closest existing implementation. See [Contributing](../CONTRIBUTING.md)
and [Extension points](EXTENSION_POINTS.md).
