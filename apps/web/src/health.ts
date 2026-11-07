import type { HealthResponse } from '@orbit/shared/health';

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'connected'; health: HealthResponse }
  | { kind: 'degraded'; health: HealthResponse }
  | { kind: 'disconnected'; reason: string };

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HealthResponse>;
  return (
    (candidate.status === 'ok' || candidate.status === 'degraded') &&
    candidate.service === 'orbit-api' &&
    typeof candidate.version === 'string' &&
    typeof candidate.database === 'object' &&
    candidate.database !== null &&
    typeof candidate.database.connected === 'boolean'
  );
}

/** Ask the local API for its health. Never throws: every failure becomes a `disconnected` state. */
export async function loadHealth(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HealthState> {
  let response: Response;
  try {
    response = await fetchImpl('/api/health', signal ? { signal } : {});
  } catch {
    return { kind: 'disconnected', reason: 'The ORBIT API could not be reached.' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      kind: 'disconnected',
      reason: `The API answered with HTTP ${response.status} and no valid JSON.`,
    };
  }

  if (!isHealthResponse(body)) {
    return {
      kind: 'disconnected',
      reason: `Unexpected response from the API (HTTP ${response.status}).`,
    };
  }
  return body.status === 'ok'
    ? { kind: 'connected', health: body }
    : { kind: 'degraded', health: body };
}
