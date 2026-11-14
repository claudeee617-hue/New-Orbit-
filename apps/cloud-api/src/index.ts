interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<T[]>;
}

interface AccessClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
}

interface JwkSet {
  keys: JsonWebKey[];
}

const encoder = new TextEncoder();
const jwksCache = new Map<string, { expiresAt: number; keys: CryptoKey[] }>();
const MAX_CLOCK_SKEW_SECONDS = 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function accessKeys(issuer: string): Promise<CryptoKey[]> {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit);
  if (!response.ok) throw new Error("Access signing keys unavailable");

  const jwks = (await response.json()) as JwkSet;
  const keys = await Promise.all(
    jwks.keys
      .filter((key) => key.kty === "RSA" && key.use === "sig" && key.alg === "RS256")
      .map((key) => crypto.subtle.importKey(
        "jwk",
        key,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      )),
  );
  if (keys.length === 0) throw new Error("No supported Access signing keys");
  jwksCache.set(issuer, { keys, expiresAt: Date.now() + 5 * 60 * 1000 });
  return keys;
}

async function authenticate(request: Request, env: Env): Promise<AccessClaims | null> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(issuer) || !env.ACCESS_AUD) {
    throw new Error("Cloudflare Access is not configured");
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = decodeJsonPart<{ alg?: string; kid?: string }>(parts[0]!);
    const claims = decodeJsonPart<AccessClaims>(parts[1]!);
    if (header.alg !== "RS256" || !header.kid) return null;
    if (claims.iss !== issuer || !claims.sub) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now - MAX_CLOCK_SKEW_SECONDS) return null;
    if (claims.nbf !== undefined && claims.nbf > now + MAX_CLOCK_SKEW_SECONDS) return null;
    if (claims.email_verified === false) return null;

    const keys = await accessKeys(issuer);
    const jwksResponse = await fetch(`${issuer}/cdn-cgi/access/certs`);
    const jwks = (await jwksResponse.json()) as JwkSet;
    const matchingJwk = jwks.keys.find((key) => key.kid === header.kid && key.alg === "RS256");
    if (!matchingJwk) return null;
    const signingKey = await crypto.subtle.importKey(
      "jwk",
      matchingJwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = encoder.encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      signingKey,
      decodeBase64Url(parts[2]!),
      signed,
    );
    void keys;
    return valid ? claims : null;
  } catch {
    return null;
  }
}

function workspaceKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ service: "orbit-cloud-api", status: "ok", version: "0.1.0" });
  }

  const identity = await authenticate(request, env);
  if (!identity) return json({ error: "UNAUTHENTICATED", message: "A valid Cloudflare Access session is required." }, 401);

  if (url.pathname === "/v1/workspaces" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT w.id, w.name, w.workspace_key AS workspaceKey, m.role, w.created_at AS createdAt
       FROM workspaces w
       INNER JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.identity_sub = ?
       ORDER BY w.created_at DESC LIMIT 100`,
    ).bind(identity.sub).all();
    return json({ workspaces: rows.results });
  }

  if (url.pathname === "/v1/workspaces" && request.method === "POST") {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    let payload: unknown;
    try {
      const body = await request.text();
      if (encoder.encode(body).byteLength > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
      payload = JSON.parse(body);
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "INVALID_INPUT", message: "Expected a JSON object." }, 400);
    }
    const name = (payload as Record<string, unknown>).name;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
      return json({ error: "INVALID_INPUT", message: "Workspace name must be 2–80 characters." }, 400);
    }
    const cleanName = name.trim();
    const key = workspaceKey(cleanName);
    if (!key) return json({ error: "INVALID_INPUT", message: "Workspace name must include letters or numbers." }, 400);

    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO workspaces (id, name, workspace_key, created_by) VALUES (?, ?, ?, ?)",
        ).bind(id, cleanName, key, identity.sub),
        env.DB.prepare(
          "INSERT INTO workspace_members (workspace_id, identity_sub, email, role) VALUES (?, ?, ?, 'owner')",
        ).bind(id, identity.sub, identity.email ?? null),
      ]);
    } catch {
      return json({ error: "WORKSPACE_CONFLICT", message: "A workspace with this key already exists, or the workspace could not be created." }, 409);
    }
    return json({ workspace: { id, name: cleanName, workspaceKey: key, role: "owner" } }, 201);
  }

  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
    }
    try {
      return await handle(request, env);
    } catch {
      return json({ error: "INTERNAL_ERROR", message: "The cloud API could not complete this request." }, 500);
    }
  },
};
