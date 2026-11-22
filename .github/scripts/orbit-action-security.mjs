import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/orbit-action-test.yml', 'utf8');
const action = readFileSync('.github/actions/orbit/action.yml', 'utf8');

function collectUses(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectUses(item, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    const record = value;
    if (Object.hasOwn(record, 'uses')) refs.push(record.uses);
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'uses') collectUses(child, refs);
    }
  }
  return refs;
}

function assertPinnedWorkflowUses(name, source) {
  const document = parseDocument(source);
  assert.equal(document.errors.length, 0, `${name}: workflow YAML must parse without errors`);
  const workflow = document.toJS({ maxAliasCount: 100 });
  const refs = collectUses(workflow);
  for (const ref of refs) {
    assert.equal(typeof ref, 'string', `${name}: every uses value must be a string`);
    if (ref.startsWith('./')) continue;
    if (ref.startsWith('docker://')) {
      assert.match(
        ref,
        /^docker:\/\/.+@sha256:[0-9a-f]{64}$/i,
        `${name}: Docker actions must be pinned by immutable sha256 digest`,
      );
      continue;
    }
    assert.match(
      ref,
      /^[^@]+@[0-9a-f]{40}$/,
      `${name}: ${ref} must be pinned to a full commit SHA`,
    );
  }
}

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

test('flow-style and quoted action references are parsed before pin validation', () => {
  const sha = 'a'.repeat(40);
  const flowStyle = `jobs:
  check:
    steps:
      - { uses: "actions/checkout@${sha}" }
`;
  assert.doesNotThrow(() => assertPinnedWorkflowUses('flow.yml', flowStyle));

  const quotedPinned = `jobs:
  check:
    steps:
      - uses: 'actions/checkout@${sha}'
`;
  assert.doesNotThrow(() => assertPinnedWorkflowUses('quoted-pinned.yml', quotedPinned));

  const reusableWorkflow = `jobs:
  reusable:
    uses: 'actions/reusable-workflow/.github/workflows/test.yml@${sha}'
`;
  assert.doesNotThrow(() => assertPinnedWorkflowUses('job-level.yml', reusableWorkflow));

  const quotedMutable = `jobs:
  check:
    steps:
      - uses: 'actions/checkout@v7'
`;
  assert.throws(
    () => assertPinnedWorkflowUses('quoted.yml', quotedMutable),
    /must be pinned to a full commit SHA/,
  );
});

test('Docker action references require immutable sha256 digests', () => {
  const mutable = 'jobs:\n  check:\n    steps:\n      - uses: docker://alpine:latest\n';
  assert.throws(
    () => assertPinnedWorkflowUses('docker-mutable.yml', mutable),
    /immutable sha256 digest/,
  );
  const pinned = `jobs:
  check:
    steps:
      - uses: docker://alpine@sha256:${'b'.repeat(64)}
`;
  assert.doesNotThrow(() => assertPinnedWorkflowUses('docker-pinned.yml', pinned));
});

test('all third-party actions in repository workflows are pinned to immutable references', () => {
  const workflowDir = '.github/workflows';
  const workflowFiles = readdirSync(workflowDir).filter((item) => /\.ya?ml$/i.test(item));

  for (const name of workflowFiles) {
    const source = readFileSync(join(workflowDir, name), 'utf8');
    assertPinnedWorkflowUses(name, source);
  }
});
