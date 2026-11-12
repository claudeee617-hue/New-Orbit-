import { createHash } from 'node:crypto';
import {
  dict,
  inspectEnvironment,
  redactSecrets,
  scopedKey,
  type EnvironmentSnapshot,
} from './capsule.js';

export interface ExtendedEnvironmentSnapshot {
  schemaVersion: 1;
  base: EnvironmentSnapshot;
  toolchains: Record<string, string>;
  declaredDependencies: Record<string, string>;
  containerImages: Array<{ file: string; image: string }>;
  workspaceSignals: string[];
  ignoredOrUnparsedManifests: string[];
  fingerprint: string;
  limitations: string[];
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_FILES = 1000;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function sortedRecord(source: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)));
}

function parseToolVersions(path: string, content: string, target: Record<string, string>): void {
  const aliases: Record<string, string> = {
    nodejs: 'node',
    python: 'python',
    java: 'java',
    golang: 'go',
    rust: 'rust',
    ruby: 'ruby',
    terraform: 'terraform',
  };
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s+([^\s#]+)/.exec(line);
    if (!match) continue;
    const tool = aliases[match[1]!.toLowerCase()];
    if (tool) target[scopedKey(path, tool)] = match[2]!;
  }
}

function parseRequirements(path: string, content: string, target: Record<string, string>): void {
  for (const line of content.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('-') || value.startsWith('[')) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*(?:===|==|~=|>=|<=|>|<)\s*([^;\s#]+)/.exec(value);
    if (match) target[scopedKey(path, match[1]!)] = redactSecrets(match[2]!);
  }
}

function parsePyproject(path: string, content: string, target: Record<string, string>): void {
  const lines = content.split(/\r?\n/);
  let section = '';
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1]!.toLowerCase();
      continue;
    }
    if (
      !/(^project\.dependencies$|^tool\.poetry\.dependencies$|^tool\.uv\.sources\.)/.test(section)
    )
      continue;
    const item = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/.exec(line);
    if (item) target[scopedKey(path, item[1]!)] = redactSecrets(item[2]!);
  }
}

function parseDockerImages(path: string, content: string): Array<{ file: string; image: string }> {
  const images: Array<{ file: string; image: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+[^\s]+)?\s*$/i.exec(line);
    if (match) images.push({ file: path, image: redactSecrets(match[1]!) });
  }
  return images;
}

/**
 * Expand the supplied-manifest inspection with common polyglot toolchain and workspace signals.
 * It never opens paths or executes package managers; only caller-supplied text is inspected.
 */
export function inspectExtendedEnvironment(
  files: Readonly<Record<string, string>>,
): ExtendedEnvironmentSnapshot {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Environment manifest set must be a path-to-text object');
  }
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > MAX_TOTAL_FILES)
    throw new Error(`Environment manifest set exceeds ${MAX_TOTAL_FILES} files`);
  let totalBytes = 0;
  for (const [path, content] of entries) {
    if (typeof path !== 'string' || !path || typeof content !== 'string') {
      throw new Error('Environment manifest paths and contents must be strings');
    }
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_FILE_BYTES) {
      throw new Error(`Environment manifest exceeds the 2 MiB limit: ${path}`);
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Environment manifest set exceeds the 16 MiB total limit');
    }
  }

  const base = inspectEnvironment(files);
  const toolchains = Object.assign(dict(), base.runtimes);
  const declaredDependencies = Object.assign(dict(), base.dependencies);
  const containerImages: Array<{ file: string; image: string }> = [];
  const workspaceSignals = new Set<string>();
  const ignoredOrUnparsedManifests: string[] = [];

  for (const [path, content] of entries) {
    const basename = path.split(/[\\/]/).at(-1) ?? path;
    if (basename === '.tool-versions') {
      parseToolVersions(path, content, toolchains);
    } else if (basename === 'rust-toolchain' || basename === 'rust-toolchain.toml') {
      const channel =
        /(?:^|\n)\s*channel\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ??
        content.trim().split(/\r?\n/)[0];
      if (channel) toolchains[scopedKey(path, 'rust')] = channel.slice(0, 100);
    } else if (basename === 'requirements.txt' || basename === 'requirements-dev.txt') {
      parseRequirements(path, content, declaredDependencies);
    } else if (basename === 'pyproject.toml') {
      parsePyproject(path, content, declaredDependencies);
    } else if (basename === 'Dockerfile' || basename.startsWith('Dockerfile.')) {
      containerImages.push(...parseDockerImages(path, content));
    } else if (basename === 'devcontainer.json') {
      try {
        const config = JSON.parse(content) as Record<string, unknown>;
        if (typeof config.image === 'string')
          containerImages.push({ file: path, image: redactSecrets(config.image) });
        if (typeof config.dockerFile === 'string')
          workspaceSignals.add(`devcontainer-dockerfile:${config.dockerFile}`);
        const features = config.features;
        if (features && typeof features === 'object' && !Array.isArray(features)) {
          for (const key of Object.keys(features))
            workspaceSignals.add(`devcontainer-feature:${key}`);
        }
      } catch {
        ignoredOrUnparsedManifests.push(path);
      }
    } else if (basename === 'pnpm-workspace.yaml') {
      workspaceSignals.add('pnpm-workspace');
    } else if (basename === 'lerna.json') {
      workspaceSignals.add('lerna-workspace');
    } else if (basename === 'turbo.json') {
      workspaceSignals.add('turborepo');
    } else if (basename === 'nx.json') {
      workspaceSignals.add('nx-workspace');
    } else if (basename === 'Cargo.toml' && /\[workspace\]/.test(content)) {
      workspaceSignals.add('cargo-workspace');
    } else if (basename === 'go.work') {
      workspaceSignals.add('go-workspace');
    } else if (basename === 'package.json') {
      try {
        const data = JSON.parse(content) as Record<string, unknown>;
        if (Array.isArray(data.workspaces)) workspaceSignals.add('npm-workspaces');
      } catch {
        ignoredOrUnparsedManifests.push(path);
      }
    } else if (
      basename.endsWith('.lock') &&
      !/^(poetry\.lock|uv\.lock|Cargo\.lock)$/.test(basename)
    ) {
      ignoredOrUnparsedManifests.push(path);
    }
  }

  const body = {
    schemaVersion: 1 as const,
    base,
    toolchains: sortedRecord(toolchains),
    declaredDependencies: sortedRecord(declaredDependencies),
    containerImages: containerImages.sort(
      (a, b) => a.file.localeCompare(b.file) || a.image.localeCompare(b.image),
    ),
    workspaceSignals: [...workspaceSignals].sort(),
    ignoredOrUnparsedManifests: [...new Set(ignoredOrUnparsedManifests)].sort(),
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return {
    ...body,
    fingerprint,
    limitations: [
      ...base.limitations,
      'Toolchain and dependency declarations are parsed from supplied manifest text; ORBIT does not execute tools or inspect the actual installed environment.',
      'Python requirements and TOML dependency extraction cover common declaration forms, not every valid PEP 621, Poetry, Conda or platform-marker expression.',
      'Docker image references are declarations only; tags are not resolved to immutable digests.',
      'Workspace signals indicate manifest declarations and do not prove every workspace member was discovered.',
    ],
  };
}
