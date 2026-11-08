import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryEngine, combineProbes, diskFileProbe, graphFileProbe } from '@orbit/atlas';
import type { EvidenceRecord, RepositoryRecord } from '@orbit/core';
import {
  createGraphStore,
  openDatabase,
  type GraphStore,
  type OrbitDatabase,
} from '@orbit/database';
import { OrbitError } from '@orbit/shared';

export interface OrbitMcpOptions {
  /** Path to the workspace database written by `orbit scan`. Opened read-only. */
  dbPath: string;
  /** Repository key to use when the database holds several. */
  repository?: string;
  /**
   * Working-tree root of the scanned repository. When set, memory staleness is judged against the
   * files on disk (always current); otherwise against hashes from the last scan.
   */
  rootPath?: string;
}

export interface EvidenceSummary {
  id: string;
  source: string;
  sourceType: string;
  status: string;
  limitations: string[];
  contentHash: string;
  commitSha?: string;
  location?: { path: string; startLine?: number | undefined; endLine?: number | undefined };
  recordedAt: string;
}

const MAX_EVIDENCE_IN_RESULT = 10;

export class OrbitContext {
  readonly store: GraphStore;
  private readonly database: OrbitDatabase;

  constructor(readonly options: OrbitMcpOptions) {
    const path = resolve(options.dbPath);
    if (!existsSync(path)) {
      throw new OrbitError(
        'NOT_FOUND',
        `No ORBIT database at ${path}. Run \`orbit scan <path>\` first.`,
        {
          details: { path },
        },
      );
    }
    try {
      this.database = openDatabase({ path, readOnly: true });
    } catch (error) {
      throw new OrbitError(
        'DATABASE_ERROR',
        `Could not open the ORBIT database at ${path} read-only`,
        {
          cause: error,
          details: { path },
        },
      );
    }
    this.store = createGraphStore(this.database);
  }

  close(): void {
    this.database.close();
  }

  /** The repository to answer about: the `repository` argument, the configured one, or the only one. */
  repository(key?: string): RepositoryRecord {
    const all = this.store.repositories.list();
    const wanted = key ?? this.options.repository;
    if (wanted !== undefined) {
      const found = all.find((r) => r.key === wanted);
      if (!found) {
        throw new OrbitError(
          'NOT_FOUND',
          `No scanned repository with key "${wanted}". Known: ${all.map((r) => r.key).join(', ') || 'none'}`,
          {
            details: { key: wanted },
          },
        );
      }
      return found;
    }
    if (all.length === 1 && all[0]) return all[0];
    if (all.length === 0) {
      throw new OrbitError(
        'NOT_FOUND',
        'Nothing has been scanned yet. Run `orbit scan <path>` first.',
      );
    }
    throw new OrbitError(
      'INVALID_INPUT',
      `Several repositories are scanned (${all.map((r) => r.key).join(', ')}); pass "repository".`,
    );
  }

  memory(repositoryId: string): MemoryEngine {
    const graph = graphFileProbe(this.store, repositoryId);
    const probe = this.options.rootPath
      ? combineProbes(diskFileProbe(this.options.rootPath), graph)
      : graph;
    return new MemoryEngine(this.store, repositoryId, { probe });
  }

  /** Compact evidence for tool results: de-duplicated, bounded, in a stable order. */
  evidence(
    repositoryId: string,
    ids: Iterable<string>,
  ): { evidence: EvidenceSummary[]; evidenceOmitted: number } {
    const unique = [...new Set(ids)].sort();
    const out: EvidenceSummary[] = [];
    for (const id of unique) {
      if (out.length >= MAX_EVIDENCE_IN_RESULT) break;
      const record = this.store.evidence.get(repositoryId, id);
      if (record) out.push(summarise(record));
    }
    return { evidence: out, evidenceOmitted: Math.max(0, unique.length - out.length) };
  }
}

export function summarise(record: EvidenceRecord): EvidenceSummary {
  return {
    id: record.id,
    source: record.source,
    sourceType: record.sourceType,
    status: record.status,
    limitations: record.limitations
      .map((l) => (l.length > 300 ? `${l.slice(0, 299)}…` : l))
      .slice(0, 5),
    contentHash: record.contentHash,
    ...(record.commitSha !== undefined && { commitSha: record.commitSha }),
    ...(record.location !== undefined && { location: record.location }),
    recordedAt: record.recordedAt,
  };
}
