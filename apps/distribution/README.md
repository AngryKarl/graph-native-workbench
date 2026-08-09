# Graphwork

Graphwork is the zero-install distribution of
[Graphwork](https://github.com/AngryKarl/graphwork).
It connects executable Agent workflows to durable organizational context and
packages domain behavior as portable Industry Packs.

## Open the Workbench

Requires Node.js 24 or newer:

```bash
pnpm dlx graphwork
```

The command starts a local Workbench, opens it in your browser and stores its
workspace under `.graphwork` in the current directory. Choose another port or
disable automatic browser opening when needed:

```bash
pnpm dlx graphwork workbench --port 4311 --no-open
```

## See the graph runtime work

```bash
pnpm dlx graphwork demo
pnpm dlx graphwork demo --pause
```

## Create a standalone Industry Pack

```bash
pnpm dlx graphwork pack init customer_success
pnpm dlx graphwork pack validate packs/customer_success/src/index.mjs
pnpm dlx graphwork pack test packs/customer_success/src/index.mjs
pnpm dlx graphwork pack build packs/customer_success/src/index.mjs \
  --output customer_success-0.2.0.gpack
```

Run `pnpm dlx graphwork help` for the complete Pack lifecycle and signed
Registry commands. Documentation, examples and security boundaries are in the
[main repository](https://github.com/AngryKarl/graphwork).
