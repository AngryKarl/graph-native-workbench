import { expect, test } from '@playwright/test';

test('runs, approves and preserves the default Industry Pack in a fresh Workbench', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Graph Native Workbench');
  await expect(page.getByLabel('Graph Native Workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run graph' })).toBeEnabled();

  await page.getByRole('button', { name: 'Run graph' }).click();
  await expect(page.getByText('Human decision required')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText(/completed · \d+ events/)).toBeVisible();

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
