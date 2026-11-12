import { describe, expect, it } from 'vitest';
import { parseCoverage } from './coverage.js';
import { parseHunks, parseRawZ } from './diff.js';
import { parseJUnit } from './junit.js';

/**
 * Seeded mutation fuzzing of the WITNESS input parsers. Contract: return a value or throw an
 * ordinary Error with a message; never TypeError/RangeError and never hang.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const JUNK = [
  '\0',
  '<',
  '>',
  '&',
  '\n',
  '@@ -1,2 +1,2 @@',
  '<!DOCTYPE x [<!ENTITY a "b">]>',
  '<![CDATA[',
  ']]>',
  '../../x',
  'C:\\x',
  '99999999999999999999',
  '-1',
  '\u202e',
  '\u{1F600}',
];

function mutate(seed: string, next: () => number): string {
  let out = seed;
  for (let i = 0, n = 1 + Math.floor(next() * 6); i < n; i++) {
    const at = Math.floor(next() * (out.length + 1));
    const kind = Math.floor(next() * 4);
    if (kind === 0)
      out = out.slice(0, at) + JUNK[Math.floor(next() * JUNK.length)]! + out.slice(at);
    else if (kind === 1) out = out.slice(0, at) + out.slice(at + 1 + Math.floor(next() * 8));
    else if (kind === 2) out = out.slice(0, at);
    else out = out + out.slice(at);
  }
  return out;
}

function fuzz(name: string, seed: string, run: (input: string) => unknown): void {
  it(`${name} never fails with an internal error`, () => {
    const next = rng(0xbadc0de ^ name.length);
    for (let i = 0; i < 500; i++) {
      const input = mutate(seed, next);
      const started = performance.now();
      try {
        run(input);
      } catch (error) {
        const internal =
          error instanceof TypeError ||
          error instanceof RangeError ||
          !(error instanceof Error) ||
          error.message === '';
        expect(internal, `${name} threw ${String(error)} for ${JSON.stringify(input)}`).toBe(false);
      }
      expect(performance.now() - started, `${name} slow for ${JSON.stringify(input)}`).toBeLessThan(
        2000,
      );
    }
  });
}

describe('WITNESS parser fuzzing (seeded, deterministic)', () => {
  fuzz(
    'parseHunks',
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n x\n-y\n+z\n+w\n',
    parseHunks,
  );
  fuzz(
    'parseRawZ',
    ':100644 100644 aaa bbb M\0src/a.ts\0:000000 100644 000 ccc A\0src/b.ts\0R085\0old.ts\0new.ts\0',
    parseRawZ,
  );
  fuzz(
    'parseCoverage(lcov)',
    'TN:\nSF:src/a.ts\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record\n',
    (t) => parseCoverage(t),
  );
  fuzz(
    'parseCoverage(cobertura)',
    '<?xml version="1.0"?><coverage><packages><package><classes><class filename="src/a.ts"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>',
    (t) => parseCoverage(t),
  );
  fuzz(
    'parseJUnit',
    '<testsuites><testsuite><testcase classname="a.B" name="ok"/><testcase classname="a.B" name="bad"><failure message="m"/></testcase></testsuite></testsuites>',
    parseJUnit,
  );
});
