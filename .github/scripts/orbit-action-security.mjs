import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

test('every third-party step in the composite action is pinned to a full commit SHA', () => {
  const uses = [...action.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 4);
  for (const ref of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, `${ref} must be pinned to a commit SHA, not a tag`);
  }
});

test('action inputs reach shell steps only through env, never interpolated into run scripts', () => {
  for (const block of action.matchAll(/^\s*run:\s*(.+)$/gm)) {
    assert.doesNotMatch(block[1], /\$\{\{\s*inputs\./, `inputs interpolated into run: ${block[1]}`);
    assert.doesNotMatch(
      block[1],
      /\$\{\{\s*github\.event\./,
      `event data interpolated into run: ${block[1]}`,
    );
  }
});

test('all third-party actions in repository workflows are pinned to immutable commit SHAs', () => {
  const workflowDir = '.github/workflows';
  for (const name of readdirSync(workflowDir).filter((item) => /\\.ya?ml$/i.test(item))) {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    const refs = [...source.matchAll(/^\\s*uses:\\s*([^\\s#]+)/gm)].map((match) => match[1]);
    for (const ref of refs) {
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      assert.match(ref, /^[^@]+@[0-9a-f]{40}$/, `${name}: ${ref} must be pinned to a full commit SHA`);
    }
  }
});
