# Graph Workbench

Graph Workbench is the zero-install distribution of
[Graph Workbench](https://github.com/AngryKarl/graph-workbench).
It connects executable Agent workflows to durable organizational context and
packages domain behavior as portable Industry Packs.

## Open the Workbench

Requires Node.js 24 or newer:

```bash
pnpm dlx graph-workbench
```

The command starts a local Workbench, opens it in your browser and stores its
workspace under `.graph-workbench` in the current directory. Choose another port or
disable automatic browser opening when needed:

```bash
pnpm dlx graph-workbench workbench --port 4311 --no-open
```

## See the graph runtime work

```bash
pnpm dlx graph-workbench demo
pnpm dlx graph-workbench demo --pause
```

## Create a standalone Industry Pack

```bash
pnpm dlx graph-workbench pack init customer_success
pnpm dlx graph-workbench pack validate packs/customer_success/src/index.mjs
pnpm dlx graph-workbench pack test packs/customer_success/src/index.mjs
pnpm dlx graph-workbench pack build packs/customer_success/src/index.mjs \
  --output customer_success-0.3.0.gpack
```

Run `pnpm dlx graph-workbench help` for the complete Pack lifecycle and signed
Registry commands. Documentation, examples and security boundaries are in the
[main repository](https://github.com/AngryKarl/graph-workbench).
