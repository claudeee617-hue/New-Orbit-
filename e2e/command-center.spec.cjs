const { test, expect } = require(process.env.PLAYWRIGHT_MODULE);
const { resilientLocator } = require('./support/locators.cjs');

const token = 'orbit_test_token_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const repositories = [
  { id: 'repo-1', key: 'orbit-main', displayName: 'ORBIT Main' },
  { id: 'repo-2', key: 'orbit-alt', displayName: 'ORBIT Alternate' },
];

function apiPayload(pathname, options = {}) {
  const repositoryKey = decodeURIComponent(pathname.split('/')[4] || 'orbit-main');
  const repository = repositories.find((item) => item.key === repositoryKey) || repositories[0];

  if (pathname === '/api/health') {
    return {
      status: 'ok',
      service: 'orbit-api',
      version: 'e2e',
      database: { connected: true, schemaVersion: 1 },
    };
  }
  if (pathname === '/api/v1/repositories') {
    if (options.failRepositories) return null;
    return { repositories: options.empty ? [] : repositories };
  }
  if (pathname.endsWith('/graph')) {
    return {
      repository,
      nodes: [{ id: `${repository.key}-file`, type: 'File', key: 'src/main.ts' }],
      edges: [],
      page: {
        limit: 100,
        offset: 0,
        nodeOffset: 0,
        edgeOffset: 0,
        hasMoreNodes: false,
        hasMoreEdges: false,
      },
      ledger: { entries: 0, headHash: null },
    };
  }
  if (pathname.endsWith('/evidence')) {
    return {
      repository,
      evidence: [],
      returned: 0,
      limit: 100,
      page: { limit: 100, offset: 0, hasMore: false },
    };
  }
  if (pathname.endsWith('/passports')) {
    return {
      repository,
      passports: [],
      page: { limit: 100, offset: 0, hasMore: false },
    };
  }
  if (pathname.endsWith('/integrity')) {
    return { repository, integrity: { ok: true, ledgerEntriesChecked: 0, problems: [] } };
  }
  if (pathname.endsWith('/reports/flare/history')) {
    return {
      repository,
      history: {
        testExecutions: 0,
        distinctRuns: 0,
        tests: 0,
        summaries: [],
        failureClusters: [],
        slowTests: [],
        limitations: [
          'No per-test history records were found. Ingest JUnit, pytest, Jest or Go reports with the updated ORBIT CLI.',
        ],
        truncated: false,
        scannedTestRunNodes: 0,
      },
    };
  }
  return { repository };
}

async function mockApi(page, options = {}) {
  const seen = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    seen.push({
      pathname: url.pathname,
      authorization: request.headers().authorization,
    });

    if (options.failRepositories && url.pathname === '/api/v1/repositories') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'TEST_UNAVAILABLE',
          message: 'Test API unavailable',
        }),
      });
      return;
    }

    const payload = apiPayload(url.pathname, options);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  return seen;
}

async function connect(page) {
  const tokenField = await resilientLocator(page, {
    role: 'textbox',
    name: 'Local API token',
  });
  await tokenField.fill(token);
  const connectButton = await resilientLocator(page, {
    role: 'button',
    name: 'Connect locally',
  });
  await connectButton.click();
}

test('connects, sends the token only as authorization, and disconnects cleanly', async ({
  page,
}) => {
  const seen = await mockApi(page);
  await page.goto('/');
  await connect(page);

  await expect(page.getByRole('heading', { name: 'Engineering Command Center' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Repository' })).toHaveValue('orbit-main');
  const authenticatedRequests = seen.filter((request) => request.pathname.startsWith('/api/v1/'));
  expect(authenticatedRequests.length).toBeGreaterThan(0);
  expect(
    authenticatedRequests.every((request) => request.authorization === `Bearer ${token}`),
  ).toBeTruthy();

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your ORBIT workspace' })).toBeVisible();
});

test('switches repositories and navigates dashboard and engine workbench views', async ({
  page,
}) => {
  const seen = await mockApi(page);
  await page.goto('/');
  await connect(page);

  await page.getByRole('combobox', { name: 'Repository' }).selectOption('orbit-alt');
  await expect
    .poll(() => seen.some((request) => request.pathname.includes('/repositories/orbit-alt/graph')))
    .toBeTruthy();

  const dashboard = page.getByRole('navigation', {
    name: 'Engineering dashboard views',
  });
  await dashboard.getByRole('button', { name: 'graph', exact: true }).click();
  await expect(page.getByText('Graph is empty')).toHaveCount(0);
  await dashboard.getByRole('button', { name: 'evidence', exact: true }).click();
  await expect(page.getByText('No evidence found')).toBeVisible();
  await dashboard.getByRole('button', { name: 'Change Passports', exact: true }).click();
  await expect(page.getByText('No Change Passports yet')).toBeVisible();

  const workbenches = page.getByRole('navigation', { name: 'Engine workbenches' });
  await workbenches.getByRole('button', { name: /WITNESS/ }).click();
  await expect(workbenches.getByRole('button', { name: /WITNESS/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await workbenches.getByRole('button', { name: /ATLAS/ }).click();
  await expect(workbenches.getByRole('button', { name: /ATLAS/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await workbenches.getByRole('button', { name: /FLARE/ }).click();
  await expect(workbenches.getByRole('button', { name: /FLARE/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Per-test history not measured')).toBeVisible();
  await expect(page.getByText(/No per-test history records were found/)).toBeVisible();
});

test('shows a useful API failure and an honest empty-workspace state', async ({ page }) => {
  await mockApi(page, { failRepositories: true });
  await page.goto('/');
  await connect(page);
  await expect(page.getByRole('alert')).toContainText('Test API unavailable');

  await page.unrouteAll();
  await page.reload();
  await mockApi(page, { empty: true });
  await connect(page);
  await expect(page.getByRole('status')).toContainText('No repository is registered yet');
});
