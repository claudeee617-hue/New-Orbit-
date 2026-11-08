import { discoverFiles, readSourceFile, type DiscoveredFile } from '../walk.js';
import { resolveConfig } from '../scan.js';
import { nodeIdFor } from '@orbit/core';
import { OrbitError } from '@orbit/shared';
import type { MemoryEngine, ImportedMemory } from './engine.js';
import { slugify } from './engine.js';
import { truncate } from './text.js';
import type { DecisionStatus, MemoryCategory, MemoryItem } from './types.js';

const ADR_DIR =
  /(^|\/)(adrs?|decisions?|architecture[-_ ]decisions?|architectural[-_ ]decisions?)\//i;
const ADR_FILE = /(^|\/)(adr[-_ ]?)?\d{3,5}[-_ ][^/]*\.md$/i;
const NOT_A_RECORD = /(^|\/)(readme|index|template|_template|toc)\.md$/i;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BODY = 4000;

export interface ParsedAdr {
  number?: number;
  title: string;
  status: DecisionStatus;
  statusText?: string;
  supersedesAdr: number[];
  supersededByAdr: number[];
  body: string;
  /** True when the body is only part of the document. */
  excerpt: boolean;
  startLine: number;
  endLine: number;
}

export function isAdrPath(path: string): boolean {
  if (NOT_A_RECORD.test(path)) return false;
  return (ADR_DIR.test(path) || ADR_FILE.test(path)) && /\.md$/i.test(path);
}

function normaliseStatus(text: string): DecisionStatus {
  const lower = text.toLowerCase();
  if (/\bsuperseded\b|\breplaced\b/.test(lower)) return 'superseded';
  if (/\brejected\b|\bdeclined\b/.test(lower)) return 'rejected';
  if (/\bdeprecated\b|\bretired\b/.test(lower)) return 'deprecated';
  if (/\baccepted\b|\bapproved\b|\badopted\b|\bdecided\b/.test(lower)) return 'accepted';
  if (/\bproposed\b|\bdraft\b|\bpending\b|\bunder (review|discussion)\b/.test(lower))
    return 'proposed';
  return 'unknown';
}

const adrNumbers = (text: string): number[] =>
  [...text.matchAll(/\bADR[-_ #]?0*(\d{1,5})\b/gi)].map((m) => Number(m[1]));

/** Parse a Nygard/MADR style ADR. Pure: no file access. Exported for tests. */
export function parseAdr(content: string, path: string): ParsedAdr {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const heading = lines.findIndex((l) => /^#\s+\S/.test(l));
  let title = heading >= 0 ? (lines[heading] as string).replace(/^#\s+/, '').trim() : '';
  const base = path.split('/').pop() ?? path;
  const fileNumber = /^(?:adr[-_ ]?)?0*(\d{1,5})[-_ ]/i.exec(base);
  const titleNumber = /^(?:ADR[-_ #]?)?0*(\d{1,5})\s*[:.\-–—)]\s*/i.exec(title);
  const number = titleNumber
    ? Number(titleNumber[1])
    : fileNumber
      ? Number(fileNumber[1])
      : undefined;
  title = title.replace(/^(?:ADR[-_ #]?)?\d{1,5}\s*[:.\-–—)]\s*/i, '').trim();
  if (title === '') title = base.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');

  let statusText: string | undefined;
  const inline = lines.find((l) => /^\s*(?:[*_-]\s*)?\**status\**\s*[:：]/i.test(l));
  if (inline) {
    statusText = inline
      .replace(/^\s*(?:[*_-]\s*)?\**status\**\s*[:：]\s*/i, '')
      .split(/[·|]/)[0]
      ?.replace(/\*+/g, '')
      .trim();
  } else {
    const at = lines.findIndex((l) => /^#{2,4}\s*status\s*$/i.test(l.trim()));
    if (at >= 0)
      statusText = lines
        .slice(at + 1)
        .find((l) => l.trim() !== '')
        ?.replace(/\*+/g, '')
        .trim();
  }
  const status = statusText ? normaliseStatus(statusText) : 'unknown';
  const supersededByAdr =
    statusText && /superseded|replaced/i.test(statusText) ? adrNumbers(statusText) : [];
  const supersedesAdr = lines
    .filter((l) => /\bsupersedes\b/i.test(l) && !/superseded/i.test(l))
    .flatMap((l) => adrNumbers(l))
    .filter((n) => n !== number);

  const section = (names: RegExp): { text: string; start: number; end: number } | undefined => {
    const at = lines.findIndex(
      (l) => /^#{2,4}\s/.test(l) && names.test(l.replace(/^#+\s*/, '').trim()),
    );
    if (at < 0) return undefined;
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i += 1) {
      if (/^#{1,4}\s/.test(lines[i] as string)) {
        end = i;
        break;
      }
    }
    return {
      text: lines
        .slice(at + 1, end)
        .join('\n')
        .trim(),
      start: at + 1,
      end,
    };
  };
  const decision = section(/^(decision|decision outcome|outcome|the decision)$/i);
  const context = section(
    /^(context|context and problem statement|problem statement|background)$/i,
  );

  let body: string;
  let excerpt: boolean;
  let startLine: number;
  let endLine: number;
  if (decision && decision.text !== '') {
    const ctx = context && context.text !== '' ? `Context: ${truncate(context.text, 700)}\n\n` : '';
    body = `${ctx}Decision: ${decision.text}`;
    excerpt = ctx !== '' || false;
    startLine = context?.start ?? decision.start;
    endLine = decision.end;
  } else {
    const start = heading >= 0 ? heading + 1 : 0;
    body = lines.slice(start).join('\n').trim();
    excerpt = true;
    startLine = start + 1;
    endLine = lines.length;
  }
  if (body.length > MAX_BODY) {
    body = `${body.slice(0, MAX_BODY).trimEnd()}…`;
    excerpt = true;
  }
  if (body === '') body = title;
  return {
    ...(number !== undefined && { number }),
    title,
    status,
    ...(statusText !== undefined && { statusText }),
    supersedesAdr: [...new Set(supersedesAdr)].sort((a, b) => a - b),
    supersededByAdr: [...new Set(supersededByAdr)].sort((a, b) => a - b),
    body,
    excerpt,
    startLine: Math.max(1, startLine),
    endLine: Math.max(startLine, endLine),
  };
}

function docCategory(path: string): MemoryCategory {
  const name = path.toLowerCase();
  if (/(contribut|convention|code[-_ ]?style|style[-_ ]?guide|coding)/.test(name))
    return 'team-convention';
  if (/(^|\/)(api|openapi|swagger|contract)[^/]*\.(md|mdx)$|\/api\//.test(name))
    return 'api-contract';
  if (/(build|install|setup|getting[-_ ]started|development|requirements)/.test(name))
    return 'build-requirement';
  return 'repository-discovery';
}

function docExcerpt(content: string): {
  title: string | undefined;
  body: string;
  excerpt: boolean;
} {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = h1 >= 0 ? (lines[h1] as string).replace(/^#\s+/, '').trim() : undefined;
  const text = lines
    .slice(h1 + 1)
    .filter((l) => !/^\s*(\[!\[|!\[|<img|<p align|---\s*$)/.test(l))
    .join('\n')
    .trim();
  const limit = 1500;
  return {
    title,
    body: text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text,
    excerpt: text.length > limit,
  };
}

export interface ImportOptions {
  rootPath: string;
  /** Import ADR files (default true). */
  adrs?: boolean;
  /** Also import other engineering documents as excerpts (default true). */
  docs?: boolean;
  /** Cap on non-ADR documents (default 100). */
  maxDocs?: number;
}

export interface ImportedEntry {
  path: string;
  id: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped';
  kind: 'adr' | 'doc';
  decisionStatus?: DecisionStatus;
  note?: string;
}

export interface ImportResult {
  entries: ImportedEntry[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  supersessionLinks: number;
  limitations: string[];
}

/**
 * Import ADRs and engineering documents as memory. ORBIT records what the document says, with the
 * file and line range as the source and the file's SHA-256 as the staleness baseline. Nothing is
 * summarised by an AI, so an imported excerpt is the author's text, not ORBIT's opinion.
 */
export function importDocuments(engine: MemoryEngine, options: ImportOptions): ImportResult {
  const maxDocs = options.maxDocs ?? 100;
  if (!Number.isInteger(maxDocs) || maxDocs < 0) {
    throw new OrbitError('INVALID_INPUT', 'maxDocs must be a non-negative integer');
  }
  const config = resolveConfig({ include: ['**/*.md', '**/*.mdx'], maxFiles: 20_000 });
  const discovery = discoverFiles(options.rootPath, config);
  const files = discovery.files.sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1),
  );

  const entries: ImportedEntry[] = [];
  const limitations: string[] = [
    'Documents are imported as excerpts: the first part of the text, not an AI summary and not the full file.',
    'ORBIT records what a document says. It does not check that the code still follows it.',
  ];
  const adrItems: { item: MemoryItem; parsed: ParsedAdr }[] = [];
  let docsTaken = 0;
  let docsOver = 0;

  const read = (file: DiscoveredFile) => readSourceFile(options.rootPath, file, MAX_FILE_BYTES);

  for (const file of files) {
    const adr = isAdrPath(file.path);
    if ((adr && options.adrs === false) || (!adr && options.docs === false)) continue;
    if (!adr) {
      if (NOT_A_RECORD.test(file.path) && !/(^|\/)readme\.md$/i.test(file.path)) continue;
      if (docsTaken >= maxDocs) {
        docsOver += 1;
        continue;
      }
    }
    const result = read(file);
    if (!result.ok) {
      entries.push({
        path: file.path,
        id: '',
        outcome: 'skipped',
        kind: adr ? 'adr' : 'doc',
        note: result.reason,
      });
      continue;
    }
    const { content, hash } = result.value;
    const lineCount = content.split('\n').length;

    if (adr) {
      const parsed = parseAdr(content, file.path);
      const base = (file.path.split('/').pop() ?? file.path).replace(/\.md$/i, '');
      const slug = slugify(/^adr/i.test(base) ? base : `adr-${base}`);
      const outcome = engine.upsertImported({
        category: 'architecture-decision',
        slug,
        title: parsed.title,
        body: parsed.body,
        tags: ['adr'],
        sourceRefs: [
          {
            kind: 'file',
            path: file.path,
            startLine: parsed.startLine,
            endLine: Math.min(parsed.endLine, lineCount),
            contentHash: hash,
          },
        ],
        decisionStatus: parsed.status,
        ...(parsed.number !== undefined && { adrNumber: parsed.number }),
        excerpt: parsed.excerpt,
        importedFrom: file.path,
        supersedesAdr: parsed.supersedesAdr,
        supersededByAdr: parsed.supersededByAdr,
      } satisfies ImportedMemory);
      adrItems.push({ item: outcome.item, parsed });
      entries.push({
        path: file.path,
        id: outcome.item.id,
        outcome: outcome.outcome,
        kind: 'adr',
        decisionStatus: parsed.status,
        ...(outcome.note !== undefined && { note: outcome.note }),
      });
      continue;
    }

    const doc = docExcerpt(content);
    if (doc.body === '') continue;
    docsTaken += 1;
    const category = docCategory(file.path);
    const outcome = engine.upsertImported({
      category,
      slug: slugify(`doc-${file.path.replace(/\.(md|mdx)$/i, '')}`),
      title: doc.title ?? file.path,
      body: doc.body,
      tags: ['documentation'],
      sourceRefs: [
        { kind: 'file', path: file.path, startLine: 1, endLine: lineCount, contentHash: hash },
      ],
      excerpt: doc.excerpt,
      importedFrom: file.path,
    });
    entries.push({
      path: file.path,
      id: outcome.item.id,
      outcome: outcome.outcome,
      kind: 'doc',
      ...(outcome.note !== undefined && { note: outcome.note }),
    });
  }
  if (docsOver > 0)
    limitations.push(`${docsOver} further document(s) were not imported (limit ${maxDocs}).`);

  const supersessionLinks = linkAdrSupersession(engine, adrItems, limitations);
  const count = (o: ImportedEntry['outcome']): number =>
    entries.filter((e) => e.outcome === o).length;
  return {
    entries,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    skipped: count('skipped'),
    supersessionLinks,
    limitations,
  };
}

/** "Superseded by ADR-7" / "Supersedes ADR-2" become SUPERSEDES edges when the target is unambiguous. */
function linkAdrSupersession(
  engine: MemoryEngine,
  adrs: { item: MemoryItem; parsed: ParsedAdr }[],
  limitations: string[],
): number {
  const byNumber = new Map<number, MemoryItem[]>();
  for (const { item } of adrs) {
    if (item.adrNumber === undefined) continue;
    const list = byNumber.get(item.adrNumber) ?? [];
    list.push(item);
    byNumber.set(item.adrNumber, list);
  }
  const resolve = (n: number): MemoryItem | undefined => {
    const found = byNumber.get(n);
    if (!found || found.length !== 1) {
      limitations.push(
        found && found.length > 1
          ? `ADR-${n} matches ${found.length} imported documents, so the supersession link was not created.`
          : `ADR-${n} was referenced but not found among the imported documents.`,
      );
      return undefined;
    }
    return found[0];
  };
  const pairs = new Map<string, { newer: MemoryItem; older: MemoryItem }>();
  for (const { item, parsed } of adrs) {
    for (const n of parsed.supersedesAdr) {
      const older = resolve(n);
      if (older && older.id !== item.id)
        pairs.set(`${item.id}>${older.id}`, { newer: item, older });
    }
    for (const n of parsed.supersededByAdr) {
      const newer = resolve(n);
      if (newer && newer.id !== item.id)
        pairs.set(`${newer.id}>${item.id}`, { newer, older: item });
    }
  }
  let created = 0;
  for (const { newer, older } of [...pairs.values()].sort((a, b) =>
    a.newer.id + a.older.id < b.newer.id + b.older.id ? -1 : 1,
  )) {
    const result = engine.store.edges.upsert({
      repositoryId: engine.repositoryId,
      type: 'SUPERSEDES',
      fromId: nodeIdFor(engine.repositoryId, 'Decision', newer.id),
      toId: nodeIdFor(engine.repositoryId, 'Decision', older.id),
      attrs: { producer: 'memory', basis: 'stated in the ADR status or text' },
      sourceEvidenceId: newer.evidenceId,
    });
    if (result.changed) created += 1;
  }
  return created;
}
