import type { Severity } from './types.js';

export type SensitiveCategory =
  | 'secret'
  | 'ci-workflow'
  | 'dependency-manifest'
  | 'lockfile'
  | 'container'
  | 'auth-security'
  | 'database-migration'
  | 'infrastructure';

export interface SensitiveMatch {
  category: SensitiveCategory;
  severity: Severity;
  reason: string;
}

interface Rule {
  category: SensitiveCategory;
  severity: Severity;
  reason: string;
  test: (path: string, base: string) => boolean;
}

const RULES: readonly Rule[] = [
  {
    category: 'secret',
    severity: 'critical',
    reason: 'Credential-bearing file names should never be committed',
    test: (_p, b) =>
      (/^\.env(\..+)?$/.test(b) && !/\.(example|sample|template)$/.test(b)) ||
      /\.(pem|key|p12|pfx|jks|keystore)$/.test(b) ||
      /^id_(rsa|dsa|ecdsa|ed25519)$/.test(b) ||
      b === '.npmrc' ||
      b === '.pypirc' ||
      b === '.netrc' ||
      b === 'credentials.json' ||
      b === 'secrets.json',
  },
  {
    category: 'ci-workflow',
    severity: 'high',
    reason: 'CI configuration controls what runs with repository credentials',
    test: (p) =>
      /^\.github\/workflows\//.test(p) ||
      p === '.gitlab-ci.yml' ||
      p.startsWith('.circleci/') ||
      p === 'Jenkinsfile' ||
      p === 'azure-pipelines.yml',
  },
  {
    category: 'auth-security',
    severity: 'high',
    reason: 'Path suggests authentication, authorisation or cryptography code',
    test: (p) =>
      /(^|[/._-])(auth|authn|authz|authentication|authorization|authorisation|security|crypto|permissions?|acl|oauth|sso|session|passwords?|jwt|tokens?)([/._-]|$)/i.test(
        p,
      ),
  },
  {
    category: 'dependency-manifest',
    severity: 'medium',
    reason: 'Dependency changes alter the supply chain',
    test: (_p, b) =>
      [
        'package.json',
        'requirements.txt',
        'pyproject.toml',
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        'cargo.toml',
        'go.mod',
        'gemfile',
      ].includes(b.toLowerCase()) || /^requirements[^/]*\.txt$/.test(b),
  },
  {
    category: 'lockfile',
    severity: 'medium',
    reason: 'Lockfile changes alter the exact versions that get installed',
    test: (_p, b) =>
      [
        'pnpm-lock.yaml',
        'package-lock.json',
        'yarn.lock',
        'poetry.lock',
        'cargo.lock',
        'go.sum',
        'gemfile.lock',
        'uv.lock',
      ].includes(b.toLowerCase()),
  },
  {
    category: 'container',
    severity: 'medium',
    reason: 'Container definitions change the runtime environment',
    test: (_p, b) => /^dockerfile(\..+)?$/i.test(b) || /^docker-compose(\..+)?\.ya?ml$/i.test(b),
  },
  {
    category: 'database-migration',
    severity: 'medium',
    reason: 'Schema migrations are hard to reverse',
    test: (p) => /(^|\/)(migrations?|drizzle)\/[^/]+\.(sql|ts|js|py)$/i.test(p),
  },
  {
    category: 'infrastructure',
    severity: 'medium',
    reason: 'Infrastructure definitions change deployed resources',
    test: (p, b) => /\.(tf|tfvars)$/.test(b) || /(^|\/)(k8s|kubernetes|helm|terraform)\//i.test(p),
  },
];

export function detectSensitive(path: string): SensitiveMatch[] {
  const base = path.split('/').pop() ?? path;
  const out: SensitiveMatch[] = [];
  for (const rule of RULES)
    if (rule.test(path, base))
      out.push({ category: rule.category, severity: rule.severity, reason: rule.reason });
  return out;
}
