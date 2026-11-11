const { test, expect } = require(process.env.PLAYWRIGHT_MODULE);

const apiUrl = process.env.ORBIT_E2E_API_URL || 'http://127.0.0.1:4318';
const token = process.env.ORBIT_E2E_API_TOKEN;
const fixtureRoot = process.env.ORBIT_E2E_FIXTURE_ROOT;

function authHeaders() {
  if (!token) throw new Error('ORBIT_E2E_API_TOKEN is required for the disposable API smoke.');
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function api(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Disposable ORBIT API request failed: ${init.method || 'GET'} ${path} (HTTP ${response.status}).`,
    );
  }
  return body;
}

test('uses a real SQLite-backed local API and keeps its token in page memory only', async ({
  page,
}) => {
  if (!fixtureRoot) throw new Error('ORBIT_E2E_FIXTURE_ROOT is required.');

  // Seed a disposable repository through the real authenticated local API.
  const scanned = await api('/api/v1/repositories/scan', {
    method: 'POST',
    body: JSON.stringify({
      rootPath: fixtureRoot,
      repositoryKey: 'orbit-ci-fixture',
      maxFiles: 50,
      maxCommits: 1,
      skipGit: true,
      skipCalls: true,
    }),
  });
  expect(scanned.result).toBeTruthy();

  const listed = await api('/api/v1/repositories');
  expect(listed.repositories.map((item) => item.key)).toContain('orbit-ci-fixture');

  const graph = await api('/api/v1/repositories/orbit-ci-fixture/graph?limit=50');
  expect(graph.nodes.length).toBeGreaterThan(0);

  const evidence = await api('/api/v1/repositories/orbit-ci-fixture/evidence?limit=20');
  expect(evidence.repository.key).toBe('orbit-ci-fixture');
  expect(Array.isArray(evidence.evidence)).toBe(true);

  const passports = await api('/api/v1/repositories/orbit-ci-fixture/passports?limit=20');
  expect(passports.repository.key).toBe('orbit-ci-fixture');
  expect(Array.isArray(passports.passports)).toBe(true);

  const integrity = await api('/api/v1/repositories/orbit-ci-fixture/integrity');
  expect(integrity.integrity.ok).toBe(true);

  const requestedUrls = [];
  const authorizationHeaders = [];
  page.on('request', (request) => {
    requestedUrls.push(request.url());
    if (request.url().includes('/api/v1/')) {
      authorizationHeaders.push(request.headers().authorization);
    }
  });

  await page.goto('/');
  const tokenField = page.getByRole('textbox', { name: 'Local API token' });
  await tokenField.fill(token);
  await page.getByRole('button', { name: 'Connect locally' }).click();

  await expect(page.getByRole('heading', { name: 'Engineering Command Center' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Repository' })).toHaveValue('orbit-ci-fixture');

  const storedValues = await page.evaluate(() => ({
    local: Object.keys(localStorage).map((key) => localStorage.getItem(key)),
    session: Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
  }));
  expect(JSON.stringify(storedValues)).not.toContain(token);
  expect(page.url()).not.toContain(token);
  expect(requestedUrls.every((url) => !url.includes(token))).toBe(true);
  expect(authorizationHeaders.length).toBeGreaterThan(0);
  expect(authorizationHeaders.every((value) => value === `Bearer ${token}`)).toBe(true);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('heading', { name: 'Connect your ORBIT workspace' })).toBeVisible();
  const afterDisconnect = await page.evaluate(() =>
    JSON.stringify([Object.values(localStorage), Object.values(sessionStorage)]),
  );
  expect(afterDisconnect).not.toContain(token);
});

// Repository Prettier formats this file in CI.
