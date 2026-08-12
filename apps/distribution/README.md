# Graph Workbench

**Build governed AI workflows that remember why every decision was made.**

Graph Workbench connects an execution graph of Agents, functions, tools and
human decisions to a durable organizational context graph of evidence,
provenance, decisions and approved artifacts. Complete operating models ship as
installable Industry Packs.

[Explore the six executable reference Packs](https://github.com/AngryKarl/graph-workbench/blob/main/docs/PACK_GALLERY.md)
or [read why the two graphs belong together](https://github.com/AngryKarl/graph-workbench/blob/main/docs/WHY_TWO_GRAPHS.md).

## Open the Workbench

Requires Node.js 24 or newer:

```bash
npx graph-workbench
```

The command starts a local Workbench, opens it in your browser and stores its
workspace under `.graph-workbench` in the current directory. Choose another port or
disable automatic browser opening when needed:

```bash
npx graph-workbench workbench --port 4311 --no-open
```

No account, database or model key is required. The default deterministic
runtime produces a visible result immediately; provider-neutral Agents can
later connect to hosted or local models.

## See the graph runtime work

```bash
npx graph-workbench demo
npx graph-workbench demo --pause
```

## Create a standalone Industry Pack

```bash
npx graph-workbench pack init customer_success
npx graph-workbench pack validate packs/customer_success/src/index.mjs
npx graph-workbench pack test packs/customer_success/src/index.mjs
npx graph-workbench pack run packs/customer_success/src/index.mjs --set topic=hello
npx graph-workbench pack build packs/customer_success/src/index.mjs \
  --output customer_success-0.1.0.gpack
```

Run `npx graph-workbench help` for the complete Pack lifecycle and signed
Registry commands. Documentation, examples and security boundaries are in the
[main repository](https://github.com/AngryKarl/graph-workbench).
