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
    expect(samples[index]!.x).toBeGreaterThanOrEqual(samples[index - 1]!.x);
    // React Flow applies pointer updates on animation frames, so one sample may
    // briefly trail the pointer without indicating a visible drag reversal.
    expect(samples[index]!.y).toBeLessThanOrEqual(samples[index - 1]!.y + 10);
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

test('guides a fresh Workbench from sample run to outcome and context', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Graph Workbench');
  await expect(page.getByLabel('Graph Workbench')).toBeVisible();
  await expect(page.getByText('60-second guided run')).toBeVisible();
  await expect(page.getByText('See exactly why a change is safe to release.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run sample' }).first()).toBeEnabled();
  const inspectorHandle = page.locator('.canvas-inspector-toggle');
  const journeyAction = page.locator('.first-run-journey .journey-action');
  const initialHandleBox = await inspectorHandle.boundingBox();
  const initialActionBox = await journeyAction.boundingBox();
  expect(initialHandleBox).not.toBeNull();
  expect(initialActionBox).not.toBeNull();
  expect((initialHandleBox?.y ?? 0) >= (initialActionBox?.y ?? 0) + (initialActionBox?.height ?? 0)
    || (initialActionBox?.y ?? 0) >= (initialHandleBox?.y ?? 0) + (initialHandleBox?.height ?? 0)).toBe(true);

  await page.getByRole('button', { name: 'Run sample' }).first().click();
  await expect(page.getByText('Review packet', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned to Code owner. Reviewing as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText('Assigned to Release manager. Reviewing as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText('Run outcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Release readiness record/ })).toBeVisible();
  await expect(page.getByText(/evidence records · SHA-256 bound/)).toBeVisible();
  const outcomeHandleBox = await inspectorHandle.boundingBox();
  const outcomeActionBox = await journeyAction.boundingBox();
  expect((outcomeHandleBox?.y ?? 0) >= (outcomeActionBox?.y ?? 0) + (outcomeActionBox?.height ?? 0)
    || (outcomeActionBox?.y ?? 0) >= (outcomeHandleBox?.y ?? 0) + (outcomeHandleBox?.height ?? 0)).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse console' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Release readiness record/ })).toBeVisible();
  await page.locator('.app-nav button[title="Context"]').click();
  await expect(page.getByRole('heading', { name: 'Context graph' })).toBeVisible();
  await expect(page.getByText('Objects', { exact: true })).toBeVisible();
  await expect(page.getByText('Neighborhood', { exact: true })).toBeVisible();

  await page.locator('.app-nav button[title="Editor"]').click();
  await page.getByLabel('Active workflow').selectOption('software_delivery.observe_deployment');
  await page.getByRole('button', { name: 'Run sample' }).first().click();
  await expect(page.getByRole('heading', { name: /Deployment observation/ })).toBeVisible();
  await expect(page.getByText(/Prior approved release context: reused/)).toBeVisible();
  await page.getByRole('button', { name: 'View context' }).click();
  await expect(page.getByText('2 approved runs', { exact: true })).toBeVisible();

  await page.locator('.app-nav button[title="Packs"]').click();
  const customerSuccessCard = page.getByRole('article').filter({ hasText: 'Customer Success Renewal Pack' });
  await customerSuccessCard.getByRole('button', { name: 'Install Pack' }).click();
  await expect(page.getByRole('combobox').first()).toHaveValue('customer_success');
  await expect(page.getByText('Customer Success Renewal Pack installed and opened.')).toBeVisible();
  await expect(page.getByLabel('Active workflow')).toHaveValue('customer_success.renewal_workflow');
  await page.getByRole('button', { name: /Run (sample|again)/ }).first().click();
  await expect(page.getByText('Assigned to Revenue owner. Reviewing as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText('1 completed artifact', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Renewal success plan — Northstar Logistics' })).toBeVisible();
  await page.locator('.app-nav button[title="Context"]').click();
  await expect(page.getByRole('heading', { name: 'Renewal success plan — Northstar Logistics' })).toBeVisible();
  await expect(page.getByText('3 approved runs', { exact: true })).toBeVisible();
  await expect(page.getByText('Why it is connected', { exact: true })).toBeVisible();
  await expect(page.locator('.relation-list article').first()).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('manages a team identity and attributes its approval', async ({ page }) => {
  await page.goto('/');
  await page.locator('.app-nav button[title="Packs"]').click();
  const customerSuccessCard = page.getByRole('article').filter({ hasText: 'Customer Success Renewal Pack' });
  const customerPackAction = customerSuccessCard.getByRole('button', { name: /Install Pack|Open Pack/ });
  if (await customerPackAction.count()) await customerPackAction.click();
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
  await page.getByRole('button', { name: /Run (sample|again)/ }).first().click();
  await expect(page.getByText('Assigned to Revenue owner. Reviewing as Revenue reviewer.')).toBeVisible();
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

test('governs a delivery request posted by a build, and rejects an incomplete one', async ({ request }) => {
  const deliveryRequest = {
    issue_id: 'acme/billing-api#4821',
    title: 'Add idempotent capture retry',
    repository: 'acme/billing-api',
    base_ref: 'main',
    target_environment: 'production',
    release_version: '2.9.0',
    artifact_digest: 'sha256:e2e0000000000000000000000000000000000000000000000000000000000001',
    acceptance_criteria: ['Duplicate captures are rejected'],
    affected_components: ['capture-worker'],
    risk_flags: ['production deployment'],
  };

  const accepted = await request.post('/hooks/software-delivery/delivery-request', {
    headers: { 'idempotency-key': 'e2e-delivery-1' },
    data: deliveryRequest,
  });
  expect(accepted.ok()).toBe(true);
  // The build's request must land on the same accountable gate a manual run reaches.
  const body = await accepted.json();
  expect(body).toMatchObject({ status: 'paused', pendingApproval: { nodeId: 'code_review' } });

  const replay = await request.post('/hooks/software-delivery/delivery-request', {
    headers: { 'idempotency-key': 'e2e-delivery-1' },
    data: deliveryRequest,
  });
  expect((await replay.json()).runId).toBe(body.runId);

  // A request without its artifact digest cannot be governed, so it is refused
  // at ingress rather than producing a release record citing nothing.
  const { artifact_digest: _omitted, ...incomplete } = deliveryRequest;
  const rejected = await request.post('/hooks/software-delivery/delivery-request', {
    headers: { 'idempotency-key': 'e2e-delivery-2' },
    data: incomplete,
  });
  expect(rejected.status()).toBe(400);
});

test('keeps the run outcome and context readable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/actors/local.user/activate');
  await page.request.post('/api/packs/software_delivery/activate');
  await page.goto('/');

  await expect(page.getByRole('button', { name: /Run (sample|again)/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /inspector/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByLabel('Active workflow').selectOption('software_delivery.change_to_release');
  await page.getByRole('button', { name: /Run (sample|again)/ }).first().click();
  await expect(page.getByText('Review packet', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned to Code owner. Reviewing as Local user.')).toBeVisible();
  await expect(page.getByText('Recommendation', { exact: true })).toBeVisible();
  await expect(page.getByText('Checks', { exact: true })).toBeVisible();
  await expect(page.getByText('Risks', { exact: true })).toBeVisible();
  await expect(page.getByText('Evidence', { exact: true })).toBeVisible();

  const exportAudit = page.getByRole('button', { name: 'Export audit' });
  const collapseConsole = page.getByRole('button', { name: 'Collapse console' });
  await expect(exportAudit).toBeVisible();
  await expect(collapseConsole).toBeVisible();
  const exportBox = await exportAudit.boundingBox();
  const collapseBox = await collapseConsole.boundingBox();
  expect(exportBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(Math.abs((exportBox?.y ?? 0) - (collapseBox?.y ?? 0))).toBeLessThanOrEqual(2);
  expect((collapseBox?.x ?? 0) + (collapseBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText('Assigned to Release manager. Reviewing as Local user.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & resume' }).click();
  await expect(page.getByText('Run outcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Release readiness record/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View context' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: 'View context' }).click();
  await expect(page.getByRole('heading', { name: 'Context graph' })).toBeVisible();
  await expect(page.getByLabel('Filter context objects')).toBeVisible();
  await expect(page.getByText('Key facts', { exact: true })).toBeVisible();
  await expect(page.getByText('Provenance chain', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
