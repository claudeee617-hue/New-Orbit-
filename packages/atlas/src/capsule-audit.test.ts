import { describe, expect, it } from 'vitest';
import { compareEnvironments, inspectEnvironment, redactSecrets } from './capsule.js';
import { inspectExtendedEnvironment } from './capsule-extended.js';

/** Regression tests for findings of the manual CAPSULE audit (docs/audits/CAPSULE.md). */
describe('CP-1 prototype-named keys are data, not prototype tricks', () => {
  const pkg = `{"dependencies":{"__proto__":"1.0.0","constructor":"2.0.0","toString":"3.0.0","hasOwnProperty":"4.0.0"}}`;

  it('keeps dependencies named __proto__, constructor, toString and hasOwnProperty', () => {
    const snap = inspectEnvironment({ 'package.json': pkg });
    const keys = Object.keys(snap.dependencies).sort();
    expect(keys).toEqual(['__proto__', 'constructor', 'hasOwnProperty', 'toString']);
    expect(Object.getPrototypeOf(snap.dependencies)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('the fingerprint changes when a __proto__ dependency changes (it cannot be hidden)', () => {
    const a = inspectEnvironment({ 'package.json': pkg });
    const b = inspectEnvironment({ 'package.json': pkg.replace('1.0.0', '9.9.9') });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('comparison reports inherited-name keys correctly and never returns functions', () => {
    const before = inspectEnvironment({ 'package.json': '{"dependencies":{}}' });
    const after = inspectEnvironment({
      'package.json': '{"dependencies":{"toString":"1.0.0","constructor":"2.0.0"}}',
    });
    const diff = compareEnvironments(before, after).filter((d) => d.kind === 'dependency');
    expect(diff).toEqual([
      { kind: 'dependency', key: 'constructor', before: null, after: '2.0.0' },
      { kind: 'dependency', key: 'toString', before: null, after: '1.0.0' },
    ]);
  });

  it('requirements.txt and pyproject names of that shape are kept too', () => {
    const snap = inspectExtendedEnvironment({
      'requirements.txt': '__proto__==1.0\nconstructor==2.0\n',
    });
    expect(Object.keys(snap.declaredDependencies).sort()).toEqual(['__proto__', 'constructor']);
  });
});

describe('CP-2 workspace manifests do not overwrite each other', () => {
  const files = {
    'package.json':
      '{"dependencies":{"left-pad":"1.0.0"},"scripts":{"build":"tsc"},"engines":{"node":">=22"}}',
    'packages/a/package.json':
      '{"dependencies":{"left-pad":"2.0.0"},"scripts":{"build":"vite build"}}',
    'packages/b/package.json': '{"dependencies":{"left-pad":"3.0.0"}}',
  };

  it('keeps root names plain and scopes nested manifests by directory', () => {
    const snap = inspectEnvironment(files);
    expect(snap.dependencies).toEqual({
      'left-pad': '1.0.0',
      'packages/a::left-pad': '2.0.0',
      'packages/b::left-pad': '3.0.0',
    });
    expect(snap.scripts).toEqual({ build: 'tsc', 'packages/a::build': 'vite build' });
  });

  it('a change in one workspace always changes the fingerprint', () => {
    const base = inspectEnvironment(files).fingerprint;
    for (const dir of ['packages/a', 'packages/b']) {
      const changed = {
        ...files,
        [`${dir}/package.json`]: files[`${dir}/package.json` as keyof typeof files].replace(
          'left-pad',
          'left-pad-x',
        ),
      };
      expect(inspectEnvironment(changed).fingerprint).not.toBe(base);
    }
  });

  it('nested toolchain files are scoped as well', () => {
    const snap = inspectEnvironment({ '.nvmrc': '22', 'apps/web/.nvmrc': '20' });
    expect(snap.runtimes).toEqual({ node: '22', 'apps/web::node': '20' });
  });
});

describe('CP-4 credentials are never stored', () => {
  const secret = 'ghp_SUPERSECRETVALUE123';

  it('redacts URL user-info in dependency specs and scripts', () => {
    const snap = inspectEnvironment({
      'package.json': JSON.stringify({
        dependencies: {
          private: `git+https://user:${secret}@github.com/acme/private.git`,
          other: `https://${secret}@host/x.tgz`,
        },
        scripts: { fetch: `curl https://deploy:${secret}@ci.example/run` },
      }),
    });
    const serialised = JSON.stringify(snap);
    expect(serialised).not.toContain(secret);
    expect(snap.dependencies['private']).toBe('git+https://<redacted>@github.com/acme/private.git');
  });

  it('redacts secret-looking NAME=value assignments and --token flags in scripts', () => {
    const snap = inspectEnvironment({
      'package.json': JSON.stringify({
        scripts: {
          publish: `NPM_TOKEN=${secret} npm publish`,
          quoted: `API_KEY="${secret} with space" node x.js`,
          flag: `deploy --token ${secret} --env prod`,
          flagEq: `deploy --password=${secret}`,
          benign: 'NODE_ENV=production node server.js',
        },
      }),
    });
    expect(JSON.stringify(snap)).not.toContain(secret);
    expect(snap.scripts['benign']).toBe('NODE_ENV=production node server.js');
    expect(snap.scripts['publish']).toBe('NPM_TOKEN=<redacted> npm publish');
  });

  it('redacts credentials in Python specs, pyproject dependencies and image references', () => {
    const snap = inspectExtendedEnvironment({
      'pyproject.toml': `[project.dependencies]\nprivate = "git+https://u:${secret}@host/x.git"\n`,
      Dockerfile: `FROM registry.example/app:1\n`,
      '.devcontainer/devcontainer.json': JSON.stringify({ image: `https://u:${secret}@reg/img` }),
    });
    expect(JSON.stringify(snap)).not.toContain(secret);
  });

  it('redaction is linear on hostile input', () => {
    const started = performance.now();
    redactSecrets('A'.repeat(1_000_000));
    redactSecrets('://'.repeat(300_000));
    redactSecrets('A="'.repeat(200_000));
    redactSecrets('--token '.repeat(100_000));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('leaves ordinary values untouched', () => {
    expect(redactSecrets('^1.2.3')).toBe('^1.2.3');
    expect(redactSecrets('node --max-old-space-size=4096 build.js')).toBe(
      'node --max-old-space-size=4096 build.js',
    );
    expect(redactSecrets('https://registry.npmjs.org/x.tgz')).toBe(
      'https://registry.npmjs.org/x.tgz',
    );
  });
});

describe('CP-6 skipped files are reported, not silent', () => {
  it('states how many oversized files were skipped', () => {
    const snap = inspectEnvironment({
      'package.json': `{"name":"${'x'.repeat(2 * 1024 * 1024 + 10)}"}`,
    });
    expect(
      snap.limitations.some((l) => /1 supplied file\(s\) larger than 2 MiB were skipped/.test(l)),
    ).toBe(true);
  });
});

describe('CP-7 Windows-style separators', () => {
  it('recognises manifests and scopes keys with backslash paths', () => {
    const snap = inspectEnvironment({ 'apps\\web\\package.json': '{"dependencies":{"x":"1"}}' });
    expect(snap.dependencies).toEqual({ 'apps\\web::x': '1' });
  });
});
