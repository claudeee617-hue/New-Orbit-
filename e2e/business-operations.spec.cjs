const { test, expect } = require(process.env.PLAYWRIGHT_MODULE);

const storageKey = 'orbit.business-workspace.v1';

function opportunity(id, account) {
  return {
    id,
    account,
    segment: 'product-engineering',
    stage: 'discovery',
    estimatedMonthlyValue: 1250,
    nextAction: 'Arrange a discovery call',
    dueDate: '2026-11-20',
    evidence: 'User confirmed the workflow pain.',
  };
}

function backup(opportunities) {
  return JSON.stringify({ version: 1, opportunities });
}

async function openBusiness(page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        service: 'orbit-api',
        version: 'e2e',
        database: { connected: true, schemaVersion: 1 },
      }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Business operations workspace' })).toBeVisible();
}

async function addOpportunity(page, account) {
  await page.getByLabel('Account / organisation').fill(account);
  await page.getByRole('button', { name: 'Add opportunity' }).click();
}

test('creates validated opportunities, persists them, and rejects whitespace-only accounts', async ({
  page,
}) => {
  await openBusiness(page);

  await page.getByLabel('Account / organisation').fill('   ');
  await page.getByRole('button', { name: 'Add opportunity' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be empty or whitespace only');
  await expect(page.getByText('0 locally recorded opportunities')).toBeVisible();

  await addOpportunity(page, 'Acme Engineering');
  await expect(page.getByText('1 locally recorded opportunities')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acme Engineering' })).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities.map((item) => item.account)).toEqual(['Acme Engineering']);

  await page.reload();
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(page.getByText('1 locally recorded opportunities')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acme Engineering' })).toBeVisible();
});

test('serializes two-tab writes so independent additions are not lost', async ({ page }) => {
  await openBusiness(page);
  const secondTab = await page.context().newPage();
  await openBusiness(secondTab);

  await page.getByLabel('Account / organisation').fill('First tab account');
  await secondTab.getByLabel('Account / organisation').fill('Second tab account');

  await Promise.all([
    page.getByRole('button', { name: 'Add opportunity' }).click(),
    secondTab.getByRole('button', { name: 'Add opportunity' }).click(),
  ]);

  await expect(page.getByText('2 locally recorded opportunities')).toBeVisible();
  await expect(secondTab.getByText('2 locally recorded opportunities')).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities.map((item) => item.account).sort()).toEqual([
    'First tab account',
    'Second tab account',
  ]);
});

test('blocks mutations after unreadable storage and recovers only through a valid import', async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{invalid-json'), storageKey);
  await openBusiness(page);

  await expect(page.getByRole('alert')).toContainText('Import a valid JSON backup to recover');
  await expect(page.getByLabel('Account / organisation')).toBeDisabled();

  const restored = backup([opportunity('recovered-id', 'Recovered account')]);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'recovery.json',
    mimeType: 'application/json',
    buffer: Buffer.from(restored),
  });

  await expect(page.getByText('Imported 1 opportunities')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recovered account' })).toBeVisible();
  await expect(page.getByLabel('Account / organisation')).toBeEnabled();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities[0].account).toBe('Recovered account');
});

test('the most recently selected backup wins when earlier file reads finish later', async ({
  page,
}) => {
  await openBusiness(page);
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    window.__slowReadStarted = false;
    window.__slowReadCompleted = false;
    window.__completeSlowRead = null;
    File.prototype.text = function () {
      if (this.name !== 'slow.json') return originalText.call(this);
      window.__slowReadStarted = true;
      return new Promise((resolve, reject) => {
        window.__completeSlowRead = () => {
          originalText.call(this).then(
            (text) => {
              window.__slowReadCompleted = true;
              resolve(text);
            },
            reject,
          );
        };
      });
    };
  });

  const slow = backup([opportunity('slow-id', 'Slow earlier selection')]);
  const fast = backup([opportunity('fast-id', 'Fast latest selection')]);
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({
    name: 'slow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(slow),
  });
  await input.setInputFiles({
    name: 'fast.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fast),
  });

  await expect.poll(() => page.evaluate(() => window.__slowReadStarted)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Fast latest selection' })).toBeVisible();
  await expect(page.getByText('1 locally recorded opportunities')).toBeVisible();

  // Let the earlier file read complete only after the newer selection has been saved.
  await page.evaluate(() => window.__completeSlowRead());
  await expect.poll(() => page.evaluate(() => window.__slowReadCompleted)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Fast latest selection' })).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities.map((item) => item.account)).toEqual(['Fast latest selection']);
});

test('a validated backup imported in another tab recovers a read-only tab', async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{invalid-json'), storageKey);
  await openBusiness(page);
  await expect(page.getByLabel('Account / organisation')).toBeDisabled();

  const secondTab = await page.context().newPage();
  await openBusiness(secondTab);
  await expect(secondTab.getByLabel('Account / organisation')).toBeDisabled();

  const restored = backup([opportunity('cross-tab-recovery', 'Cross-tab recovered account')]);
  await secondTab.locator('input[type="file"]').setInputFiles({
    name: 'cross-tab-recovery.json',
    mimeType: 'application/json',
    buffer: Buffer.from(restored),
  });

  await expect(secondTab.getByRole('heading', { name: 'Cross-tab recovered account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cross-tab recovered account' })).toBeVisible();
  await expect(page.getByLabel('Account / organisation')).toBeEnabled();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities.map((item) => item.account)).toEqual(['Cross-tab recovered account']);
});

test('edits decimal estimates from imported backups and deletes persisted records', async ({
  page,
}) => {
  await openBusiness(page);
  const imported = backup([
    {
      ...opportunity('decimal-id', 'Decimal estimate account'),
      estimatedMonthlyValue: 1.234,
    },
  ]);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'decimal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(imported),
  });
  await expect(page.getByRole('heading', { name: 'Decimal estimate account' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Estimated monthly value')).toHaveValue('1.234');
  await page.getByLabel('Evidence / discovery note').fill('Updated without changing the imported estimate.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities[0].estimatedMonthlyValue).toBe(1.234);
  expect(saved.opportunities[0].evidence).toBe('Updated without changing the imported estimate.');

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('0 locally recorded opportunities')).toBeVisible();
  saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.opportunities).toEqual([]);
});

test('enforces the 250-record limit and does not report a failed storage write as saved', async ({
  page,
}) => {
  const records = Array.from({ length: 250 }, (_, index) =>
    opportunity('seed-' + index, 'Seed account ' + index),
  );
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: backup(records) },
  );
  await openBusiness(page);
  await expect(page.getByText('250 locally recorded opportunities')).toBeVisible();
  await addOpportunity(page, 'Overflow account');
  await expect(page.getByRole('alert')).toContainText('at most 250 opportunities');
  await expect(page.getByText('250 locally recorded opportunities')).toBeVisible();

  await page.reload();
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage quota blocked by test', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, storageKey);
  await page.reload();
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(page.getByText('250 locally recorded opportunities')).toBeVisible();
  await addOpportunity(page, 'Unsaved account');
  await expect(page.getByRole('alert')).toContainText('QuotaExceededError');
  await expect(page.getByText('250 locally recorded opportunities')).toBeVisible();
  await expect(page.getByText('Opportunity added')).toHaveCount(0);
});
