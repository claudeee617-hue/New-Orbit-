/**
 * Authenticated, same-origin client for the local ORBIT API.
 *
 * The caller owns the token. This module never persists it, logs it, or places it in a URL.
 */
export interface ApiClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  basePath?: string;
}

export interface ApiRepository {
  id: string;
  key: string;
  displayName: string;
  [key: string]: unknown;
}

export interface ApiGraphPage {
  repository: ApiRepository;
  nodes: unknown[];
  edges: unknown[];
  page: {
    limit: number;
    offset: number;
    hasMoreNodes: boolean;
    hasMoreEdges: boolean;
  };
  ledger: { entries: number; headHash: string | null };
}

export interface ApiEvidencePage {
  repository: ApiRepository;
  evidence: unknown[];
  returned: number;
  limit: number;
}

export class OrbitApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OrbitApiError';
  }
}

function validateToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
    throw new OrbitApiError(
      'The local API token must contain 40–128 URL-safe characters.',
      0,
      'INVALID_TOKEN',
    );
  }
}

export function createOrbitApiClient(options: ApiClientOptions) {
  validateToken(options.token);
  const fetchImpl = options.fetchImpl ?? fetch;
  const basePath = (options.basePath ?? '/api/v1').replace(/\/$/, '');

  async function request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await fetchImpl(`${basePath}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${options.token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OrbitApiError(
        `The local API returned an invalid response (HTTP ${response.status}).`,
        response.status,
        'INVALID_RESPONSE',
      );
    }

    if (!response.ok) {
      const error = payload as { error?: unknown; message?: unknown } | null;
      const code = typeof error?.error === 'string' ? error.error : 'API_ERROR';
      const message =
        response.status === 401
          ? 'The local API token was rejected. Check the api.token file and try again.'
          : typeof error?.message === 'string'
            ? error.message
            : `The local API request failed (HTTP ${response.status}).`;
      throw new OrbitApiError(message, response.status, code);
    }
    return payload as T;
  }

  return {
    listRepositories(signal?: AbortSignal) {
      return request<{ repositories: ApiRepository[] }>('/repositories', { signal });
    },
    getGraph(
      repositoryKey: string,
      options: { limit?: number; offset?: number; type?: string; signal?: AbortSignal } = {},
    ) {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.offset !== undefined) query.set('offset', String(options.offset));
      if (options.type) query.set('type', options.type);
      const suffix = query.size ? `?${query.toString()}` : '';
      return request<ApiGraphPage>(
        `/repositories/${encodeURIComponent(repositoryKey)}/graph${suffix}`,
        { signal: options.signal },
      );
    },
    getEvidence(
      repositoryKey: string,
      options: { limit?: number; commitSha?: string; sourceType?: string; signal?: AbortSignal } = {},
    ) {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.commitSha) query.set('commitSha', options.commitSha);
      if (options.sourceType) query.set('sourceType', options.sourceType);
      const suffix = query.size ? `?${query.toString()}` : '';
      return request<ApiEvidencePage>(
        `/repositories/${encodeURIComponent(repositoryKey)}/evidence${suffix}`,
        { signal: options.signal },
      );
    },
    getImpact(repositoryKey: string, file: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ file });
      return request<{ repository: ApiRepository; impact: unknown }>(
        `/repositories/${encodeURIComponent(repositoryKey)}/reports/impact?${query.toString()}`,
        { signal },
      );
    },
    getAtlasReport(repositoryKey: string, signal?: AbortSignal) {
      return request<{ repository: ApiRepository; report: unknown }>(
        `/repositories/${encodeURIComponent(repositoryKey)}/reports/atlas`,
        { signal },
      );
    },
    getPassports(
      repositoryKey: string,
      options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
    ) {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', String(options.limit));
      if (options.offset !== undefined) query.set('offset', String(options.offset));
      const suffix = query.size ? `?${query.toString()}` : '';
      return request<{ repository: ApiRepository; passports: unknown[]; page: unknown }>(
        `/repositories/${encodeURIComponent(repositoryKey)}/passports${suffix}`,
        { signal: options.signal },
      );
    },
    scanRepository(
      input: { rootPath: string; repositoryKey?: string; maxFiles?: number; maxCommits?: number },
      signal?: AbortSignal,
    ) {
      return request<{ result: unknown }>('/repositories/scan', {
        method: 'POST',
        body: input,
        signal,
      });
    },
  };
}

export type OrbitApiClient = ReturnType<typeof createOrbitApiClient>;
