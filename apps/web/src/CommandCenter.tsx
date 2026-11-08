import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createOrbitApiClient,
  OrbitApiError,
  type ApiEvidencePage,
  type ApiGraphPage,
  type ApiRepository,
} from './api.js';

type Panel = 'overview' | 'graph' | 'evidence' | 'passports';

function messageOf(error: unknown): string {
  if (error instanceof OrbitApiError) return error.message;
  return 'The local API request failed. Check that ORBIT is running and try again.';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function display(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '—';
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <article className="rounded-lg border border-edge bg-panel p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-mute">{detail}</p>
    </article>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-panel/60 p-8 text-center">
      <h3 className="font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-mute">{detail}</p>
    </div>
  );
}

export function CommandCenter() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const [repositories, setRepositories] = useState<ApiRepository[]>([]);
  const [repositoryKey, setRepositoryKey] = useState('');
  const [graph, setGraph] = useState<ApiGraphPage | null>(null);
  const [evidence, setEvidence] = useState<ApiEvidencePage | null>(null);
  const [passports, setPassports] = useState<unknown[]>([]);
  const [integrity, setIntegrity] = useState<{ ok: boolean; ledgerEntriesChecked: number; problems: unknown[] } | null>(null);
  const [panel, setPanel] = useState<Panel>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const client = useMemo(
    () => (token ? createOrbitApiClient({ token }) : null),
    [token],
  );

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    if (!client) return;
    setLoading(true);
    setError('');
    try {
      const result = await client.listRepositories(signal);
      setRepositories(result.repositories);
      const selected = result.repositories.find((item) => item.key === repositoryKey)
        ?? result.repositories[0];
      if (!selected) {
        setRepositoryKey('');
        setGraph(null);
        setEvidence(null);
        setPassports([]);
        setIntegrity(null);
        setNotice('No repository is registered yet. Scan a local repository with the ORBIT CLI or API.');
        return;
      }
      setRepositoryKey(selected.key);
      const [graphResult, evidenceResult, passportResult, integrityResult] = await Promise.all([
        client.getGraph(selected.key, { limit: 100, signal }),
        client.getEvidence(selected.key, { limit: 100, signal }),
        client.getPassports(selected.key, { limit: 100, signal }),
        client.getIntegrity(selected.key, signal),
      ]);
      setGraph(graphResult);
      setEvidence(evidenceResult);
      setPassports(passportResult.passports);
      setIntegrity(integrityResult.integrity);
      setNotice('');
    } catch (cause) {
      if (!signal?.aborted) setError(messageOf(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [client, repositoryKey]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void loadWorkspace(controller.signal);
    return () => controller.abort();
  }, [client, loadWorkspace]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const evidenceItems = evidence?.evidence ?? [];
  const nodeTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of nodes) {
      const type = display(objectValue(item).type);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      // Validate before accepting the token. It remains in component memory only.
      createOrbitApiClient({ token: tokenInput });
      setToken(tokenInput);
      setTokenInput('');
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  function disconnect() {
    setToken('');
    setTokenInput('');
    setRepositories([]);
    setRepositoryKey('');
    setGraph(null);
    setEvidence(null);
    setPassports([]);
    setIntegrity(null);
    setError('');
    setNotice('Disconnected. The token was held only in page memory.');
  }

  function changeRepository(nextKey: string) {
    setRepositoryKey(nextKey);
    setGraph(null);
    setEvidence(null);
    setPassports([]);
    setIntegrity(null);
    // A fresh render triggers a new request through the selected key.
  }

  if (!client) {
    return (
      <section className="mx-auto max-w-2xl rounded-xl border border-edge bg-panel p-6 sm:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan">Local connection</p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Connect your ORBIT workspace</h2>
        <p className="mt-3 text-sm leading-6 text-mute">
          Enter the local API token from the private <code className="font-mono text-cyan">api.token</code>
          {' '}file in your ORBIT workspace. The token stays in this page's memory and is sent only
          in the Authorization header to the same-origin local API proxy. It is not saved to
          browser storage.
        </p>
        <form onSubmit={connect} className="mt-6 space-y-3">
          <label htmlFor="orbit-api-token" className="block text-xs font-medium uppercase tracking-wider text-mute">
            Local API token
          </label>
          <input
            id="orbit-api-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="Paste api.token value"
            className="w-full rounded-md border border-edge bg-void px-3 py-3 font-mono text-sm text-ink outline-none focus:border-cyan"
          />
          <button
            type="submit"
            disabled={!tokenInput.trim()}
            className="rounded-md border border-cyan bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Connect locally
          </button>
        </form>
        {error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
        {notice && <p role="status" className="mt-4 text-sm text-mute">{notice}</p>}
        <p className="mt-6 border-t border-edge pt-4 text-xs leading-5 text-mute">
          Start the local services from the repository root with <code className="font-mono text-cyan">pnpm dev</code>.
          Keep the token private; never paste it into an issue or commit it to Git.
        </p>
      </section>
    );
  }

  const selectedRepository = repositories.find((item) => item.key === repositoryKey);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-edge bg-panel p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ok">Authenticated · local only</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">Engineering Command Center</h2>
          <p className="mt-1 text-xs text-mute">Repository graph, evidence and Change Passport data from your local database.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            disabled={loading}
            className="rounded-md border border-edge px-3 py-2 text-sm text-ink hover:border-cyan hover:text-cyan disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="rounded-md border border-edge px-3 py-2 text-sm text-mute hover:border-bad hover:text-bad"
          >
            Disconnect
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/5 p-4 text-sm text-bad">
          {error}
        </div>
      )}
      {notice && <div role="status" className="rounded-lg border border-edge bg-panel p-4 text-sm text-mute">{notice}</div>}

      <section className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-sm text-mute">
          Repository
          <select
            value={repositoryKey}
            onChange={(event) => changeRepository(event.target.value)}
            className="max-w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono text-sm text-ink"
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.key}>{repository.displayName} · {repository.key}</option>
            ))}
          </select>
        </label>
        <span className="font-mono text-xs text-mute">{selectedRepository?.key ?? 'No repository selected'}</span>
      </section>

      <nav aria-label="Engineering dashboard views" className="flex flex-wrap gap-2">
        {(['overview', 'graph', 'evidence', 'passports'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-current={panel === item ? 'page' : undefined}
            onClick={() => setPanel(item)}
            className={`rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider ${panel === item ? 'border-cyan bg-cyan/10 text-cyan' : 'border-edge text-mute hover:border-cyan hover:text-ink'}`}
          >
            {item === 'passports' ? 'Change Passports' : item}
          </button>
        ))}
      </nav>

      {!selectedRepository && !loading ? (
        <Empty title="No repository data yet" detail="Register or scan a local repository with orbit init / orbit scan, then refresh this view. The dashboard never inserts demo metrics into a real workspace." />
      ) : panel === 'overview' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Graph nodes" value={nodes.length} detail="Returned in the first 100-node page" />
            <Metric label="Graph edges" value={edges.length} detail="Returned in the first 100-edge page" />
            <Metric label="Evidence records" value={evidenceItems.length} detail="Latest bounded evidence page" />
            <Metric label="Change Passports" value={passports.length} detail="Recorded passport nodes" />
          </div>
          <section className="rounded-lg border border-edge bg-panel p-5" aria-label="Evidence ledger integrity">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Ledger integrity</h3>
                <p className="mt-2 text-sm text-ink">{integrity ? (integrity.ok ? 'Hash-chain verification passed' : 'Integrity issues detected') : 'Integrity not measured'}</p>
                <p className="mt-1 text-xs text-mute">{integrity ? `${integrity.ledgerEntriesChecked} ledger entries checked · ${integrity.problems.length} findings` : 'Waiting for repository integrity report'}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 font-mono text-[10px] ${integrity?.ok ? 'border-ok/40 text-ok' : integrity ? 'border-bad/40 text-bad' : 'border-edge text-mute'}`}>{integrity?.ok ? 'VERIFIED' : integrity ? 'ISSUES' : 'UNKNOWN'}</span>
            </div>
            {integrity && integrity.problems.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-edge pt-3">
                {integrity.problems.slice(0, 5).map((problem, index) => {
                  const item = objectValue(problem);
                  return <li key={index} className="text-xs text-bad">{display(item.code)} · {display(item.message)}</li>;
                })}
              </ul>
            )}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-edge bg-panel p-5">
              <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Graph composition</h3>
              {nodeTypes.length ? (
                <ul className="mt-4 space-y-3">
                  {nodeTypes.slice(0, 8).map(([type, count]) => (
                    <li key={type} className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-mono text-ink">{type}</span>
                      <span className="tabular-nums text-cyan">{count}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-4 text-sm text-mute">No graph nodes returned for this repository.</p>}
            </section>
            <section className="rounded-lg border border-edge bg-panel p-5">
              <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Evidence ledger</h3>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-ink">{graph?.ledger.entries ?? 0}</p>
              <p className="mt-1 text-xs text-mute">Ledger entries reported by the local graph store</p>
              <p className="mt-4 break-all font-mono text-[11px] text-mute">Head hash: {graph?.ledger.headHash ?? 'Not available'}</p>
              <p className="mt-3 text-xs text-mute">Metrics are bounded API results, not extrapolated totals.</p>
            </section>
          </div>
        </>
      ) : panel === 'graph' ? (
        <section className="overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="border-b border-edge p-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Graph nodes</h3>
          </div>
          {nodes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-void text-[10px] uppercase tracking-wider text-mute"><tr><th className="px-4 py-3">Type</th><th className="px-4 py-3">Key / ID</th><th className="px-4 py-3">Commit</th></tr></thead>
                <tbody>{nodes.map((item, index) => {
                  const node = objectValue(item);
                  return <tr key={display(node.id) === '—' ? index : display(node.id)} className="border-t border-edge">
                    <td className="px-4 py-3 font-mono text-cyan">{display(node.type)}</td>
                    <td className="max-w-[360px] break-all px-4 py-3 text-ink">{display(node.key ?? node.id)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-mute">{display(node.validFromCommit)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : <div className="p-5"><Empty title="Graph is empty" detail="Scan a repository to populate architecture nodes and edges." /></div>}
        </section>
      ) : panel === 'evidence' ? (
        <section className="overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="border-b border-edge p-4"><h3 className="font-mono text-xs uppercase tracking-wider text-mute">Evidence records</h3></div>
          {evidenceItems.length ? (
            <div className="divide-y divide-edge">{evidenceItems.map((item, index) => {
              const entry = objectValue(item);
              return <article key={display(entry.id) === '—' ? index : display(entry.id)} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-sm text-ink">{display(entry.source)}</p>
                  <span className="rounded-full border border-edge px-2 py-1 font-mono text-[10px] text-cyan">{display(entry.status)}</span>
                </div>
                <p className="mt-2 text-xs text-mute">{display(entry.sourceType)} · {display(entry.commitSha)}</p>
                <p className="mt-2 break-all font-mono text-[10px] text-mute">{display(entry.contentHash)}</p>
              </article>;
            })}</div>
          ) : <div className="p-5"><Empty title="No evidence found" detail="Ingest CI, test, environment or recorded telemetry evidence through the local API or CLI." /></div>}
        </section>
      ) : (
        <section className="rounded-lg border border-edge bg-panel p-5">
          <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Change Passports</h3>
          {passports.length ? (
            <ul className="mt-4 divide-y divide-edge">{passports.map((item, index) => {
              const passport = objectValue(item);
              return <li key={display(passport.id) === '—' ? index : display(passport.id)} className="py-3">
                <p className="break-all font-mono text-sm text-ink">{display(passport.key ?? passport.id)}</p>
                <p className="mt-1 text-xs text-mute">Version {display(passport.version)} · {display(passport.validFromCommit)}</p>
              </li>;
            })}</ul>
          ) : <div className="mt-4"><Empty title="No Change Passports yet" detail="Create a passport from commit-scoped evidence with the ORBIT CLI or authenticated local API. Missing verification should remain visible, not guessed." /></div>}
        </section>
      )}

      <p className="text-[11px] leading-5 text-mute">
        Privacy: the browser client reads only through the authenticated loopback API. The token is not persisted. This dashboard does not upload source code, run builds, connect to hardware, or claim unmeasured test/coverage results.
      </p>
    </div>
  );
}
