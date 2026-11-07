import { openDatabase } from '@orbit/database';
import { createLogger, exitCodeFor, loadConfig, toOrbitError } from '@orbit/shared';
import { DEFAULT_ALLOWED_HOSTS, buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ name: 'orbit-api', level: config.logLevel });
  const database = openDatabase({ path: config.dbPath });

  const allowedHosts = config.allowNonLoopback
    ? [...DEFAULT_ALLOWED_HOSTS, config.host]
    : DEFAULT_ALLOWED_HOSTS;
  const server = buildServer({ database, logger, allowedHosts });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await server.close();
    database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await server.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  const orbitError = toOrbitError(error);
  // Logger may not exist yet (configuration errors), so write directly to stderr.
  process.stderr.write(`orbit-api failed to start: ${orbitError.message}\n`);
  process.exit(exitCodeFor(orbitError));
});
