import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as ajvDraft04 from 'ajv-draft-04';
import type { ValidateFunction } from 'ajv';
import { afterAll, describe, expect, it } from 'vitest';
import { createSampleRepo } from './fixture.js';
import { renderSarif } from './render.js';
import { verifyChange } from './verify.js';

// The OASIS SARIF 2.1.0 schema (errata 01) is vendored in test-schemas/ so this check runs offline.
const schema = JSON.parse(
  readFileSync(new URL('../test-schemas/sarif-schema-2.1.0.json', import.meta.url), 'utf8'),
) as object;
// ajv-draft-04 is CommonJS with a default export; resolve it for both ESM interop shapes.
type AjvCtor = new (options: object) => { compile(schema: object): ValidateFunction };
const mod = ajvDraft04 as unknown as { default?: AjvCtor | { default?: AjvCtor } };
const Ajv = (typeof mod.default === 'function' ? mod.default : mod.default?.default) as AjvCtor;
const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);

const sample = createSampleRepo();
afterAll(() => rmSync(dirname(sample.root), { recursive: true, force: true }));
const inputs = (name: string): string => join(sample.inputsDir, name);

describe('SARIF output conforms to the SARIF 2.1.0 JSON schema', () => {
  it('validates a report with findings, coverage and test results', async () => {
    const report = await verifyChange({
      rootPath: sample.root,
      base: sample.baseSha,
      head: 'feature',
      coverage: [inputs('lcov.info')],
      baseCoverage: [inputs('base-lcov.info')],
      testReport: [inputs('junit.xml')],
      baseTestReport: [inputs('base-junit.xml')],
      buildResult: inputs('build.json'),
    });
    expect(report.findings.length).toBeGreaterThan(0);
    const sarif = JSON.parse(renderSarif(report)) as unknown;
    const ok = validate(sarif);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('validates a report with no optional inputs (NOT_MEASURED paths)', async () => {
    const report = await verifyChange({
      rootPath: sample.root,
      base: sample.baseSha,
      head: 'feature',
    });
    const ok = validate(JSON.parse(renderSarif(report)) as unknown);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('the schema really rejects a malformed log (guards against a vacuous validator)', () => {
    expect(validate({ version: '2.0.0', runs: [] })).toBe(false);
    expect(validate({ version: '2.1.0', runs: [{ results: [{ level: 'catastrophic' }] }] })).toBe(
      false,
    );
  });
});
