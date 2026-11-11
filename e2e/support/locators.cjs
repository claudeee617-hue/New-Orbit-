const { expect } = require(process.env.PLAYWRIGHT_MODULE);

async function resilientLocator(page, options) {
  const candidates = [
    options.role ? page.getByRole(options.role, { name: options.name, exact: true }) : null,
    options.label ? page.getByLabel(options.label, { exact: true }) : null,
    options.placeholder ? page.getByPlaceholder(options.placeholder, { exact: true }) : null,
    options.testId ? page.getByTestId(options.testId) : null,
    options.text ? page.getByText(options.text, { exact: true }) : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await expect(candidate.first()).toBeVisible({ timeout: 1500 });
      return candidate.first();
    } catch {
      // Try the next semantic locator before declaring the control unavailable.
    }
  }

  throw new Error(`Unable to recover a visible control: ${JSON.stringify(options)}`);
}

module.exports = { resilientLocator };
