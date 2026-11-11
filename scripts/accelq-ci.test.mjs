import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunStatusUrl,
  buildTriggerUrl,
  evaluateRun,
  normalizeRunPid,
  normalizeRunSnapshot,
  validateRunProperties,
} from './accelq-ci.mjs';

test('builds the vendor-documented ACCELQ trigger endpoint without a project-code path segment', () => {
  assert.equal(
    buildTriggerUrl('https://tenant.accelq.io', 'tenant code', 123),
    'https://tenant.accelq.io/awb/api/1.0/tenant%20code/jobs/123/trigger-ci-job',
  );
});

test('builds the vendor-documented ACCELQ status endpoint for the runtime PID', () => {
  assert.equal(
    buildRunStatusUrl('https://tenant.accelq.io/', 'tenant', 9876),
    'https://tenant.accelq.io/awb/api/1.0/tenant/runs/9876',
  );
});

test('rejects malformed or negative ACCELQ result counts instead of treating them as zero', () => {
  assert.throws(
    () =>
      normalizeRunSnapshot({
        status: 'Completed',
        testcaseCount: 3,
        pass: 3,
        fail: 'unknown',
        notRun: 0,
      }),
    /failed count must be a non-negative integer/,
  );
  assert.throws(
    () => normalizeRunSnapshot({ status: 'Completed', pass: -1, fail: 0, notRun: 0 }),
    /passed count must be a non-negative integer/,
  );
  assert.throws(
    () => normalizeRunSnapshot({ status: 'Completed', pass: true, fail: 0, notRun: 0 }),
    /passed count must be a non-negative integer/,
  );
  assert.throws(
    () => normalizeRunSnapshot({ status: 'Completed', pass: '', fail: 0, notRun: 0 }),
    /passed count must be a non-negative integer/,
  );
});

test('accepts non-negative integer counts returned as numeric strings', () => {
  assert.deepEqual(
    normalizeRunSnapshot({
      status: 'Completed',
      testcaseCount: '3',
      pass: '2',
      fail: '1',
      notRun: '0',
    }),
    {
      status: 'COMPLETED',
      total: 3,
      passed: 2,
      failed: 1,
      notRun: 0,
    },
  );
});

test('rejects ACCELQ summaries whose declared total does not match outcome counts', () => {
  assert.throws(
    () =>
      normalizeRunSnapshot({
        status: 'Completed',
        testcaseCount: 3,
        pass: 2,
        fail: 0,
        notRun: 0,
      }),
    /totals do not reconcile/,
  );
});

test('accepts non-secret run properties and rejects credential-like fields', () => {
  assert.deepEqual(validateRunProperties({ environment: 'ORBIT-QA', browser: 'Chrome' }), {
    environment: 'ORBIT-QA',
    browser: 'Chrome',
  });
  assert.throws(
    () => validateRunProperties({ credentials: { apiKey: 'must-not-be-here' } }),
    /credential-like field names/,
  );
  assert.throws(() => validateRunProperties(['not', 'an', 'object']), /JSON object/);
});

test('reads a runtime PID from ACCELQ documented array response', () => {
  assert.equal(normalizeRunPid([12345]), 12345);
});

test('reads a runtime PID object response', () => {
  assert.equal(normalizeRunPid([{ pid: '9876' }]), 9876);
});

test('rejects an empty or invalid trigger response', () => {
  assert.throws(() => normalizeRunPid([]), /positive integer/);
  assert.throws(() => normalizeRunPid([{ pid: 'not-a-pid' }]), /positive integer/);
});

test('normalizes a nested completed status response and case counts', () => {
  assert.deepEqual(
    normalizeRunSnapshot({
      summary: {
        status: 'Completed',
        testcaseCount: 4,
        pass: 4,
        fail: 0,
        notRun: 0,
      },
    }),
    {
      status: 'COMPLETED',
      total: 4,
      passed: 4,
      failed: 0,
      notRun: 0,
    },
  );
});

test('normalizes status variants and count aliases', () => {
  assert.deepEqual(
    normalizeRunSnapshot({
      status: 'In Progress',
      totalTestCases: 5,
      passed: 3,
      failed: 1,
      not_run: 1,
    }),
    {
      status: 'IN_PROGRESS',
      total: 5,
      passed: 3,
      failed: 1,
      notRun: 1,
    },
  );
});

test('passes only a completed run with at least one case and no failed or not-run cases', () => {
  assert.equal(
    evaluateRun({ status: 'COMPLETED', total: 2, passed: 2, failed: 0, notRun: 0 }).passed,
    true,
  );
  assert.equal(
    evaluateRun({ status: 'COMPLETED', total: 2, passed: 1, failed: 1, notRun: 0 }).passed,
    false,
  );
  assert.equal(
    evaluateRun({ status: 'COMPLETED', total: 2, passed: 1, failed: 0, notRun: 1 }).passed,
    false,
  );
  assert.equal(
    evaluateRun({ status: 'COMPLETED', total: 0, passed: 0, failed: 0, notRun: 0 }).passed,
    false,
  );
  assert.equal(
    evaluateRun({ status: 'ABORTED', total: 1, passed: 0, failed: 0, notRun: 1 }).passed,
    false,
  );
});
