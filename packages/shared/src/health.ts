/** Version of the ORBIT workspace. Kept equal to the root package.json version by a test. */
export const ORBIT_VERSION = '0.0.1';

export const ORBIT_TAGLINE = 'Understand Everything. Trace Every Change. Prove What Works.';

export interface DatabaseHealth {
  connected: boolean;
  /** Number of applied migrations, or null when the database is unreachable. */
  schemaVersion: number | null;
}

/** Response body of GET /health on the local API. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'orbit-api';
  version: string;
  database: DatabaseHealth;
}
