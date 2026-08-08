# Performance budgets

Graphwork keeps a deterministic, zero-network baseline in CI so regressions in
the kernel remain visible without depending on a model provider or database.

Run it with:

```bash
pnpm perf:check
```

| Reference operation | Samples | p95 budget |
| --- | ---: | ---: |
| Compile the Research Pack | 100 | 20 ms |
| Run the complete deterministic Research workflow | 20 | 150 ms |
| Project its typed context graph in memory | 30 | 50 ms |

On 7 August 2026, the development Windows machine measured p95 values of
0.58 ms, 0.49 ms and 0.53 ms respectively. Those numbers are observations, not
promises; the wider budgets are cross-platform release gates.

This suite measures framework overhead. It intentionally excludes model and
tool network latency, PostgreSQL round trips, container startup and Pack-specific
business logic. Deployment owners should add workload tests for those boundaries.
