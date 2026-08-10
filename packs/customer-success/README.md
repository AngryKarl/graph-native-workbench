# Customer Success Renewal Pack

An executable customer-success workflow for turning account health signals,
stakeholder evidence and renewal context into a reviewed renewal success plan.

From the repository root:

```bash
pnpm graph-workbench pack inspect packs/customer-success/src/index.ts
pnpm graph-workbench pack test packs/customer-success/src/index.ts
pnpm graph-workbench pack demo packs/customer-success/src/index.ts --fixture enterprise_renewal
```

The Pack runs without a model key. It analyzes product and stakeholder signals
in parallel, records a renewal-risk assessment, develops an intervention plan,
pauses for revenue-owner approval and projects the approved plan into the
context graph with evidence and decision provenance.
