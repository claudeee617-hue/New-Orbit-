import { createHash } from 'node:crypto';

/** A string-keyed map without a prototype, so manifest keys such as `__proto__` or `constructor` are plain data. */
export function dict(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

const SECRET_NAME = /token|secret|passw|api[_-]?key|apikey|auth|credential|private[_-]?key/i;

/**
 * Best-effort removal of credentials from manifest text before it is stored, fingerprinted or
 * displayed: URL user-info (`https://user:pass@host`), `NAME=value` assignments whose name looks
 * secret, and `--token value` style flags. This is a heuristic, not a guarantee that no secret
 * can ever appear in a manifest value.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/:\/\/([^\s/@]*)@/g, '://<redacted>@')
    .replace(
      /(^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]{0,200})=("[^"]*"|'[^']*'|[^\s;&|)]*)/g,
      (all: string, lead: string, name: string) =>
        SECRET_NAME.test(name) ? `${lead}${name}=<redacted>` : all,
    )
    .replace(
      /(--?(?:[a-z-]{0,40})?(?:token|password|passwd|secret|api-?key|auth)[a-z-]{0,20})(=|\s+)("[^"]*"|'[^']*'|[^\s;&|)]+)/gi,
      '$1$2<redacted>',
    );
}

/** Directory part of a manifest path using either separator; '' for a root-level file. */
export function manifestDir(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Key for a value declared in a manifest. Root-level manifests keep the plain name; nested
 * manifests (monorepo workspaces) are prefixed with their directory so a value declared in one
 * workspace cannot overwrite or hide the same name in another.
 */
export function scopedKey(path: string, name: string): string {
  const dir = manifestDir(path);
  return dir ? `${dir}::${name}` : name;
}

export interface EnvironmentSnapshot {
  schemaVersion: 1;
  runtimes: Record<string, string>;
  packageManagers: string[];
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  environmentVariableNames: string[];
  containerFiles: string[];
  lockfiles: Array<{ path: string; sha256: string }>;
  fingerprint: string;
  limitations: string[];
}

export interface EnvironmentDifference {
  kind:
    | 'runtime'
    | 'package-manager'
    | 'dependency'
    | 'script'
    | 'environment-variable'
    | 'container'
    | 'lockfile';
  key: string;
  before: string | null;
  after: string | null;
}

/** Inspect only explicitly supplied configuration files. Secret values are never extracted. */
export function inspectEnvironment(files: Readonly<Record<string, string>>): EnvironmentSnapshot {
  const runtimes = dict();
  const packageManagers = new Set<string>();
  const dependencies = dict();
  const scripts = dict();
  let skippedLarge = 0;
  const environmentVariableNames = new Set<string>();
  const containerFiles: string[] = [];
  const lockfiles: Array<{ path: string; sha256: string }> = [];

  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
      skippedLarge += 1;
      continue;
    }
    const basename = path.split(/[\\/]/).at(-1) ?? path;
    if (basename === 'package.json') {
      try {
        const data = JSON.parse(content) as {
          packageManager?: unknown;
          engines?: Record<string, unknown>;
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
          scripts?: Record<string, unknown>;
        };
        if (typeof data.packageManager === 'string') packageManagers.add(data.packageManager);
        if (data.engines)
          for (const [key, value] of Object.entries(data.engines)) {
            if (typeof value === 'string') runtimes[scopedKey(path, key)] = value.slice(0, 200);
          }
        for (const section of [data.dependencies, data.devDependencies]) {
          if (!section) continue;
          for (const [name, version] of Object.entries(section)) {
            if (typeof version === 'string')
              dependencies[scopedKey(path, name)] = redactSecrets(version);
          }
        }
        if (data.scripts)
          for (const [name, command] of Object.entries(data.scripts)) {
            if (typeof command === 'string')
              scripts[scopedKey(path, name)] = redactSecrets(command);
          }
      } catch {
        runtimes[scopedKey(path, 'package.json')] = 'unparseable';
      }
    } else if (basename === '.nvmrc' || basename === '.node-version') {
      runtimes[scopedKey(path, 'node')] = content.trim().slice(0, 100);
    } else if (basename === '.python-version') {
      runtimes[scopedKey(path, 'python')] = content.trim().slice(0, 100);
    } else if (basename === 'runtime.txt') {
      runtimes[scopedKey(path, 'runtime')] = content.trim().slice(0, 100);
    } else if (basename === 'go.mod') {
      const match = /^go\s+([\w.]+)/m.exec(content);
      if (match) runtimes[scopedKey(path, 'go')] = match[1]!;
    } else if (basename === 'Cargo.toml') {
      const match = /^rust-version\s*=\s*["']([^"']+)["']/m.exec(content);
      if (match) runtimes[scopedKey(path, 'rust')] = match[1]!;
    } else if (basename === 'pyproject.toml') {
      const match = /^requires-python\s*=\s*["']([^"']+)["']/m.exec(content);
      if (match) runtimes[scopedKey(path, 'python')] = match[1]!;
    } else if (basename === 'pom.xml') {
      const match = /<maven.compiler.(?:release|source)>([^<]+)</i.exec(content);
      if (match) runtimes[scopedKey(path, 'java')] = match[1]!;
    } else if (
      /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum|Pipfile\.lock)$/.test(
        basename,
      )
    ) {
      const hash = createHash('sha256').update(content).digest('hex');
      lockfiles.push({ path, sha256: hash });
      if (basename.startsWith('pnpm')) packageManagers.add('pnpm');
      else if (basename === 'package-lock.json') packageManagers.add('npm');
      else if (basename === 'yarn.lock') packageManagers.add('yarn');
      else if (basename.startsWith('bun.')) packageManagers.add('bun');
      else if (basename === 'poetry.lock') packageManagers.add('poetry');
      else if (basename === 'uv.lock') packageManagers.add('uv');
      else if (basename === 'Cargo.lock') packageManagers.add('cargo');
      else if (basename === 'go.sum') packageManagers.add('go modules');
      else if (basename === 'Pipfile.lock') packageManagers.add('pipenv');
    } else if (
      basename === 'Dockerfile' ||
      basename === 'docker-compose.yml' ||
      basename === 'docker-compose.yaml' ||
      /(^|[\\\\/])\\.devcontainer[\\\\/]devcontainer\\.json$/.test(path) ||
      basename === 'flake.nix'
    ) {
      containerFiles.push(path);
    } else if (basename === '.env.example' || basename === '.env.sample') {
      for (const line of content.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (match) environmentVariableNames.add(match[1]!);
      }
    }
  }

  const base = {
    schemaVersion: 1 as const,
    runtimes: Object.fromEntries(Object.entries(runtimes).sort(([a], [b]) => a.localeCompare(b))),
    packageManagers: [...packageManagers].sort(),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
    ),
    scripts: Object.fromEntries(Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b))),
    environmentVariableNames: [...environmentVariableNames].sort(),
    containerFiles: [...new Set(containerFiles)].sort(),
    lockfiles: lockfiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(base)).digest('hex');
  return {
    ...base,
    fingerprint,
    limitations: [
      ...(skippedLarge > 0
        ? [
            `${skippedLarge} supplied file(s) larger than 2 MiB were skipped and are not reflected here.`,
          ]
        : []),
      'Values declared in nested (workspace) manifests are keyed `<directory>::<name>`; root-level manifests use the plain name.',
      'Credentials embedded in dependency specs and scripts are redacted heuristically before storage; redaction is best-effort.',
      'Only supplied configuration files are inspected; this is not a complete operating-system or container image fingerprint.',
      'Environment variable names are collected from example files only. Secret values are never read or stored.',
      'Dependency versions are manifest declarations, not proof of the exact installed dependency tree.',
    ],
  };
}

export function compareEnvironments(
  before: EnvironmentSnapshot,
  after: EnvironmentSnapshot,
): EnvironmentDifference[] {
  const differences: EnvironmentDifference[] = [];
  const compareRecord = (
    kind: EnvironmentDifference['kind'],
    a: Record<string, string>,
    b: Record<string, string>,
  ) => {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const before = Object.hasOwn(a, key) ? (a[key] ?? null) : null;
      const after = Object.hasOwn(b, key) ? (b[key] ?? null) : null;
      if (before !== after) differences.push({ kind, key, before, after });
    }
  };
  compareRecord('runtime', before.runtimes, after.runtimes);
  compareRecord('dependency', before.dependencies, after.dependencies);
  compareRecord('script', before.scripts, after.scripts);
  const setDiff = (
    kind: EnvironmentDifference['kind'],
    a: readonly string[],
    b: readonly string[],
  ) => {
    for (const value of [...new Set([...a, ...b])].sort()) {
      if (a.includes(value) !== b.includes(value))
        differences.push({
          kind,
          key: value,
          before: a.includes(value) ? value : null,
          after: b.includes(value) ? value : null,
        });
    }
  };
  setDiff('package-manager', before.packageManagers, after.packageManagers);
  setDiff('environment-variable', before.environmentVariableNames, after.environmentVariableNames);
  setDiff('container', before.containerFiles, after.containerFiles);
  const oldLocks = Object.fromEntries(before.lockfiles.map((item) => [item.path, item.sha256]));
  const newLocks = Object.fromEntries(after.lockfiles.map((item) => [item.path, item.sha256]));
  compareRecord('lockfile', oldLocks, newLocks);
  return differences;
}
