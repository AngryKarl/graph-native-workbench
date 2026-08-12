import { expect, test } from '@playwright/test';

test('moves a node continuously and persists its final position', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node[data-id="start"]');
  await expect(node).toBeVisible();

  const before = await node.boundingBox();
  if (!before) throw new Error('Start node is missing a measurable position.');
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const samples: Array<{ x: number; y: number }> = [];

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 15, start.y - step * 7.5);
    const position = await node.boundingBox();
    if (!position) throw new Error(`Start node disappeared during drag step ${step}.`);
    samples.push({ x: position.x, y: position.y });
  }
  await page.mouse.up();

  const finalFlowPosition = await node.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });

  for (let index = 1; index < samples.length; index += 1) {
    expect(samples[index]!.x).toBeGreaterThan(samples[index - 1]!.x);
    expect(samples[index]!.y).toBeLessThan(samples[index - 1]!.y);
  }
  const final = samples.at(-1)!;
  expect(final.x - before.x).toBeGreaterThanOrEqual(100);
  expect(final.y - before.y).toBeLessThanOrEqual(-50);
  await expect(page.getByText('dirty', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('saved', { exact: true })).toBeVisible();
  const workspace = await page.request.get('/api/workbench');
  expect(workspace.ok()).toBe(true);
  const saved = await workspace.json() as { activePack: { positions: Record<string, { x: number; y: number }> } };
  expect(saved.activePack.positions.start?.x).toBeCloseTo(finalFlowPosition.x, 3);
  expect(saved.activePack.positions.start?.y).toBeCloseTo(finalFlowPosition.y, 3);

  await page.reload();
  const persistedFlowPosition = await node.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  expect(persistedFlowPosition.x).toBeCloseTo(finalFlowPosition.x, 3);
  expect(persistedFlowPosition.y).toBeCloseTo(finalFlowPosition.y, 3);
});

test('runs, approves and preserves the default Industry Pack in a fresh Workbench', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Graph Workbench');
  await expect(page.getByLabel('Graph Workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run graph' })).toBeEnabled();

  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Human decision required')).toBeVisible();
  await expect(page.getByText('Assigned to Design reviewer. Approving as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText(/completed · \d+ events/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand console' })).toBeVisible();
  await expect(page.locator('.console-body')).toHaveCount(0);
  await page.locator('.app-nav button[title="Context"]').click();
  await expect(page.getByRole('heading', { name: 'Context graph' })).toBeVisible();
  await expect(page.getByText('Objects', { exact: true })).toBeVisible();
  await expect(page.getByText('Relations', { exact: true })).toBeVisible();

  await page.locator('.app-nav button[title="Packs"]').click();
  const customerSuccessCard = page.getByRole('article').filter({ hasText: 'Customer Success Renewal Pack' });
  await customerSuccessCard.getByRole('button', { name: 'Install Pack' }).click();
  await expect(page.getByRole('combobox').first()).toHaveValue('customer_success');
  await expect(page.getByText('Customer Success Renewal Pack installed and opened.')).toBeVisible();
  await expect(page.getByLabel('Active workflow')).toHaveValue('customer_success.renewal_workflow');
  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Human decision required')).toBeVisible();
  await expect(page.getByText('Assigned to Revenue owner. Approving as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await page.getByRole('button', { name: 'output', exact: true }).click();
  await expect(page.getByText('1 portable artifact', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Renewal success plan — Northstar Logistics' })).toBeVisible();
  await page.locator('.app-nav button[title="Context"]').click();
  await expect(page.getByRole('heading', { name: 'Northstar Logistics' })).toBeVisible();
  await expect(page.getByText('2 approved runs', { exact: true })).toBeVisible();
  await expect(page.locator('.relation-list').getByText('decision_governs', { exact: true }).first()).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('manages a team identity and attributes its approval', async ({ page }) => {
  await page.goto('/');
  await page.locator('.app-nav button[title="Team"]').click();
  await expect(page.getByText('Team identities', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add identity' }).click();
  await page.getByLabel('Identity ID').fill('member.revenue');
  await page.getByLabel('Display name').fill('Revenue reviewer');
  await page.getByLabel('Revenue owner').check();
  await page.getByRole('button', { name: 'Save identity' }).click();
  await expect(page.getByText('Revenue reviewer saved.')).toBeVisible();

  await page.getByLabel('Active identity').selectOption('member.revenue');
  await expect(page.getByText('Active identity changed to Revenue reviewer.')).toBeVisible();
  await page.locator('.app-nav button[title="Editor"]').click();
  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Assigned to Revenue owner. Approving as Revenue reviewer.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText(/completed · \d+ events/)).toBeVisible();
});

test('accepts webhook, schedule and typed-event ingress through the Workbench API', async ({ request }) => {
  const webhook = await request.post('/hooks/architecture/feedback-followup', {
    headers: { 'idempotency-key': 'e2e-feedback-hook-1' },
    data: { project_name: 'API civic hub', feedback_case_id: 'e2e-feedback-1' },
  });
  expect(webhook.ok()).toBe(true);
  const webhookBody = await webhook.json();
  expect(webhookBody).toMatchObject({
    status: 'paused',
    pendingWait: { mode: 'event', eventType: 'design.feedback.received', correlationKey: 'e2e-feedback-1' },
  });
  const webhookReplay = await request.post('/hooks/architecture/feedback-followup', {
    headers: { 'idempotency-key': 'e2e-feedback-hook-1' },
    data: { project_name: 'API civic hub', feedback_case_id: 'e2e-feedback-1' },
  });
  expect((await webhookReplay.json()).runId).toBe(webhookBody.runId);

  const event = await request.post('/api/events', {
    data: {
      id: 'e2e-feedback-event-1',
      type: 'design.feedback.received',
      correlationKey: 'e2e-feedback-1',
      payload: { decision: 'continue' },
      occurredAt: '2026-08-11T03:00:00.000Z',
    },
  });
  expect(event.ok()).toBe(true);
  expect(await event.json()).toMatchObject({ resumed: [{ status: 'completed', state: { summary: expect.stringContaining('continue') } }] });

  const schedule = await request.post('/api/triggers/customer_success/customer_success.scheduled_health_scan/schedule', {
    data: { id: 'e2e-health-scan-1', scheduledFor: '2026-08-11T08:00:00.000Z' },
  });
  expect(schedule.ok()).toBe(true);
  expect(await schedule.json()).toMatchObject({ status: 'completed', state: { scan_attempt: 2 } });
});
