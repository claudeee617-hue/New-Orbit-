// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../worker-configuration.d.ts" />

interface AccessClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface JwkSet {
  keys: AccessJwk[];
}

const encoder = new TextEncoder();
const jwksCache = new Map<string, { expiresAt: number; keys: Map<string, CryptoKey> }>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function accessKeys(issuer: string, refresh = false): Promise<Map<string, CryptoKey>> {
  const cached = jwksCache.get(issuer);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(issuer + '/cdn-cgi/access/certs', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Access signing keys unavailable');

  const jwks = (await response.json()) as JwkSet;
  const supported = jwks.keys.filter(
    (key) =>
      key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256' && typeof key.kid === 'string',
  );
  const imported = await Promise.all(
    supported.map(
      async (key) =>
        [
          key.kid!,
          await crypto.subtle.importKey(
            'jwk',
            key,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['verify'],
          ),
        ] as const,
    ),
  );
  const keys = new Map(imported);
  if (keys.size === 0) throw new Error('No supported Access signing keys');
  jwksCache.set(issuer, { keys, expiresAt: Date.now() + 5 * 60 * 1000 });
  return keys;
}

async function authenticate(request: Request, env: Env): Promise<AccessClaims | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) return null;

  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(issuer) || !env.ACCESS_AUD) {
    throw new Error('Cloudflare Access is not configured');
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = decodeJsonPart<{ alg?: string; kid?: string }>(parts[0]!);
    const claims = decodeJsonPart<AccessClaims>(parts[1]!);
    if (header.alg !== 'RS256' || !header.kid) return null;
    if (claims.iss !== issuer || typeof claims.sub !== 'string' || claims.sub.length === 0) {
      return null;
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now) return null;
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) return null;
    if (claims.email_verified === false) return null;

    let signingKey = (await accessKeys(issuer)).get(header.kid);
    if (!signingKey) {
      signingKey = (await accessKeys(issuer, true)).get(header.kid);
    }
    if (!signingKey) return null;
    const signed = encoder.encode(parts[0] + '.' + parts[1]);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      signingKey,
      decodeBase64Url(parts[2]!),
      signed,
    );
    return valid ? claims : null;
  } catch {
    return null;
  }
}

async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function workspaceKey(value: string): string {
  let key = '';
  let separatorPending = false;

  for (const character of value.trim().toLowerCase()) {
    const isAsciiAlphaNumeric =
      (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');

    if (isAsciiAlphaNumeric) {
      if (separatorPending && key.length > 0 && key.length < 48) key += '-';
      separatorPending = false;
      if (key.length < 48) key += character;
    } else if (key.length > 0) {
      separatorPending = true;
    }

    if (key.length >= 48) break;
  }

  return key.endsWith('-') ? key.slice(0, -1) : key;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ service: 'orbit-cloud-api', status: 'ok', version: '0.1.0' });
  }

  const identity = await authenticate(request, env);
  if (!identity) {
    return json(
      {
        error: 'UNAUTHENTICATED',
        message: 'A valid Cloudflare Access session is required.',
      },
      401,
    );
  }

  // Workspace reads use a bounded, identity-scoped cursor page.
  if (url.pathname === '/v1/workspaces' && request.method === 'GET') {
    const rawLimit = url.searchParams.get('limit');
    const requestedLimit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return json(
        { error: 'INVALID_PAGE_SIZE', message: 'Limit must be an integer from 1 to 100.' },
        400,
      );
    }

    const rawCursor = url.searchParams.get('cursor');
    let cursor: { createdAt: string; id: string } | null = null;
    if (rawCursor) {
      try {
        cursor = decodeJsonPart<{ createdAt: string; id: string }>(rawCursor);
      } catch {
        return json({ error: 'INVALID_CURSOR' }, 400);
      }
      if (
        !cursor ||
        typeof cursor.createdAt !== 'string' ||
        cursor.createdAt.length > 64 ||
        typeof cursor.id !== 'string' ||
        cursor.id.length === 0 ||
        cursor.id.length > 128
      ) {
        return json({ error: 'INVALID_CURSOR' }, 400);
      }
    }

    const statement = env.DB.prepare(
      cursor
        ? `SELECT w.id, w.name, w.workspace_key AS workspaceKey, m.role, w.created_at AS createdAt
           FROM workspaces w
           INNER JOIN workspace_members m ON m.workspace_id = w.id
           WHERE m.identity_sub = ?
             AND (w.created_at < ? OR (w.created_at = ? AND w.id < ?))
           ORDER BY w.created_at DESC, w.id DESC LIMIT ?`
        : `SELECT w.id, w.name, w.workspace_key AS workspaceKey, m.role, w.created_at AS createdAt
           FROM workspaces w
           INNER JOIN workspace_members m ON m.workspace_id = w.id
           WHERE m.identity_sub = ?
           ORDER BY w.created_at DESC, w.id DESC LIMIT ?`,
    );
    const rows = cursor
      ? await statement
          .bind(identity.sub, cursor.createdAt, cursor.createdAt, cursor.id, requestedLimit + 1)
          .all()
      : await statement.bind(identity.sub, requestedLimit + 1).all();
    const hasMore = rows.results.length > requestedLimit;
    const workspaces = hasMore ? rows.results.slice(0, requestedLimit) : rows.results;
    const last = workspaces[workspaces.length - 1] as
      { createdAt?: unknown; id?: unknown } | undefined;
    const nextCursor =
      hasMore && typeof last?.createdAt === 'string' && typeof last.id === 'string'
        ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '')
        : null;
    return json({ workspaces, nextCursor });
  }

  if (url.pathname === '/v1/workspaces' && request.method === 'POST') {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    }
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > 4096) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

    let payload: unknown;
    try {
      const body = await readLimitedBody(request, 4096);
      if (body === null) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
      payload = JSON.parse(body);
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ error: 'INVALID_INPUT', message: 'Expected a JSON object.' }, 400);
    }
    const name = (payload as Record<string, unknown>).name;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return json(
        { error: 'INVALID_INPUT', message: 'Workspace name must be 2–80 characters.' },
        400,
      );
    }
    const cleanName = name.trim();
    const key = workspaceKey(cleanName);
    if (!key) {
      return json(
        { error: 'INVALID_INPUT', message: 'Workspace name must include letters or numbers.' },
        400,
      );
    }

    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO workspaces (id, name, workspace_key, created_by) VALUES (?, ?, ?, ?)',
        ).bind(id, cleanName, key, identity.sub),
        env.DB.prepare(
          `INSERT INTO workspace_members (
            workspace_id, identity_sub, email, role
          ) VALUES (?, ?, ?, 'owner')`,
        ).bind(id, identity.sub, identity.email ?? null),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return json(
          {
            error: 'WORKSPACE_CONFLICT',
            message: 'A workspace with this key already exists.',
          },
          409,
        );
      }
      throw error;
    }
    return json({ workspace: { id, name: cleanName, workspaceKey: key, role: 'owner' } }, 201);
  }

  return json({ error: 'NOT_FOUND' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    }
    try {
      return await handle(request, env);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          message: 'ORBIT cloud API request failed',
          method: request.method,
          path: new URL(request.url).pathname,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return json(
        {
          error: 'INTERNAL_ERROR',
          message: 'The cloud API could not complete this request.',
        },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
