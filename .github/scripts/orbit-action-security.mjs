import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/orbit-action-test.yml', 'utf8');
const action = readFileSync('.github/actions/orbit/action.yml', 'utf8');

test('ORBIT Action integration uses pull_request, never pull_request_target', () => {
  assert.match(workflow, /^on:\n\x20{2}pull_request:/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
});

test('integration workflow grants only read-only repository contents permission', () => {
  assert.match(workflow, /permissions:\n\x20{2}contents: read\n/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /security-events:\s*write/);
});

test('caller checkout does not persist credentials and action writes stay disabled', () => {
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /comment:\s*['"]false['"]/);
  assert.match(workflow, /upload-sarif:\s*['"]false['"]/);
});

test('composite action checks out a fixed trusted runtime SHA rather than caller PR refs', () => {
  assert.match(action, /ref:\s*[0-9a-f]{40}/);
  assert.doesNotMatch(action, /ref:\s*\$\{\{\s*inputs\.(base|head)-sha/);
  assert.match(action, /persist-credentials:\s*false/);
});
