# Professional Software Delivery Pack

This Pack governs the path from an accepted work item to an approved release and
post-deployment evidence. It complements source control, CI/CD and observability;
it does not replace them.

The reference workflow includes:

- testable requirement intake and explicit delivery-risk classification;
- a bounded, reversible change plan;
- concurrent unit, integration, security and supply-chain verification;
- independent code-owner and release-manager approval;
- a portable release-readiness record;
- typed deployment observation with visible incident escalation and rollback.

Run every zero-key fixture:

```bash
pnpm graph-workbench pack test packs/software-delivery/src/index.ts
```

Run the standard feature demo:

```bash
pnpm graph-workbench pack demo packs/software-delivery/src/index.ts \
  --fixture standard_feature_release
```

The declared tools map to issue tracking, source control and deployment systems.
The bundled adapters are deterministic reference implementations. Production
teams replace the adapters while keeping the Pack contract, roles, quality gates
and context projection stable.

The workflow follows current software-delivery practices: protected source and
review rules, evidence-based release gates, immutable supply-chain provenance,
post-deployment health feedback and balanced delivery performance measures. It
does not claim a SLSA level; a production connector must verify the actual build
platform, artifact digest and attestation.

References:

- [DORA software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
- [SLSA specification 1.2](https://slsa.dev/spec/v1.2/)
- [GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
