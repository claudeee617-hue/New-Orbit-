import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@orbit/database';
import { ORBIT_VERSION } from '@orbit/shared';
import { buildProgram, type CliIo } from './program.js';
import { collectStatus, renderStatus } from './status.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-cli-'));
  tempDirs.push(dir);
  return dir;
}

function captureIo(env: Record<string, string | undefined> = {}): {
  io: CliIo;
  out: () => string;
  err: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      env,
    },
    out: () => stdout,
    err: () => stderr,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('collectStatus', () => {
  it('reports an uninitialised workspace without creating a database', () => {
    const path = join(tempDir(), 'orbit.db');
    const report = collectStatus(path, 'v22.0.0');
    expect(report.database.exists).toBe(false);
    expect(report.database.schemaVersion).toBeNull();
    expect(report.node.version).toBe('v22.0.0');
    expect(existsSync(path)).toBe(false);
  });

  it('reads the schema version of an existing database', () => {
    const path = join(tempDir(), 'orbit.db');
    const created = openDatabase({ path });
    const expected = created.schemaVersion();
    created.close();
    const report = collectStatus(path);
    expect(report.database.exists).toBe(true);
    expect(report.database.schemaVersion).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(1);
  });

  it('renders human-readable text for both cases', () => {
    const missing = renderStatus(collectStatus(join(tempDir(), 'nope.db')));
    expect(missing).toContain('not initialised');
    const path = join(tempDir(), 'orbit.db');
    openDatabase({ path }).close();
    expect(renderStatus(collectStatus(path))).toContain('schema version');
  });
});

describe('orbit program', () => {
  it('prints the version', async () => {
    const { io, out } = captureIo();
    await expect(buildProgram(io).parseAsync(['node', 'orbit', '--version'])).rejects.toMatchObject(
      {
        exitCode: 0,
      },
    );
    expect(out().trim()).toBe(ORBIT_VERSION);
  });

  it('prints status as JSON', async () => {
    const path = join(tempDir(), 'orbit.db');
    const { io, out } = captureIo();
    await buildProgram(io).parseAsync(['node', 'orbit', 'status', '--json', '--db', path]);
    const parsed = JSON.parse(out()) as ReturnType<typeof collectStatus>;
    expect(parsed.orbit.version).toBe(ORBIT_VERSION);
    expect(parsed.database.exists).toBe(false);
  });

  it('uses ORBIT_DB_PATH from the environment', async () => {
    const path = join(tempDir(), 'env.db');
    const { io, out } = captureIo({ ORBIT_DB_PATH: path });
    await buildProgram(io).parseAsync(['node', 'orbit', 'status', '--json']);
    expect((JSON.parse(out()) as ReturnType<typeof collectStatus>).database.path).toBe(path);
  });

  it('rejects unknown commands with a usage error', async () => {
    const { io, err } = captureIo();
    await expect(buildProgram(io).parseAsync(['node', 'orbit', 'bogus'])).rejects.toMatchObject({
      code: 'commander.unknownCommand',
    });
    expect(err()).toContain('unknown command');
  });

  it('rejects an invalid configuration with a CONFIG_INVALID error', async () => {
    const { io } = captureIo({ ORBIT_PORT: 'abc' });
    await expect(buildProgram(io).parseAsync(['node', 'orbit', 'status'])).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});
