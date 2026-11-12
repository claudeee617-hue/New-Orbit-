import { describe, expect, it } from 'vitest';
import { parseGoTestJson, parseJestJsonReport, parsePytestJsonReport } from './flare-extended.js';
import { parseJunitXml } from './flare.js';
import { inspectEnvironment } from './capsule.js';
import { inspectExtendedEnvironment } from './capsule-extended.js';
import { parseTelemetry } from './flight-recorder.js';
import { analyseTelemetry } from './flight-recorder-extended.js';
import { parseCobertura, parseLcov, parseUnifiedDiff } from './verification.js';

/**
 * Deterministic mutation fuzzing of every parser that reads untrusted text.
 *
 * Contract under test: a parser either returns a value or rejects the input with an
 * ordinary `Error` that carries a message. An internal bug surfaces as TypeError,
 * RangeError (including stack overflow) or a hang, and fails the test. The PRNG is seeded,
 * so a failure reproduces exactly and prints the offending input.
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
  '\u202e',
  '<',
  '>',
  '&',
  '"',
  "'",
  '\n',
  '\r\n',
  '{',
  '}',
  '[',
  ']',
  ',',
  ':',
  '@@ -1,2 +1,2 @@',
  '<!DOCTYPE x [<!ENTITY a "b">]>',
  '<![CDATA[',
  ']]>',
  '../../etc/passwd',
  'C:\\Windows\\x',
  '99999999999999999999',
  '-1',
  'null',
  'NaN',
  '"__proto__"',
  '{"__proto__":{"x":1}}',
  '\u{1F600}',
];

function mutate(seed: string, next: () => number): string {
  let out = seed;
  const rounds = 1 + Math.floor(next() * 6);
  for (let i = 0; i < rounds; i++) {
    const at = Math.floor(next() * (out.length + 1));
    switch (Math.floor(next() * 5)) {
      case 0:
        out = out.slice(0, at) + JUNK[Math.floor(next() * JUNK.length)]! + out.slice(at);
        break;
      case 1:
        out = out.slice(0, at) + out.slice(at + 1 + Math.floor(next() * 8));
        break;
      case 2:
        out = out.slice(0, at);
        break;
      case 3: {
        const to = Math.floor(next() * (out.length + 1));
        out = out + out.slice(Math.min(at, to), Math.max(at, to));
        break;
      }
      default:
        out = out.slice(0, at) + String.fromCharCode(Math.floor(next() * 0xffff)) + out.slice(at);
    }
  }
  return out;
}

function fuzz(name: string, seeds: readonly string[], run: (input: string) => unknown): void {
  it(`${name} never fails with an internal error`, () => {
    const next = rng(0xc0ffee ^ name.length);
    for (let i = 0; i < 400; i++) {
      const base = seeds[i % seeds.length]!;
      const input = mutate(base, next);
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
      expect(
        performance.now() - started,
        `${name} was slow for ${JSON.stringify(input)}`,
      ).toBeLessThan(2000);
    }
  });
}

const JUNIT = `<?xml version="1.0"?><testsuites><testsuite name="s"><testcase classname="a.B" name="ok" time="0.1"/><testcase classname="a.B" name="bad" time="1"><failure message="x">trace</failure></testcase><testcase name="skip"><skipped/></testcase></testsuite></testsuites>`;
const COBERTURA = `<?xml version="1.0"?><coverage><packages><package name="p"><classes><class name="C" filename="src/a.ts"><lines><line number="1" hits="1"/><line number="2" hits="0"/></lines></class></classes></package></packages></coverage>`;
const LCOV = `TN:\nSF:src/a.ts\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record\n`;
const DIFF = `diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n line\n-old\n+new\n+more\n`;
const PYTEST = JSON.stringify({
  tests: [
    { nodeid: 'a.py::t', outcome: 'passed', duration: 0.1 },
    { nodeid: 'a.py::u', outcome: 'failed', call: { longrepr: 'boom' } },
  ],
});
const JEST = JSON.stringify({
  testResults: [
    {
      name: '/r/a.test.ts',
      assertionResults: [
        { fullName: 'a b', status: 'passed', duration: 3 },
        { fullName: 'a c', status: 'failed', failureMessages: ['x'] },
      ],
    },
  ],
});
const GO = `{"Action":"run","Package":"p","Test":"TestA"}\n{"Action":"pass","Package":"p","Test":"TestA","Elapsed":0.1}\n{"Action":"fail","Package":"p","Test":"TestB","Elapsed":1}\n`;
const NDJSON = `{"t":1700000000,"temp":21.5,"mode":"idle"}\n{"t":1700000001,"temp":22.1,"mode":"run"}\n`;
const CSV = `time,temp,mode\n2026-01-01T00:00:00Z,21.5,idle\n2026-01-01T00:00:01Z,22.1,run\n`;
const KV = `temp=21.5 mode=idle\ntemp=22.1 mode=run\n`;
const JSON_TEL = JSON.stringify([
  { time: '2026-01-01T00:00:00Z', temp: 21.5 },
  { time: '2026-01-01T00:00:01Z', temp: 22.1 },
]);

describe('parser fuzzing (seeded, deterministic)', () => {
  fuzz('parseJunitXml', [JUNIT], parseJunitXml);
  fuzz('parseCobertura', [COBERTURA], parseCobertura);
  fuzz('parseLcov', [LCOV], parseLcov);
  fuzz('parseUnifiedDiff', [DIFF], parseUnifiedDiff);
  fuzz('parsePytestJsonReport', [PYTEST], parsePytestJsonReport);
  fuzz('parseJestJsonReport', [JEST], parseJestJsonReport);
  fuzz('parseGoTestJson', [GO], parseGoTestJson);
  fuzz('parseTelemetry', [NDJSON, CSV, KV, JSON_TEL], (input) =>
    analyseTelemetry(parseTelemetry(input)),
  );
  fuzz(
    'inspectEnvironment',
    [
      `{"engines":{"node":">=22"},"dependencies":{"a":"^1"}}`,
      'FROM node:22\nENV A=1\n',
      'python==3.12\n',
    ],
    (input) =>
      inspectEnvironment({
        'package.json': input,
        Dockerfile: input,
        'requirements.txt': input,
        '.env': input,
      }),
  );
  fuzz(
    'inspectExtendedEnvironment',
    [`{"name":"x","packageManager":"pnpm@10"}`, '[tool.poetry]\nname="x"\n', 'module x\ngo 1.22\n'],
    (input) =>
      inspectExtendedEnvironment({
        'package.json': input,
        'pyproject.toml': input,
        'go.mod': input,
        'Cargo.toml': input,
      }),
  );

  it('rejects hostile structure without recursion or memory blow-up', () => {
    const deepXml = '<a>'.repeat(5000) + '</a>'.repeat(5000);
    const deepJson = '['.repeat(20000) + ']'.repeat(20000);
    for (const run of [
      () => parseJunitXml(deepXml),
      () => parseCobertura(deepXml),
      () => parsePytestJsonReport(deepJson),
      () => parseJestJsonReport(deepJson),
    ]) {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(RangeError);
      }
    }
  });
});
