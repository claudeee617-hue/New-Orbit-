#!/usr/bin/env node
import { CommanderError } from 'commander';
import { exitCodeFor, toOrbitError } from '@orbit/shared';
import { buildProgram, defaultIo } from './program.js';

async function run(): Promise<number> {
  try {
    await buildProgram(defaultIo).parseAsync(process.argv);
    return 0;
  } catch (error) {
    // Commander signals --help / --version / usage errors through exitOverride.
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    const orbitError = toOrbitError(error);
    defaultIo.stderr(`error [${orbitError.code}]: ${orbitError.message}\n`);
    return exitCodeFor(orbitError);
  }
}

process.exitCode = await run();
