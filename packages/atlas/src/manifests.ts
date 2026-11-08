import { posix } from 'node:path';
import type { DiscoveredFile } from './walk.js';

export type DependencyScope = 'runtime' | 'dev' | 'peer' | 'optional';

export interface DeclaredDependency {
  ecosystem: string;
  name: string;
  versionSpec: string;
  scope: DependencyScope;
  /** Repository-relative path of the manifest that declares it. */
  manifestPath: string;
}

export interface DetectedFramework {
  name: string;
  via: string;
  manifestPath: string;
  confidence: number;
}

export interface ManifestAnalysis {
  dependencies: DeclaredDependency[];
  frameworks: DetectedFramework[];
  workspacePackages: { name: string; dir: string }[];
  /** Entry-point files declared in manifests (package.json main/bin/exports). */
  declaredEntryPoints: { path: string; reason: string }[];
  buildSystems: string[];
  limitations: string[];
}

const FRAMEWORKS: Readonly<Record<string, string>> = {
  'npm:react': 'React',
  'npm:next': 'Next.js',
  'npm:vue': 'Vue',
  'npm:@angular/core': 'Angular',
  'npm:svelte': 'Svelte',
  'npm:express': 'Express',
  'npm:fastify': 'Fastify',
  'npm:koa': 'Koa',
  'npm:@nestjs/core': 'NestJS',
  'npm:electron': 'Electron',
  'npm:vite': 'Vite',
  'npm:vitest': 'Vitest',
  'npm:jest': 'Jest',
  'npm:three': 'three.js',
  'pypi:django': 'Django',
  'pypi:flask': 'Flask',
  'pypi:fastapi': 'FastAPI',
  'pypi:pytest': 'pytest',
  'pypi:numpy': 'NumPy',
  'pypi:pandas': 'pandas',
  'pypi:torch': 'PyTorch',
  'pypi:tensorflow': 'TensorFlow',
  'maven:org.springframework.boot': 'Spring Boot',
  'maven:org.junit.jupiter': 'JUnit 5',
  'maven:junit': 'JUnit',
  'cmake:Qt5': 'Qt',
  'cmake:Qt6': 'Qt',
  'cmake:Boost': 'Boost',
  'cmake:OpenCV': 'OpenCV',
  'cmake:GTest': 'GoogleTest',
};

const BUILD_FILES: Readonly<Record<string, string>> = {
  'package.json': 'npm',
  'pnpm-workspace.yaml': 'pnpm workspaces',
  'turbo.json': 'Turborepo',
  'pyproject.toml': 'Python (pyproject)',
  'setup.py': 'Python (setuptools)',
  'pom.xml': 'Maven',
  'build.gradle': 'Gradle',
  'build.gradle.kts': 'Gradle',
  'cmakelists.txt': 'CMake',
  makefile: 'Make',
  dockerfile: 'Docker',
};

export type TextReader = (path: string) => string | undefined;

function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringMap(value: unknown): [string, string][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  );
}

function packageJsonEntries(
  manifest: Record<string, unknown>,
  dir: string,
  files: ReadonlySet<string>,
): { path: string; reason: string }[] {
  const out: { path: string; reason: string }[] = [];
  const add = (target: unknown, reason: string): void => {
    if (typeof target !== 'string') return;
    const normalized = posix.normalize(posix.join(dir, target));
    // Built output is not scanned; map dist/build outputs back to likely sources.
    const candidates = [
      normalized,
      normalized.replace(/\/(dist|build|out|lib)\//, '/src/').replace(/\.(m|c)?js$/, '.ts'),
      normalized.replace(/\/(dist|build|out|lib)\//, '/src/').replace(/\.(m|c)?js$/, '.tsx'),
      normalized.replace(/\/(dist|build|out|lib)\//, '/src/'),
    ];
    const hit = candidates.find((c) => files.has(c));
    if (hit) out.push({ path: hit, reason });
  };
  add(manifest['main'], 'package.json "main"');
  add(manifest['module'], 'package.json "module"');
  const bin = manifest['bin'];
  if (typeof bin === 'string') add(bin, 'package.json "bin"');
  else for (const [name, target] of stringMap(bin)) add(target, `package.json "bin" (${name})`);
  const exportsField = manifest['exports'];
  if (typeof exportsField === 'string') add(exportsField, 'package.json "exports"');
  else if (exportsField !== null && typeof exportsField === 'object') {
    const root = (exportsField as Record<string, unknown>)['.'] ?? exportsField;
    if (typeof root === 'string') add(root, 'package.json "exports"');
    else if (root !== null && typeof root === 'object') {
      for (const value of Object.values(root as Record<string, unknown>))
        add(value, 'package.json "exports"');
    }
  }
  return out;
}

function parseRequirements(text: string, manifestPath: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  const scope: DependencyScope = /dev|test/i.test(posix.basename(manifestPath)) ? 'dev' : 'runtime';
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line === '' || line.startsWith('-') || line.includes('://')) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (match?.[1])
      out.push({
        ecosystem: 'pypi',
        name: match[1].toLowerCase().replace(/_/g, '-'),
        versionSpec: (match[2] ?? '').split(';')[0]?.trim() ?? '',
        scope,
        manifestPath,
      });
  }
  return out;
}

function parsePyproject(text: string, manifestPath: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  const add = (spec: string, scope: DependencyScope): void => {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(spec.trim());
    if (match?.[1] && match[1].toLowerCase() !== 'python')
      out.push({
        ecosystem: 'pypi',
        name: match[1].toLowerCase().replace(/_/g, '-'),
        versionSpec: (match[2] ?? '').split(';')[0]?.trim() ?? '',
        scope,
        manifestPath,
      });
  };
  const array = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  if (array?.[1])
    for (const m of array[1].matchAll(/["']([^"']+)["']/g)) if (m[1]) add(m[1], 'runtime');
  const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (poetry?.[1])
    for (const m of poetry[1].matchAll(/^\s*([A-Za-z0-9._-]+)\s*=\s*["{]?([^\n]*)/gm))
      if (m[1]) add(`${m[1]} ${(m[2] ?? '').replace(/["{}]/g, '')}`, 'runtime');
  return out;
}

function parsePom(text: string, manifestPath: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const block of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = block[1] ?? '';
    const group = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(body)?.[1];
    const artifact = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(body)?.[1];
    if (!group || !artifact) continue;
    const version = /<version>\s*([^<\s]+)\s*<\/version>/.exec(body)?.[1] ?? '';
    const isTest = /<scope>\s*test\s*<\/scope>/.test(body);
    out.push({
      ecosystem: 'maven',
      name: `${group}:${artifact}`,
      versionSpec: version,
      scope: isTest ? 'dev' : 'runtime',
      manifestPath,
    });
  }
  return out;
}

function parseGradle(text: string, manifestPath: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const m of text.matchAll(
    /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompile|compile)\s*\(?\s*["']([^"':]+):([^"':]+)(?::([^"']+))?["']/g,
  )) {
    out.push({
      ecosystem: 'maven',
      name: `${m[2]}:${m[3]}`,
      versionSpec: m[4] ?? '',
      scope: m[1]?.startsWith('test') ? 'dev' : 'runtime',
      manifestPath,
    });
  }
  return out;
}

function parseCmake(text: string, manifestPath: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  for (const m of text.matchAll(/find_package\s*\(\s*([A-Za-z0-9_+-]+)/gi))
    if (m[1])
      out.push({ ecosystem: 'cmake', name: m[1], versionSpec: '', scope: 'runtime', manifestPath });
  return out;
}

/** Read build manifests. JSON manifests are parsed exactly; other formats are parsed as text (stated in limitations). */
export function analyzeManifests(
  files: readonly DiscoveredFile[],
  read: TextReader,
): ManifestAnalysis {
  const paths = new Set(files.map((f) => f.path));
  const result: ManifestAnalysis = {
    dependencies: [],
    frameworks: [],
    workspacePackages: [],
    declaredEntryPoints: [],
    buildSystems: [],
    limitations: [],
  };
  const build = new Set<string>();
  let usedTextParsing = false;

  for (const file of files) {
    const base = posix.basename(file.path).toLowerCase();
    const dir = posix.dirname(file.path) === '.' ? '' : posix.dirname(file.path);
    const system = BUILD_FILES[base];
    if (system) build.add(system);
    if (file.size > 2 * 1024 * 1024) continue;

    if (base === 'package.json') {
      const text = read(file.path);
      const manifest = text === undefined ? undefined : jsonObject(text);
      if (!manifest) {
        result.limitations.push(`${file.path} could not be parsed as JSON`);
        continue;
      }
      const name = manifest['name'];
      if (typeof name === 'string') result.workspacePackages.push({ name, dir });
      const groups: [string, DependencyScope][] = [
        ['dependencies', 'runtime'],
        ['devDependencies', 'dev'],
        ['peerDependencies', 'peer'],
        ['optionalDependencies', 'optional'],
      ];
      for (const [key, scope] of groups) {
        for (const [depName, versionSpec] of stringMap(manifest[key])) {
          result.dependencies.push({
            ecosystem: 'npm',
            name: depName,
            versionSpec,
            scope,
            manifestPath: file.path,
          });
        }
      }
      result.declaredEntryPoints.push(...packageJsonEntries(manifest, dir, paths));
    } else if (/^requirements.*\.txt$/.test(base)) {
      const text = read(file.path);
      if (text !== undefined) result.dependencies.push(...parseRequirements(text, file.path));
      usedTextParsing = true;
    } else if (base === 'pyproject.toml') {
      const text = read(file.path);
      if (text !== undefined) result.dependencies.push(...parsePyproject(text, file.path));
      usedTextParsing = true;
    } else if (base === 'pom.xml') {
      const text = read(file.path);
      if (text !== undefined) result.dependencies.push(...parsePom(text, file.path));
      usedTextParsing = true;
    } else if (base === 'build.gradle' || base === 'build.gradle.kts') {
      const text = read(file.path);
      if (text !== undefined) result.dependencies.push(...parseGradle(text, file.path));
      usedTextParsing = true;
    } else if (base === 'cmakelists.txt') {
      const text = read(file.path);
      if (text !== undefined) result.dependencies.push(...parseCmake(text, file.path));
      usedTextParsing = true;
    }
  }

  const seen = new Set<string>();
  for (const dep of result.dependencies) {
    const framework =
      FRAMEWORKS[`${dep.ecosystem}:${dep.name}`] ??
      (dep.ecosystem === 'maven' ? FRAMEWORKS[`maven:${dep.name.split(':')[0] ?? ''}`] : undefined);
    if (!framework) continue;
    const key = `${framework}|${dep.manifestPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.frameworks.push({
      name: framework,
      via: `${dep.ecosystem}:${dep.name}`,
      manifestPath: dep.manifestPath,
      confidence: 0.9,
    });
  }

  result.buildSystems = [...build].sort();
  if (usedTextParsing) {
    result.limitations.push(
      'requirements.txt, pyproject.toml, pom.xml, build.gradle and CMakeLists.txt are read with text patterns, not full parsers; unusual syntax may be missed',
    );
  }
  result.dependencies.sort(
    (a, b) =>
      a.manifestPath.localeCompare(b.manifestPath) ||
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name),
  );
  result.frameworks.sort(
    (a, b) => a.name.localeCompare(b.name) || a.manifestPath.localeCompare(b.manifestPath),
  );
  result.workspacePackages.sort((a, b) => a.dir.localeCompare(b.dir));
  return result;
}
