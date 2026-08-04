# Contributing

Thank you for helping build reusable infrastructure for complex industry work.
Early contributions have unusual leverage because the public Pack contract is
still pre-1.0.

## Before coding

For a bug, include a minimal graph or Pack and the observed event trace. For a
new mechanism or public contract, open a proposal first and explain why it
cannot live in an adapter or Industry Pack.

Read the Product Charter and keep the central boundary intact:

- generic execution, governance and provenance mechanisms belong in the core;
- industry nouns, workflows and evaluation meaning belong in Packs.

## Local workflow

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm demo
```

Pull requests should be focused, explain user-visible behavior, include tests
for failure as well as success, and update documentation when a public contract
changes. Do not add a dependency when a small platform API is sufficient.

## Good first contributions

- improve an actionable validation error;
- add a domain-neutral compiler invariant;
- contribute an example or Industry Pack fixture;
- implement a storage, Agent or tool adapter behind an existing interface;
- improve onboarding documentation or cross-platform behavior.

By participating, you agree to follow the Code of Conduct. Contributions are
licensed under the repository's MIT License.
