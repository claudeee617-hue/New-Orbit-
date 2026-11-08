import { useCallback, useEffect, useState } from 'react';
import { ORBIT_TAGLINE } from '@orbit/shared/health';
import { BusinessModule } from './BusinessModule.js';
import { loadHealth, type HealthState } from './health.js';

const ENGINES = [
  { name: 'ATLAS', purpose: 'Codebase intelligence and decision memory' },
  { name: 'WITNESS', purpose: 'Evidence-based pull-request verification' },
  { name: 'FLARE', purpose: 'CI intelligence and flaky-test detection' },
  { name: 'CAPSULE', purpose: 'Reproducible environments' },
  { name: 'FLIGHT RECORDER', purpose: 'Embedded telemetry capture and replay' },
] as const;

type WorkspaceView = 'overview' | 'business';

function StatusBadge({ state }: { state: HealthState }) {
  const styles: Record<HealthState['kind'], { label: string; dot: string; text: string }> = {
    loading: { label: 'CHECKING', dot: 'bg-mute animate-pulse', text: 'text-mute' },
    connected: { label: 'CONNECTED', dot: 'bg-ok', text: 'text-ok' },
    degraded: { label: 'DEGRADED', dot: 'bg-warn', text: 'text-warn' },
    disconnected: { label: 'DISCONNECTED', dot: 'bg-bad', text: 'text-bad' },
  };
  const style = styles[state.kind];
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-xs tracking-widest ${style.text}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function ApiDetails({ state }: { state: HealthState }) {
  if (state.kind === 'loading') {
    return <p className="text-mute">Contacting the local API…</p>;
  }
  if (state.kind === 'disconnected') {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink">{state.reason}</p>
        <p className="text-mute">
          Start it from the repository root with{' '}
          <code className="font-mono text-cyan">pnpm dev</code>.
        </p>
      </div>
    );
  }
  const { health } = state;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-mute">Service</dt>
      <dd className="font-mono">{health.service}</dd>
      <dt className="text-mute">Version</dt>
      <dd className="font-mono">{health.version}</dd>
      <dt className="text-mute">Database</dt>
      <dd className="font-mono">{health.database.connected ? 'connected' : 'unreachable'}</dd>
      <dt className="text-mute">Schema version</dt>
      <dd className="font-mono">{health.database.schemaVersion ?? 'unknown'}</dd>
    </dl>
  );
}

export function App() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  const [view, setView] = useState<WorkspaceView>('overview');

  const refresh = useCallback(() => {
    setState({ kind: 'loading' });
    const controller = new AbortController();
    void loadHealth(fetch, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-[0.3em] text-cyan">ORBIT</h1>
          <p className="mt-1 text-sm text-mute">{ORBIT_TAGLINE}</p>
        </div>
        <nav aria-label="Command Center sections" className="flex gap-2">
          <button
            type="button"
            aria-current={view === 'overview' ? 'page' : undefined}
            onClick={() => setView('overview')}
            className={`rounded-md border px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${view === 'overview' ? 'border-cyan bg-cyan/10 text-cyan' : 'border-edge text-mute hover:border-cyan hover:text-ink'}`}
          >
            Overview
          </button>
          <button
            type="button"
            aria-current={view === 'business' ? 'page' : undefined}
            onClick={() => setView('business')}
            className={`rounded-md border px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan ${view === 'business' ? 'border-cyan bg-cyan/10 text-cyan' : 'border-edge text-mute hover:border-cyan hover:text-ink'}`}
          >
            Business
          </button>
        </nav>
      </header>

      {view === 'business' ? (
        <main>
          <BusinessModule />
        </main>
      ) : (
        <main className="flex flex-col gap-8">
          <section
            aria-labelledby="api-heading"
            className="rounded-lg border border-edge bg-panel p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id="api-heading"
                className="text-sm font-medium uppercase tracking-wider text-mute"
              >
                Local API
              </h2>
              <StatusBadge state={state} />
            </div>
            <ApiDetails state={state} />
            <button
              type="button"
              onClick={refresh}
              disabled={state.kind === 'loading'}
              className="mt-5 rounded-md border border-edge px-3 py-1.5 text-sm text-ink transition-colors hover:border-cyan hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50"
            >
              Check again
            </button>
          </section>

          <section
            aria-labelledby="engines-heading"
            className="rounded-lg border border-edge bg-panel p-5"
          >
            <h2
              id="engines-heading"
              className="mb-1 text-sm font-medium uppercase tracking-wider text-mute"
            >
              Engines
            </h2>
            <p className="mb-4 text-sm text-mute">
              This main-branch foundation view lists the engine roadmap. Feature-branch prototypes
              are not represented as merged or released capabilities.
            </p>
            <ul className="divide-y divide-edge">
              {ENGINES.map((engine) => (
                <li key={engine.name} className="flex items-baseline justify-between gap-4 py-2">
                  <div>
                    <span className="font-mono text-sm text-ink">{engine.name}</span>
                    <span className="ml-3 text-sm text-mute">{engine.purpose}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-violet">ROADMAP</span>
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}
    </div>
  );
}
