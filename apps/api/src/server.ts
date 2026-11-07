import Fastify from 'fastify';
import type { OrbitDatabase } from '@orbit/database';
import { ORBIT_VERSION, type HealthResponse, type Logger } from '@orbit/shared';

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

export interface BuildServerOptions {
  database: OrbitDatabase;
  logger: Logger;
  /** Host names (without port) accepted in the Host header. Defaults to loopback names. */
  allowedHosts?: readonly string[];
}

/** Strip the port from a Host header value, keeping IPv6 brackets. */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  const colon = hostHeader.lastIndexOf(':');
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

// The return type is inferred so the server keeps the concrete pino logger type.
export function buildServer(options: BuildServerOptions) {
  const allowed = new Set(
    (options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS).map((h) => h.toLowerCase()),
  );
  const server = Fastify({ loggerInstance: options.logger });

  // Defence against DNS-rebinding: a browser page on another origin must not be able to talk to
  // this local service by pointing a hostname at 127.0.0.1.
  server.addHook('onRequest', async (request, reply) => {
    if (!allowed.has(hostnameOf(request.headers.host).toLowerCase())) {
      return reply.code(403).send({ error: 'FORBIDDEN_HOST', message: 'Host header not allowed' });
    }
    return undefined;
  });

  server.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const healthy = options.database.isHealthy();
    const body: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      service: 'orbit-api',
      version: ORBIT_VERSION,
      database: {
        connected: healthy,
        schemaVersion: healthy ? options.database.schemaVersion() : null,
      },
    };
    if (!healthy) reply.code(503);
    return body;
  });

  server.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
  });

  return server;
}
