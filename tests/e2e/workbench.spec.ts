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
  await page.reload();
  const persisted = await node.boundingBox();
  if (!persisted) throw new Error('Start node is missing after reloading the saved graph.');
  expect(persisted.x).toBeCloseTo(final.x, 0);
  expect(persisted.y).toBeCloseTo(final.y, 0);
});

test('runs, approves and preserves the default Industry Pack in a fresh Workbench', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Graphwork');
  await expect(page.getByLabel('Graphwork')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run graph' })).toBeEnabled();

  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Human decision required')).toBeVisible();
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
  await expect(page.getByText('Evidence-based renewal workflow')).toBeVisible();
  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Human decision required')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await page.getByRole('button', { name: 'output', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Renewal success plan — Northstar Logistics' })).toBeVisible();
  await page.locator('.app-nav button[title="Context"]').click();
  await expect(page.getByRole('heading', { name: 'Northstar Logistics' })).toBeVisible();
  await expect(page.getByText('decision_governs', { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
