# Graphwork

Graphwork is the zero-install distribution of
[Graph Native Workbench](https://github.com/AngryKarl/graph-native-workbench).
It connects executable Agent workflows to durable organizational context and
packages domain behavior as portable Industry Packs.

## Open the Workbench

Requires Node.js 24 or newer:

```bash
pnpm dlx graphwork@next
```

The command starts a local Workbench, opens it in your browser and stores its
workspace under `.graphwork` in the current directory. Choose another port or
disable automatic browser opening when needed:

```bash
pnpm dlx graphwork@next workbench --port 4311 --no-open
```

## See the graph runtime work

```bash
pnpm dlx graphwork@next demo
pnpm dlx graphwork@next demo --pause
```

## Create a standalone Industry Pack

```bash
pnpm dlx graphwork@next pack init customer_success
pnpm dlx graphwork@next pack validate packs/customer_success/src/index.mjs
pnpm dlx graphwork@next pack test packs/customer_success/src/index.mjs
pnpm dlx graphwork@next pack build packs/customer_success/src/index.mjs \
  --output customer_success-0.1.0.gpack
```

Run `pnpm dlx graphwork@next help` for the complete Pack lifecycle and signed
Registry commands. Documentation, examples and security boundaries are in the
[main repository](https://github.com/AngryKarl/graph-native-workbench).
