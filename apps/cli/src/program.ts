import { Command, InvalidArgumentError } from 'commander';
import { ORBIT_TAGLINE, ORBIT_VERSION, OrbitError, loadConfig } from '@orbit/shared';
import { renderScan, runExport, runImpact, runScan } from './atlas.js';
import { startStdioServer } from '@orbit/mcp';
import {
  MEMORY_CATEGORIES,
  buildRefs,
  importDocuments,
  linkMemoryToHistory,
  renderItem,
  runCheck,
  searchMemory,
  withEngine,
  parseFileRef,
  type MemoryCommandContext,
} from './memory.js';
import { collectStatus, renderStatus } from './status.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
}

export const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
};

export function buildProgram(io: CliIo = defaultIo): Command {
  const program = new Command();
  program
    .name('orbit')
    .description(`ORBIT — Engineering Intelligence Platform\n${ORBIT_TAGLINE}`)
    .version(ORBIT_VERSION, '-v, --version', 'print the ORBIT version')
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    })
    .exitOverride();

  program
    .command('status')
    .description('show ORBIT, Node.js and workspace database status (read-only)')
    .option('--json', 'print machine-readable JSON')
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .action((options: { json?: boolean; db?: string }) => {
      const config = loadConfig(io.env);
      const report = collectStatus(options.db ?? config.dbPath);
      io.stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderStatus(report));
    });

  const collect = (value: string, previous: string[] = []): string[] => [...previous, value];
  const positive = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
    return n;
  };

  program
    .command('scan <path>')
    .description(
      'scan a repository (read-only) with ATLAS and record the facts in the workspace database',
    )
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .option('--key <key>', 'stable repository key (default: local/<folder name>)')
    .option('--include <glob>', 'only scan files matching this glob (repeatable)', collect)
    .option('--exclude <glob>', 'also skip files matching this glob (repeatable)', collect)
    .option('--max-files <n>', 'stop after this many files', positive)
    .option('--max-commits <n>', 'git history window', positive)
    .option('--no-git', 'skip git history (churn, ownership, commits)')
    .option('--no-calls', 'skip call extraction')
    .option('--json', 'print machine-readable JSON')
    .action(
      async (
        path: string,
        options: {
          db?: string;
          key?: string;
          include?: string[];
          exclude?: string[];
          maxFiles?: number;
          maxCommits?: number;
          git: boolean;
          calls: boolean;
          json?: boolean;
        },
      ) => {
        const config = loadConfig(io.env);
        const result = await runScan(path, { ...options, db: options.db ?? config.dbPath });
        io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderScan(result));
      },
    );

  const atlas = program
    .command('atlas')
    .description('query what ATLAS learned about a scanned repository (read-only)');

  atlas
    .command('export')
    .description('export the architecture, symbols, dependencies and relationships as JSON')
    .option('--db <path>', 'database path')
    .option('--repo <key>', 'repository key (needed when several are scanned)')
    .option('--out <file>', 'write to a file instead of stdout')
    .action((options: { db?: string; repo?: string; out?: string }) => {
      const config = loadConfig(io.env);
      io.stdout(runExport(options.db ?? config.dbPath, options.repo, options.out));
    });

  atlas
    .command('impact <file>')
    .description('show what a change to <file> can affect: dependents, modules and tests')
    .option('--db <path>', 'database path')
    .option('--repo <key>', 'repository key')
    .option('--json', 'print machine-readable JSON')
    .action((file: string, options: { db?: string; repo?: string; json?: boolean }) => {
      const config = loadConfig(io.env);
      const impact = runImpact(options.db ?? config.dbPath, options.repo, file);
      if (options.json) {
        io.stdout(`${JSON.stringify(impact, null, 2)}\n`);
        return;
      }
      const lines = [
        `Impact of ${impact.file}`,
        `Dependents  ${impact.dependents.length}${impact.truncated ? ' (truncated)' : ''}`,
        ...impact.dependents.slice(0, 25).map((d) => `  ${'  '.repeat(d.depth - 1)}${d.path}`),
        `Modules     ${impact.affectedModules.join(', ') || 'none'}`,
        `Tests       ${impact.tests.length}`,
        ...impact.tests.map(
          (t) =>
            `  ${t.test} (covers ${t.covers}${t.confidence === null ? '' : `, confidence ${t.confidence}`})`,
        ),
      ];
      if (impact.packageLevelDependents.length > 0) {
        lines.push(
          `Package-level importers (coarser, may not use this file): ${impact.packageLevelDependents.length}`,
        );
      }
      io.stdout(`${lines.join('\n')}\n`);
    });

  // ---- project memory ---------------------------------------------------------------------------
  const memory = program
    .command('memory')
    .description(
      'project memory: decisions, constraints, conventions, known bugs and fixes (versioned, with evidence)',
    );
  const common = (cmd: Command): Command =>
    cmd
      .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
      .option('--repo <key>', 'repository key (needed when several are scanned)')
      .option(
        '--root <path>',
        'working tree of the repository (checks staleness against files on disk)',
      )
      .option('--by <name>', 'who is making the change (a name or handle, never an email)')
      .option('--json', 'print machine-readable JSON');
  type MemoryOptions = { db?: string; repo?: string; root?: string; by?: string; json?: boolean };
  const memoryCtx = (o: MemoryOptions): MemoryCommandContext => ({
    db: o.db ?? loadConfig(io.env).dbPath,
    repo: o.repo,
    root: o.root,
    by: o.by ?? io.env['ORBIT_USER'] ?? io.env['USER'] ?? 'unknown',
  });
  const out = (o: MemoryOptions, json: unknown, text: string): void =>
    io.stdout(o.json ? `${JSON.stringify(json, null, 2)}\n` : `${text}\n`);

  common(
    memory
      .command('add')
      .description('record a new memory item')
      .requiredOption('--category <category>', `one of: ${MEMORY_CATEGORIES.join(', ')}`)
      .requiredOption('--title <title>', 'short title')
      .requiredOption('--body <text>', 'the statement to remember')
      .option('--slug <slug>', 'stable id fragment (default: from the title)')
      .option('--tag <tag>', 'tag (repeatable)', collect)
      .option('--topic <topic>', 'decision topic, for exact conflict detection (e.g. database)')
      .option('--choice <choice>', 'what was chosen for the topic (e.g. sqlite)')
      .option('--file <path[:start-end]>', 'source file (repeatable)', collect)
      .option('--commit <sha>', 'source commit (repeatable)', collect)
      .option('--pr <n>', 'source pull request number (repeatable)', collect)
      .option('--issue <n>', 'source issue number (repeatable)', collect)
      .option('--url <url>', 'source URL (repeatable)', collect)
      .option(
        '--ai',
        'mark as an AI suggestion: stored, labelled and never authoritative until confirmed',
      ),
  ).action(
    (
      o: MemoryOptions & {
        category: string;
        title: string;
        body: string;
        slug?: string;
        tag?: string[];
        topic?: string;
        choice?: string;
        file?: string[];
        commit?: string[];
        pr?: string[];
        issue?: string[];
        url?: string[];
        ai?: boolean;
      },
    ) => {
      const ctx = memoryCtx(o);
      const item = withEngine(ctx, (engine) =>
        engine.create({
          category: o.category as never,
          title: o.title,
          body: o.body,
          ...(o.slug !== undefined && { slug: o.slug }),
          ...(o.tag && { tags: o.tag }),
          ...(o.topic !== undefined && { topic: o.topic }),
          ...(o.choice !== undefined && { choice: o.choice }),
          sourceRefs: buildRefs(o),
          authority: o.ai ? 'ai-suggested' : 'human',
          createdBy: o.ai ? `ai:${ctx.by}` : ctx.by,
        }),
      );
      out(o, item, `Recorded ${renderItem(item)}`);
    },
  );

  common(
    memory
      .command('search [text]')
      .description('search memory (AI suggestions are included but labelled)')
      .option('--category <category>', 'filter by category (repeatable)', collect)
      .option('--file <path>', 'only memory that cites this file')
      .option('--authoritative', 'hide AI suggestions and non-authoritative items')
      .option('--invalidated', 'include invalidated items')
      .option('--limit <n>', 'maximum results (default 20)', positive),
  ).action(
    (
      text: string | undefined,
      o: MemoryOptions & {
        category?: string[];
        file?: string;
        authoritative?: boolean;
        invalidated?: boolean;
        limit?: number;
      },
    ) => {
      const result = withEngine(memoryCtx(o), (engine) =>
        searchMemory(engine.all(), {
          ...(text !== undefined && { text }),
          ...(o.category && { categories: o.category as never }),
          ...(o.file !== undefined && { path: o.file }),
          authoritativeOnly: o.authoritative ?? false,
          includeInvalidated: o.invalidated ?? false,
          ...(o.limit !== undefined && { limit: o.limit }),
        }),
      );
      out(
        o,
        result,
        result.hits.length === 0
          ? 'No matching memory.'
          : `${result.hits.map((h) => renderItem(h.item)).join('\n')}\n${result.total} match(es)${result.truncated ? ', more available' : ''}`,
      );
    },
  );

  common(memory.command('show <id>').description('show one memory item')).action(
    (id: string, o: MemoryOptions) => {
      const item = withEngine(memoryCtx(o), (engine) => engine.get(id));
      if (!item) throw new OrbitError('NOT_FOUND', `No memory ${id}`);
      out(o, item, renderItem(item, true));
    },
  );

  common(
    memory.command('history <id>').description('every version of a memory item, oldest first'),
  ).action((id: string, o: MemoryOptions) => {
    const versions = withEngine(memoryCtx(o), (engine) => engine.history(id));
    out(
      o,
      versions,
      versions
        .map(
          (v) =>
            `v${v.version}  ${v.recordedAt}  ${v.item.authority}/${v.item.status}  ${v.item.changeReason ?? ''}\n    ${v.item.title}\n    evidence ${v.evidenceId}`,
        )
        .join('\n'),
    );
  });

  common(
    memory
      .command('update <id>')
      .description('change a memory item (a new version; the old text is kept)')
      .requiredOption('--reason <text>', 'why it changed')
      .option('--title <title>')
      .option('--body <text>')
      .option('--tag <tag>', 'replace tags (repeatable)', collect)
      .option('--topic <topic>')
      .option('--choice <choice>')
      .option('--file <path[:start-end]>', 'replace source files (repeatable)', collect),
  ).action(
    (
      id: string,
      o: MemoryOptions & {
        reason: string;
        title?: string;
        body?: string;
        tag?: string[];
        topic?: string;
        choice?: string;
        file?: string[];
      },
    ) => {
      const ctx = memoryCtx(o);
      const item = withEngine(ctx, (engine) =>
        engine.update(id, {
          reason: o.reason,
          updatedBy: ctx.by,
          ...(o.title !== undefined && { title: o.title }),
          ...(o.body !== undefined && { body: o.body }),
          ...(o.tag && { tags: o.tag }),
          ...(o.topic !== undefined && { topic: o.topic }),
          ...(o.choice !== undefined && { choice: o.choice }),
          ...(o.file && { sourceRefs: o.file.map(parseFileRef) }),
        }),
      );
      out(o, item, `Updated ${renderItem(item)}`);
    },
  );

  common(
    memory
      .command('invalidate <id>')
      .description('mark a memory item as no longer true (kept in history)')
      .requiredOption('--reason <text>', 'why it is no longer true')
      .option('--superseded-by <id>', 'the memory item that replaces it'),
  ).action((id: string, o: MemoryOptions & { reason: string; supersededBy?: string }) => {
    const ctx = memoryCtx(o);
    const item = withEngine(ctx, (engine) =>
      engine.invalidate(id, {
        reason: o.reason,
        invalidatedBy: ctx.by,
        ...(o.supersededBy !== undefined && { supersededBy: o.supersededBy }),
      }),
    );
    out(o, item, `Invalidated ${renderItem(item)}`);
  });

  common(
    memory
      .command('reinstate <id>')
      .description('undo an invalidation')
      .requiredOption('--reason <text>', 'why'),
  ).action((id: string, o: MemoryOptions & { reason: string }) => {
    const ctx = memoryCtx(o);
    const item = withEngine(ctx, (engine) =>
      engine.reinstate(id, { reason: o.reason, by: ctx.by }),
    );
    out(o, item, `Reinstated ${renderItem(item)}`);
  });

  common(
    memory
      .command('confirm <id>')
      .description('a person vouches for an AI suggestion, making it authoritative')
      .option('--note <text>', 'what was checked'),
  ).action((id: string, o: MemoryOptions & { note?: string }) => {
    const ctx = memoryCtx(o);
    const item = withEngine(ctx, (engine) =>
      engine.confirm(id, { confirmedBy: ctx.by, ...(o.note !== undefined && { note: o.note }) }),
    );
    out(o, item, `Confirmed ${renderItem(item)}`);
  });

  common(
    memory
      .command('check')
      .description('report stale memory (cited files changed) and conflicting decisions'),
  ).action((o: MemoryOptions) => {
    const result = withEngine(memoryCtx(o), runCheck);
    const lines = [
      ...result.stale.map(
        (f) =>
          `STALE     ${f.id}\n          ${f.reasons.map((r) => `${r.kind}: ${r.path}`).join('; ')}`,
      ),
      ...result.conflicts.map(
        (c) =>
          `CONFLICT  ${c.items.join('  <->  ')}${c.heuristic ? '  (inferred from wording)' : ''}\n          ${c.explanation}`,
      ),
    ];
    out(
      o,
      result,
      lines.length === 0 ? 'No stale memory and no conflicting decisions found.' : lines.join('\n'),
    );
    if (lines.length > 0) process.exitCode = 1;
  });

  common(
    memory
      .command('import <path>')
      .description('import ADRs and engineering documents from a repository as memory (idempotent)')
      .option('--no-docs', 'import only ADRs')
      .option('--max-docs <n>', 'cap on non-ADR documents (default 100)', positive),
  ).action((path: string, o: MemoryOptions & { docs: boolean; maxDocs?: number }) => {
    const result = withEngine({ ...memoryCtx(o), root: o.root ?? path }, (engine) =>
      importDocuments(engine, {
        rootPath: path,
        docs: o.docs,
        ...(o.maxDocs !== undefined && { maxDocs: o.maxDocs }),
      }),
    );
    out(
      o,
      result,
      [
        `Imported: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped; ${result.supersessionLinks} supersession link(s)`,
        ...result.entries
          .filter((e) => e.outcome !== 'unchanged')
          .map((e) => `  ${e.outcome.padEnd(8)} ${e.path}${e.note ? `  (${e.note})` : ''}`),
        ...result.limitations.map((l) => `  note: ${l}`),
      ].join('\n'),
    );
  });

  common(
    memory
      .command('link')
      .description(
        'link memory to commits, pull requests and issues where the history supports it',
      ),
  ).action((o: MemoryOptions) => {
    const result = withEngine(memoryCtx(o), linkMemoryToHistory);
    out(
      o,
      result,
      [
        `${result.links.length} link(s) from ${result.commitsConsidered} commit(s); ${result.pullRequests} PR, ${result.issues} issue node(s); ${result.fixes} fix link(s); ${result.retired} retired`,
        ...result.links.map((l) => `  ${l.memoryId} -> ${l.target}  (${l.confidence}, ${l.basis})`),
        ...result.limitations.map((l) => `  note: ${l}`),
      ].join('\n'),
    );
  });

  program
    .command('mcp')
    .description(
      'serve the ORBIT graph to Claude Code and other MCP clients over stdio (read-only)',
    )
    .option('--db <path>', 'database path (default: ORBIT_DB_PATH or .orbit/orbit.db)')
    .option('--repo <key>', 'repository key (needed when several are scanned)')
    .option(
      '--root <path>',
      'working tree of the repository (memory staleness is checked against files on disk)',
    )
    .action(async (o: { db?: string; repo?: string; root?: string }) => {
      await startStdioServer({
        dbPath: o.db ?? loadConfig(io.env).dbPath,
        ...(o.repo !== undefined && { repository: o.repo }),
        ...(o.root !== undefined && { rootPath: o.root }),
      });
      io.stderr('orbit mcp ready (read-only)\n');
      // Keep the process alive until the client disconnects.
      await new Promise<void>((resolveClose) => process.stdin.once('end', resolveClose));
    });

  return program;
}
