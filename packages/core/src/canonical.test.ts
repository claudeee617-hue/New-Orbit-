import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  hashArtifact,
  hashValue,
  sha256Hex,
  verifyArtifactHash,
} from './canonical.js';

describe('canonicalJson', () => {
  it('sorts object keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('produces identical output regardless of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: [1, 2], z: 'q' })).toBe(
      canonicalJson({ z: 'q', y: [1, 2], x: 1 }),
    );
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it('treats undefined object properties as absent', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('distinguishes null from absent', () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it('escapes strings like JSON', () => {
    expect(canonicalJson('a"b\n')).toBe('"a\\"b\\n"');
    expect(canonicalJson({ 'k"ey': 'ünï' })).toBe('{"k\\"ey":"ünï"}');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined in an array', [1, undefined]],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 10n],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a class instance', new (class Foo {})()],
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrowError();
  });

  it('rejects values nested deeper than the limit (including cycles)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrowError(/too deeply/);
  });

  it('accepts objects without a prototype', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['a'] = 1;
    expect(canonicalJson(bare)).toBe('{"a":1}');
  });
});

describe('hashing', () => {
  it('matches the known SHA-256 of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the known SHA-256 of "abc" for strings and bytes', () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex('abc')).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(expected);
  });

  it('hashValue is stable across key order', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
  });

  it('verifies artifacts and detects a single changed byte', () => {
    const bytes = new TextEncoder().encode('TN:\nSF:src/a.ts\nDA:1,1\nend_of_record\n');
    const hash = hashArtifact(bytes);
    expect(verifyArtifactHash(hash, bytes)).toBe(true);
    expect(verifyArtifactHash(hash.toUpperCase(), bytes)).toBe(true);
    const tampered = new Uint8Array(bytes);
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(verifyArtifactHash(hash, tampered)).toBe(false);
  });
});
