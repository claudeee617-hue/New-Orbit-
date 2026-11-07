import { z } from 'zod';
import { OrbitError, isSafeRepoRelativePath, normalizeRepoRelativePath } from '@orbit/shared';
import { canonicalJson } from './canonical.js';
import {
  EDGE_TYPES,
  EVIDENCE_SOURCE_TYPES,
  EVIDENCE_STATUSES,
  LIMITS,
  NODE_TYPES,
} from './vocabulary.js';

const entityId = z.string().min(1).max(128);
const sha256 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character SHA-256 hex digest')
  .transform((value) => value.toLowerCase());
const commitSha = z
  .string()
  .regex(/^[0-9a-fA-F]{7,64}$/, 'must be a hexadecimal commit SHA')
  .transform((value) => value.toLowerCase());

const safePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(isSafeRepoRelativePath, 'must be a relative path inside the repository')
  .transform(normalizeRepoRelativePath);

const attrsSchema = z
  .record(z.string(), z.json())
  .refine((attrs) => {
    try {
      return Buffer.byteLength(canonicalJson(attrs), 'utf8') <= LIMITS.maxAttrsBytes;
    } catch {
      return false;
    }
  }, `must be JSON data of at most ${LIMITS.maxAttrsBytes} bytes`)
  .default({});

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

// ---------------------------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------------------------

export const repositoryInputSchema = z.strictObject({
  key: z.string().min(1).max(LIMITS.maxKeyLength),
  displayName: z.string().min(1).max(256).optional(),
});
export type RepositoryInput = z.output<typeof repositoryInputSchema>;

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

export const evidenceInputSchema = z
  .strictObject({
    repositoryId: entityId,
    source: z.string().min(1).max(LIMITS.maxSourceLength),
    sourceType: z.enum(EVIDENCE_SOURCE_TYPES),
    timestamp: z.iso.datetime({ offset: true }).optional(),
    commitSha: commitSha.optional(),
    location: z
      .strictObject({
        path: safePath,
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      })
      .refine(
        (location) =>
          location.startLine === undefined ||
          location.endLine === undefined ||
          location.endLine >= location.startLine,
        { message: 'endLine must not be before startLine', path: ['endLine'] },
      )
      .optional(),
    contentHash: sha256,
    status: z.enum(EVIDENCE_STATUSES),
    limitations: z
      .array(z.string().min(1).max(LIMITS.maxLimitationLength))
      .max(LIMITS.maxLimitations),
    relatedEntityIds: z.array(entityId).max(LIMITS.maxRelatedEntities).transform(sortedUnique),
    supersedes: entityId.optional(),
  })
  .refine(
    (evidence) =>
      !(
        (evidence.status === 'NOT_MEASURED' || evidence.status === 'INCOMPLETE') &&
        evidence.limitations.length === 0
      ),
    {
      message: 'NOT_MEASURED and INCOMPLETE evidence must explain why in limitations',
      path: ['limitations'],
    },
  )
  .refine((evidence) => !(evidence.sourceType === 'ai-note' && evidence.status === 'PASS'), {
    message: 'AI-generated notes can never have status PASS',
    path: ['status'],
  });
export type EvidenceInput = z.output<typeof evidenceInputSchema>;

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

export const nodeInputSchema = z
  .strictObject({
    repositoryId: entityId,
    type: z.enum(NODE_TYPES),
    key: z.string().min(1).max(LIMITS.maxKeyLength),
    attrs: attrsSchema,
    sourceEvidenceId: entityId,
    validFromCommit: commitSha.optional(),
  })
  .refine((node) => node.type !== 'File' || isSafeRepoRelativePath(node.key), {
    message: 'File keys must be relative paths inside the repository',
    path: ['key'],
  })
  .refine((node) => node.type !== 'Commit' || /^[0-9a-fA-F]{7,64}$/.test(node.key), {
    message: 'Commit keys must be hexadecimal commit SHAs',
    path: ['key'],
  })
  .transform((node) => {
    if (node.type === 'File') return { ...node, key: normalizeRepoRelativePath(node.key) };
    if (node.type === 'Commit') return { ...node, key: node.key.toLowerCase() };
    return node;
  });
export type NodeInput = z.output<typeof nodeInputSchema>;

export const nodeRetireSchema = z.strictObject({
  repositoryId: entityId,
  nodeId: entityId,
  sourceEvidenceId: entityId,
  atCommit: commitSha.optional(),
});
export type NodeRetireInput = z.output<typeof nodeRetireSchema>;

// ---------------------------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------------------------

export const edgeInputSchema = z.strictObject({
  repositoryId: entityId,
  type: z.enum(EDGE_TYPES),
  fromId: entityId,
  toId: entityId,
  attrs: attrsSchema,
  /** Parser confidence in [0, 1]. Leave unset when the relationship was not produced by a parser. */
  confidence: z.number().min(0).max(1).optional(),
  sourceEvidenceId: entityId,
  validFromCommit: commitSha.optional(),
});
export type EdgeInput = z.output<typeof edgeInputSchema>;

export const edgeRetireSchema = z.strictObject({
  repositoryId: entityId,
  edgeId: entityId,
  sourceEvidenceId: entityId,
  atCommit: commitSha.optional(),
});
export type EdgeRetireInput = z.output<typeof edgeRetireSchema>;

// ---------------------------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------------------------

/**
 * Validate untrusted input. Failures become `INVALID_INPUT` errors that name the offending fields
 * but never echo submitted values.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  throw new OrbitError(
    'INVALID_INPUT',
    `Invalid ${what}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
    { details: { issues } },
  );
}
