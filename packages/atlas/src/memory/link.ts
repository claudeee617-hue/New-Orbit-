import { hashValue, nodeIdFor, type EdgeRecord, type NodeRecord } from '@orbit/core';
import type { MemoryEngine } from './engine.js';
import { nodeTypeFor } from './engine.js';
import { tokenize } from './text.js';
import type { MemoryItem } from './types.js';

const PAGE = 5000;
const MAX_LINKS = 5000;

export interface MemoryLink {
  memoryId: string;
  target: string;
  targetType: 'Commit' | 'PullRequest' | 'Issue';
  confidence: number;
  basis: string;
}

export interface LinkResult {
  commitsConsidered: number;
  links: MemoryLink[];
  pullRequests: number;
  issues: number;
  fixes: number;
  retired: number;
  limitations: string[];
}

const PR_PATTERNS = [/\bMerge pull request #(\d+)\b/i, /\(#(\d+)\)\s*$/];
const ISSUE_PATTERN =
  /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/gi;
const ADR_PATTERN = /\bADR[-_ #]?0*(\d{1,5})\b/gi;

function* allNodes(engine: MemoryEngine, type: 'Commit'): Generator<NodeRecord> {
  for (let offset = 0; ; offset += PAGE) {
    const page = engine.store.nodes.find(engine.repositoryId, { type, limit: PAGE, offset });
    yield* page;
    if (page.length < PAGE) return;
  }
}

/**
 * Connect git history to memory, but only where the text of the history supports it:
 *  - a commit subject that cites `ADR-n`, a memory id, or the exact title of a memory item;
 *  - a commit, pull request or issue the memory cites as an explicit source reference.
 * "(#12)" at the end of a subject is read as a pull request, "fixes #34" as an issue. ORBIT does not read
 * GitHub yet, so those nodes say they were inferred from commit subjects. Links that stop being
 * supported are retired, not deleted.
 */
export function linkMemoryToHistory(engine: MemoryEngine): LinkResult {
  const { store, repositoryId } = engine;
  const items = engine.all().filter((i) => i.status === 'active');
  const commits = [...allNodes(engine, 'Commit')];
  const limitations = [
    'Only commit subjects are read (not message bodies), so links based on body text are missed.',
    'Pull request and issue nodes are inferred from commit subjects; GitHub itself has not been queried.',
    'A title match requires the full title (3+ words) in the subject; paraphrases are not linked.',
  ];
  const titleKeys = items
    .map((item) => ({ item, key: tokenize(item.title, 1).join(' ') }))
    .filter((t) => t.key.split(' ').length >= 3);

  const links: MemoryLink[] = [];
  const prNumbers = new Map<number, string>(); // PR number -> first commit sha seen
  const issueNumbers = new Map<number, string>();
  const fixes: { commit: NodeRecord; issue: number }[] = [];

  for (const commit of commits) {
    const subject = typeof commit.attrs['subject'] === 'string' ? commit.attrs['subject'] : '';
    if (subject === '') continue;
    const prs = new Set<number>();
    for (const pattern of PR_PATTERNS) {
      const m = pattern.exec(subject);
      if (m) prs.add(Number(m[1]));
    }
    const issues = new Set<number>([...subject.matchAll(ISSUE_PATTERN)].map((m) => Number(m[1])));
    for (const n of prs) if (!prNumbers.has(n)) prNumbers.set(n, commit.key);
    for (const n of issues) {
      if (!issueNumbers.has(n)) issueNumbers.set(n, commit.key);
      fixes.push({ commit, issue: n });
    }

    const adrNumbers = new Set([...subject.matchAll(ADR_PATTERN)].map((m) => Number(m[1])));
    const normalised = tokenize(subject, 1).join(' ');
    const matched = new Map<string, { confidence: number; basis: string }>();
    for (const item of items) {
      if (item.adrNumber !== undefined && adrNumbers.has(item.adrNumber)) {
        matched.set(item.id, { confidence: 0.95, basis: `subject cites ADR-${item.adrNumber}` });
      } else if (subject.toLowerCase().includes(item.id.toLowerCase())) {
        matched.set(item.id, { confidence: 0.9, basis: 'subject cites the memory id' });
      }
    }
    for (const { item, key } of titleKeys) {
      if (!matched.has(item.id) && ` ${normalised} `.includes(` ${key} `)) {
        matched.set(item.id, { confidence: 0.6, basis: 'subject contains the exact memory title' });
      }
    }
    for (const [memoryId, m] of matched) {
      links.push({ memoryId, target: commit.key, targetType: 'Commit', ...m });
      // The same commit tells us which PR / issue carried the decision.
      for (const n of prs) {
        links.push({
          memoryId,
          target: `pr/${n}`,
          targetType: 'PullRequest',
          confidence: Math.round(m.confidence * 80) / 100,
          basis: `${m.basis}; PR number read from the same subject`,
        });
      }
      for (const n of issues) {
        links.push({
          memoryId,
          target: `issue/${n}`,
          targetType: 'Issue',
          confidence: Math.round(m.confidence * 80) / 100,
          basis: `${m.basis}; issue number read from the same subject`,
        });
      }
    }
  }

  // Explicit references written by a person always win (confidence 1).
  const commitByPrefix = (sha: string): NodeRecord | undefined => {
    const found = commits.filter((c) => c.key.startsWith(sha));
    return found.length === 1 ? found[0] : undefined;
  };
  for (const item of items) {
    for (const ref of item.sourceRefs) {
      if (ref.kind === 'commit') {
        const commit = commitByPrefix(ref.sha);
        if (commit)
          links.push({
            memoryId: item.id,
            target: commit.key,
            targetType: 'Commit',
            confidence: 1,
            basis: 'explicit source reference',
          });
        else
          limitations.push(
            `${item.id} cites commit ${ref.sha.slice(0, 10)} which is not in the indexed history.`,
          );
      } else if (ref.kind === 'pull-request') {
        prNumbers.set(ref.number, prNumbers.get(ref.number) ?? '');
        links.push({
          memoryId: item.id,
          target: `pr/${ref.number}`,
          targetType: 'PullRequest',
          confidence: 1,
          basis: 'explicit source reference',
        });
      } else if (ref.kind === 'issue') {
        issueNumbers.set(ref.number, issueNumbers.get(ref.number) ?? '');
        links.push({
          memoryId: item.id,
          target: `issue/${ref.number}`,
          targetType: 'Issue',
          confidence: 1,
          basis: 'explicit source reference',
        });
      }
    }
  }

  // Keep the strongest basis per (memory, target); order deterministically; bound the output.
  const best = new Map<string, MemoryLink>();
  for (const link of links) {
    const key = `${link.memoryId}\0${link.target}`;
    const prior = best.get(key);
    if (!prior || link.confidence > prior.confidence) best.set(key, link);
  }
  let final = [...best.values()].sort(
    (a, b) => a.memoryId.localeCompare(b.memoryId) || a.target.localeCompare(b.target),
  );
  if (final.length > MAX_LINKS) {
    limitations.push(
      `More than ${MAX_LINKS} links matched; only the first ${MAX_LINKS} were recorded.`,
    );
    final = final.slice(0, MAX_LINKS);
  }
  const usedPrs = new Set(final.filter((l) => l.targetType === 'PullRequest').map((l) => l.target));
  const usedIssues = new Set([
    ...final.filter((l) => l.targetType === 'Issue').map((l) => l.target),
    ...fixes.map((f) => `issue/${f.issue}`),
  ]);

  const evidenceHash = hashValue({
    links: final,
    fixes: fixes.map((f) => [f.commit.key, f.issue]).sort(),
  });
  let retired = 0;
  store.transaction(() => {
    const evidence = store.evidence.append({
      repositoryId,
      source: 'memory-link:git-subjects',
      sourceType: 'git',
      contentHash: evidenceHash,
      status: 'PARTIAL',
      limitations,
      relatedEntityIds: final
        .slice(0, 500)
        .map((l) => nodeIdFor(repositoryId, 'Decision', l.memoryId)),
    }).record.id;

    const ensure = (kind: 'pr' | 'issue', number: number, from: string | undefined): string => {
      const type = kind === 'pr' ? 'PullRequest' : 'Issue';
      const key = `${kind}/${number}`;
      return store.nodes.upsert({
        repositoryId,
        type,
        key,
        attrs: {
          producer: 'memory-link',
          number,
          certainty:
            'inferred from references in commit subjects or memory source references; GitHub was not queried',
          ...(from ? { firstSeenInCommit: from } : {}),
        },
        sourceEvidenceId: evidence,
      }).record.id;
    };
    const prIds = new Map<string, string>();
    for (const target of usedPrs) {
      const n = Number(target.slice(3));
      prIds.set(target, ensure('pr', n, prNumbers.get(n) || undefined));
    }
    const issueIds = new Map<string, string>();
    for (const target of usedIssues) {
      const n = Number(target.slice(6));
      issueIds.set(target, ensure('issue', n, issueNumbers.get(n) || undefined));
    }

    const desired = new Set<string>();
    const itemsById = new Map(items.map((i) => [i.id, i]));
    for (const link of final) {
      const item = itemsById.get(link.memoryId) as MemoryItem;
      const from = nodeIdFor(repositoryId, nodeTypeFor(item.category), item.id);
      const to =
        link.targetType === 'Commit'
          ? nodeIdFor(repositoryId, 'Commit', link.target)
          : (link.targetType === 'PullRequest' ? prIds : issueIds).get(link.target);
      if (!to) continue;
      const edge = store.edges.upsert({
        repositoryId,
        type: 'DOCUMENTS',
        fromId: from,
        toId: to,
        confidence: link.confidence,
        attrs: { producer: 'memory-link', basis: link.basis },
        sourceEvidenceId: evidence,
      });
      desired.add(edge.record.id);
    }
    for (const f of fixes) {
      const edge = store.edges.upsert({
        repositoryId,
        type: 'FIXES',
        fromId: f.commit.id,
        toId: issueIds.get(`issue/${f.issue}`) as string,
        confidence: 0.8,
        attrs: {
          producer: 'memory-link',
          basis: 'commit subject says it fixes or closes the issue',
        },
        sourceEvidenceId: evidence,
      });
      desired.add(edge.record.id);
    }

    // Retire links this function wrote earlier that the history no longer supports.
    const stale: EdgeRecord[] = [];
    for (const type of ['DOCUMENTS', 'FIXES'] as const) {
      for (let offset = 0; ; offset += PAGE) {
        const page = store.edges.list(repositoryId, { types: [type], limit: PAGE, offset });
        stale.push(
          ...page.filter((e) => e.attrs['producer'] === 'memory-link' && !desired.has(e.id)),
        );
        if (page.length < PAGE) break;
      }
    }
    for (const edge of stale) {
      store.edges.retire({ repositoryId, edgeId: edge.id, sourceEvidenceId: evidence });
      retired += 1;
    }
  });

  return {
    commitsConsidered: commits.length,
    links: final,
    pullRequests: usedPrs.size,
    issues: usedIssues.size,
    fixes: fixes.length,
    retired,
    limitations: [...new Set(limitations)].sort(),
  };
}
