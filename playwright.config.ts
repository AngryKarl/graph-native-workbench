import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const workspace = resolve('.graph-workbench/e2e');
const runId = `${process.pid}-${randomUUID()}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/playwright',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm graph-workbench workbench --port 4317 --no-open',
    url: 'http://127.0.0.1:4317/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      GRAPH_WORKBENCH_DATA: resolve(workspace, `workbench-${runId}.json`),
      GRAPH_WORKBENCH_PACKS: resolve(workspace, `packs-${runId}`),
      GRAPH_WORKBENCH_TRUST: resolve(workspace, `trust-${runId}.json`),
      GRAPH_WORKBENCH_POLICY: resolve(workspace, `policy-${runId}.json`),
    },
  },
});
