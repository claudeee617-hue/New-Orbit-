import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EngineWorkbenches } from './EngineWorkbenches.js';
import { Graph3D } from './Graph3D.js';
import {
  createOrbitApiClient,
  OrbitApiError,
  type ApiAIAnalysis,
  type ApiAIPreview,
  type ApiAIProvider,
  type ApiAIRequest,
  type ApiEvidencePage,
  type ApiFlareHistory,
  type ApiGraphPage,
  type ApiRepository,
} from './api.js';

type Panel = 'overview' | 'graph' | 'evidence' | 'passports' | 'ai';

function messageOf(error: unknown): string {
  if (error instanceof OrbitApiError) {
    if (error.status === 429 && error.retryAfterSeconds !== undefined) {
      return `${error.message}. Retry in about ${error.retryAfterSeconds} seconds.`;
    }
    return error.message;
  }
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

export function filterGraphNodesByType(nodes: unknown[], type: string): unknown[] {
  return type === 'all' ? nodes : nodes.filter((item) => display(objectValue(item).type) === type);
}

export function sortEvidenceTimeline(evidence: unknown[]): unknown[] {
  return evidence
    .map((item, index) => {
      const value = objectValue(item);
      const raw = typeof value.timestamp === 'string' ? value.timestamp : value.recordedAt;
      const time = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
      return { item, index, time };
    })
    .sort((a, b) => {
      if (Number.isNaN(a.time) && Number.isNaN(b.time)) return a.index - b.index;
      if (Number.isNaN(a.time)) return 1;
      if (Number.isNaN(b.time)) return -1;
      return b.time - a.time || a.index - b.index;
    })
    .map(({ item }) => item);
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
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
  const [flareHistory, setFlareHistory] = useState<ApiFlareHistory['history'] | null>(null);
  const [evidenceHasMore, setEvidenceHasMore] = useState(false);
  const [loadingMoreEvidence, setLoadingMoreEvidence] = useState(false);
  const [passports, setPassports] = useState<unknown[]>([]);
  const [passportsHaveMore, setPassportsHaveMore] = useState(false);
  const [loadingMorePassports, setLoadingMorePassports] = useState(false);
  const [integrity, setIntegrity] = useState<{
    ok: boolean;
    ledgerEntriesChecked: number;
    problems: unknown[];
  } | null>(null);
  const [panel, setPanel] = useState<Panel>('overview');
  const [loading, setLoading] = useState(false);
  const [loadingMoreGraph, setLoadingMoreGraph] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiProvider, setAiProvider] = useState<ApiAIProvider>('ollama');
  const [aiModel, setAiModel] = useState('');
  const [aiPrompt, setAiPrompt] = useState(
    'Summarise the selected evidence, state what it proves and what remains unknown.',
  );
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [aiRequest, setAiRequest] = useState<ApiAIRequest | null>(null);
  const [aiPreview, setAiPreview] = useState<ApiAIPreview | null>(null);
  const [aiPreviewNotice, setAiPreviewNotice] = useState('');
  const [aiConfirmed, setAiConfirmed] = useState(false);
  const [aiResult, setAiResult] = useState<ApiAIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState('');
  const [graphTypeFilter, setGraphTypeFilter] = useState('all');
  const [graphViewMode, setGraphViewMode] = useState<'2d' | '3d'>('2d');
  const [evidenceVerification, setEvidenceVerification] = useState<{
    fileName: string;
    actualHash: string;
    expectedHash: string;
    matches: boolean;
  } | null>(null);
  const [evidenceVerificationError, setEvidenceVerificationError] = useState('');
  const [verifyingEvidence, setVerifyingEvidence] = useState(false);

  const client = useMemo(() => (token ? createOrbitApiClient({ token }) : null), [token]);

  const loadWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      if (!client) return;
      setLoading(true);
      setError('');
      try {
        const result = await client.listRepositories(signal);
        setRepositories(result.repositories);
        const selected =
          result.repositories.find((item) => item.key === repositoryKey) ?? result.repositories[0];
        if (!selected) {
          setRepositoryKey('');
          setGraph(null);
          setEvidence(null);
          setEvidenceHasMore(false);
          setFlareHistory(null);
          setPassports([]);
          setPassportsHaveMore(false);
          setIntegrity(null);
          setNotice(
            'No repository is registered yet. Scan a local repository with the ORBIT CLI or API.',
          );
          return;
        }
        setRepositoryKey(selected.key);
        const [graphResult, evidenceResult, passportResult, integrityResult, flareResult] =
          await Promise.all([
            client.getGraph(selected.key, { limit: 100, ...(signal ? { signal } : {}) }),
            client.getEvidence(selected.key, { limit: 100, ...(signal ? { signal } : {}) }),
            client.getPassports(selected.key, { limit: 100, ...(signal ? { signal } : {}) }),
            client.getIntegrity(selected.key, signal),
            client.getFlareHistory(selected.key, signal ? { signal } : {}),
          ]);
        setGraph(graphResult);
        setEvidence(evidenceResult);
        setEvidenceHasMore(evidenceResult.page.hasMore);
        setPassports(passportResult.passports);
        setPassportsHaveMore(passportResult.page.hasMore);
        setIntegrity(integrityResult.integrity);
        setFlareHistory(flareResult.history);
        setNotice('');
      } catch (cause) {
        if (!signal?.aborted) setError(messageOf(cause));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [client, repositoryKey],
  );

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void loadWorkspace(controller.signal);
    return () => controller.abort();
  }, [client, loadWorkspace]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const evidenceItems = evidence?.evidence ?? [];
  const selectedEvidence = evidenceItems.find(
    (item) => display(objectValue(item).id) === selectedEvidenceId,
  );
  const graphVisibleNodes = useMemo(
    () => filterGraphNodesByType(nodes, graphTypeFilter),
    [nodes, graphTypeFilter],
  );
  const graphNodeTypes = useMemo(
    () => [...new Set(nodes.map((item) => display(objectValue(item).type)))].sort(),
    [nodes],
  );
  const evidenceTimeline = useMemo(() => sortEvidenceTimeline(evidenceItems), [evidenceItems]);
  const graphPlotNodes = useMemo(() => {
    const visible = graphVisibleNodes
      .filter((item) => typeof objectValue(item).id === 'string')
      .slice(0, 40);
    const radius = visible.length > 1 ? 145 : 0;
    return visible.map((item, index) => {
      const angle = visible.length > 1 ? (index / visible.length) * Math.PI * 2 - Math.PI / 2 : 0;
      const node = objectValue(item);
      return {
        id: display(node.id),
        x: 360 + Math.cos(angle) * radius,
        y: 205 + Math.sin(angle) * radius,
        label: display(node.key ?? node.type).slice(0, 22),
      };
    });
  }, [graphVisibleNodes]);
  const graph3DNodes = useMemo(
    () =>
      graphPlotNodes.map((node, index) => {
        const angle = (index / Math.max(1, graphPlotNodes.length)) * Math.PI * 2;
        const radius = graphPlotNodes.length > 1 ? 0.8 : 0;
        return {
          id: node.id,
          label: node.label,
          x: Math.cos(angle) * radius,
          y: ((index % 5) - 2) * 0.11,
          z: Math.sin(angle) * radius,
        };
      }),
    [graphPlotNodes],
  );
  const graphPlotPositions = useMemo(
    () => new Map(graphPlotNodes.map((item) => [item.id, item])),
    [graphPlotNodes],
  );
  const graphPlotEdges = useMemo(
    () =>
      edges
        .flatMap((item, index) => {
          const edge = objectValue(item);
          const from = graphPlotPositions.get(display(edge.fromId));
          const to = graphPlotPositions.get(display(edge.toId));
          return from && to
            ? [
                {
                  id: display(edge.id) === '—' ? String(index) : display(edge.id),
                  from,
                  to,
                },
              ]
            : [];
        })
        .slice(0, 120),
    [edges, graphPlotPositions],
  );
  const graph3DEdges = useMemo(
    () => graphPlotEdges.map((edge) => ({ id: edge.id, fromId: edge.from.id, toId: edge.to.id })),
    [graphPlotEdges],
  );
  const selectedGraphNode = nodes.find(
    (item) => display(objectValue(item).id) === selectedGraphNodeId,
  );
  const selectedGraphEdges = selectedGraphNode
    ? edges.filter((item) => {
        const edge = objectValue(item);
        return edge.fromId === selectedGraphNodeId || edge.toId === selectedGraphNodeId;
      })
    : [];
  const nodeTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of nodes) {
      const type = display(objectValue(item).type);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  async function verifyEvidenceArtifact(file: File) {
    if (!selectedEvidence) return;
    const expectedHash = display(objectValue(selectedEvidence).contentHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      setEvidenceVerification(null);
      setEvidenceVerificationError('This evidence record does not contain a valid SHA-256 hash.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setEvidenceVerification(null);
      setEvidenceVerificationError('Choose an artifact no larger than 10 MiB.');
      return;
    }

    setVerifyingEvidence(true);
    setEvidenceVerification(null);
    setEvidenceVerificationError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const actualHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      setEvidenceVerification({
        fileName: file.name,
        actualHash,
        expectedHash,
        matches: actualHash === expectedHash,
      });
    } catch {
      setEvidenceVerificationError(
        'Browser SHA-256 verification is unavailable in this context. Use a secure local browser origin.',
      );
    } finally {
      setVerifyingEvidence(false);
    }
  }

  function invalidateAiPreview() {
    setAiRequest(null);
    setAiPreview(null);
    setAiPreviewNotice('');
    setAiConfirmed(false);
    setAiResult(null);
  }

  async function previewAI() {
    if (!client || !selectedRepository) return;
    if (!aiModel.trim() || !aiPrompt.trim() || selectedEvidenceIds.length === 0) {
      setError('Choose at least one evidence record and enter a model and analysis question.');
      return;
    }
    const input: ApiAIRequest = {
      provider: aiProvider,
      model: aiModel.trim(),
      prompt: aiPrompt.trim(),
      evidenceIds: selectedEvidenceIds,
    };
    setAiLoading(true);
    setError('');
    try {
      const result = await client.previewAI(selectedRepository.key, input);
      setAiRequest(input);
      setAiPreview(result.preview);
      setAiPreviewNotice(result.notice);
      setAiConfirmed(false);
      setAiResult(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAiLoading(false);
    }
  }

  async function analyseAI() {
    if (!client || !selectedRepository || !aiRequest || !aiPreview || !aiConfirmed) return;
    setAiLoading(true);
    setError('');
    try {
      const result = await client.analyseAI(selectedRepository.key, {
        ...aiRequest,
        approvedContextSha256: aiPreview.sha256,
        confirmed: true,
      });
      setAiResult(result.analysis);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setAiLoading(false);
    }
  }

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
    setEvidenceHasMore(false);
    setFlareHistory(null);
    setSelectedEvidenceId('');
    setSelectedGraphNodeId('');
    setEvidenceVerification(null);
    setEvidenceVerificationError('');
    setPassports([]);
    setPassportsHaveMore(false);
    setIntegrity(null);
    setSelectedEvidenceIds([]);
    invalidateAiPreview();
    setError('');
    setNotice('Disconnected. The token was held only in page memory.');
  }

  function changeRepository(nextKey: string) {
    setRepositoryKey(nextKey);
    setGraph(null);
    setEvidence(null);
    setEvidenceHasMore(false);
    setFlareHistory(null);
    setSelectedEvidenceId('');
    setEvidenceVerification(null);
    setEvidenceVerificationError('');
    setPassports([]);
    setPassportsHaveMore(false);
    setIntegrity(null);
    setSelectedEvidenceIds([]);
    invalidateAiPreview();
    // A fresh render triggers a new request through the selected key.
  }

  async function loadMoreGraph() {
    if (!client || !graph || loadingMoreGraph) return;
    setLoadingMoreGraph(true);
    setError('');
    try {
      const next = await client.getGraph(repositoryKey, {
        limit: 100,
        nodeOffset: graph.nodes.length,
        edgeOffset: graph.edges.length,
      });
      setGraph((current) => {
        if (!current || current.repository.key !== next.repository.key) return current;
        const knownNodes = new Set(current.nodes.map((item) => display(objectValue(item).id)));
        const knownEdges = new Set(current.edges.map((item) => display(objectValue(item).id)));
        return {
          ...next,
          nodes: [
            ...current.nodes,
            ...next.nodes.filter((item) => !knownNodes.has(display(objectValue(item).id))),
          ],
          edges: [
            ...current.edges,
            ...next.edges.filter((item) => !knownEdges.has(display(objectValue(item).id))),
          ],
          page: next.page,
        };
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoadingMoreGraph(false);
    }
  }

  async function loadMoreEvidence() {
    if (!client || !evidence || loadingMoreEvidence || !evidenceHasMore) return;
    setLoadingMoreEvidence(true);
    setError('');
    try {
      const next = await client.getEvidence(repositoryKey, {
        limit: 100,
        offset: evidence.evidence.length,
      });
      setEvidence((current) => {
        if (!current) return next;
        const known = new Set(current.evidence.map((item) => display(objectValue(item).id)));
        return {
          ...next,
          evidence: [
            ...current.evidence,
            ...next.evidence.filter((item) => !known.has(display(objectValue(item).id))),
          ],
        };
      });
      setEvidenceHasMore(next.page.hasMore);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoadingMoreEvidence(false);
    }
  }

  async function loadMorePassports() {
    if (!client || loadingMorePassports || !passportsHaveMore) return;
    setLoadingMorePassports(true);
    setError('');
    try {
      const next = await client.getPassports(repositoryKey, {
        limit: 100,
        offset: passports.length,
      });
      setPassports((current) => {
        const known = new Set(current.map((item) => display(objectValue(item).id)));
        return [
          ...current,
          ...next.passports.filter((item) => !known.has(display(objectValue(item).id))),
        ];
      });
      setPassportsHaveMore(next.page.hasMore);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoadingMorePassports(false);
    }
  }

  if (!client) {
    return (
      <section className="mx-auto max-w-2xl rounded-xl border border-edge bg-panel p-6 sm:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan">Local connection</p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Connect your ORBIT workspace</h2>
        <p className="mt-3 text-sm leading-6 text-mute">
          Enter the local API token from the private{' '}
          <code className="font-mono text-cyan">api.token</code> file in your ORBIT workspace. The
          token stays in this page's memory and is sent only in the Authorization header to the
          same-origin local API proxy. It is not saved to browser storage.
        </p>
        <form onSubmit={connect} className="mt-6 space-y-3">
          <label
            htmlFor="orbit-api-token"
            className="block text-xs font-medium uppercase tracking-wider text-mute"
          >
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
        {error && (
          <p role="alert" className="mt-4 text-sm text-bad">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 text-sm text-mute">
            {notice}
          </p>
        )}
        <p className="mt-6 border-t border-edge pt-4 text-xs leading-5 text-mute">
          Start the local services from the repository root with{' '}
          <code className="font-mono text-cyan">pnpm dev</code>. Keep the token private; never paste
          it into an issue or commit it to Git.
        </p>
      </section>
    );
  }

  const selectedRepository = repositories.find((item) => item.key === repositoryKey);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-edge bg-panel p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ok">
            Authenticated · local only
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">Engineering Command Center</h2>
          <p className="mt-1 text-xs text-mute">
            Repository graph, evidence and Change Passport data from your local database.
          </p>
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
      {notice && (
        <div role="status" className="rounded-lg border border-edge bg-panel p-4 text-sm text-mute">
          {notice}
        </div>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-sm text-mute">
          Repository
          <select
            value={repositoryKey}
            onChange={(event) => changeRepository(event.target.value)}
            className="max-w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono text-sm text-ink"
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.key}>
                {repository.displayName} · {repository.key}
              </option>
            ))}
          </select>
        </label>
        <span className="font-mono text-xs text-mute">
          {selectedRepository?.key ?? 'No repository selected'}
        </span>
      </section>

      <nav aria-label="Engineering dashboard views" className="flex flex-wrap gap-2">
        {(['overview', 'graph', 'evidence', 'passports', 'ai'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-current={panel === item ? 'page' : undefined}
            onClick={() => setPanel(item)}
            className={`rounded-md border px-3 py-2 text-xs font-medium uppercase tracking-wider ${panel === item ? 'border-cyan bg-cyan/10 text-cyan' : 'border-edge text-mute hover:border-cyan hover:text-ink'}`}
          >
            {item === 'passports' ? 'Change Passports' : item === 'ai' ? 'AI Analysis' : item}
          </button>
        ))}
      </nav>

      {!selectedRepository && !loading ? (
        <Empty
          title="No repository data yet"
          detail="Register or scan a local repository with orbit init / orbit scan, then refresh this view. The dashboard never inserts demo metrics into a real workspace."
        />
      ) : panel === 'overview' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Graph nodes"
              value={nodes.length}
              detail="Returned in the first 100-node page"
            />
            <Metric
              label="Graph edges"
              value={edges.length}
              detail="Returned in the first 100-edge page"
            />
            <Metric
              label="Evidence records"
              value={evidenceItems.length}
              detail="Latest bounded evidence page"
            />
            <Metric
              label="Change Passports"
              value={passports.length}
              detail="Recorded passport nodes"
            />
          </div>
          <section
            className="rounded-lg border border-edge bg-panel p-5"
            aria-label="Evidence ledger integrity"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-mute">
                  Ledger integrity
                </h3>
                <p className="mt-2 text-sm text-ink">
                  {integrity
                    ? integrity.ok
                      ? 'Hash-chain verification passed'
                      : 'Integrity issues detected'
                    : 'Integrity not measured'}
                </p>
                <p className="mt-1 text-xs text-mute">
                  {integrity
                    ? `${integrity.ledgerEntriesChecked} ledger entries checked · ${integrity.problems.length} findings`
                    : 'Waiting for repository integrity report'}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 font-mono text-[10px] ${integrity?.ok ? 'border-ok/40 text-ok' : integrity ? 'border-bad/40 text-bad' : 'border-edge text-mute'}`}
              >
                {integrity?.ok ? 'VERIFIED' : integrity ? 'ISSUES' : 'UNKNOWN'}
              </span>
            </div>
            {integrity && integrity.problems.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-edge pt-3">
                {integrity.problems.slice(0, 5).map((problem, index) => {
                  const item = objectValue(problem);
                  return (
                    <li key={index} className="text-xs text-bad">
                      {display(item.code)} · {display(item.message)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-edge bg-panel p-5">
              <h3 className="font-mono text-xs uppercase tracking-wider text-mute">
                Graph composition
              </h3>
              {nodeTypes.length ? (
                <ul className="mt-4 space-y-3">
                  {nodeTypes.slice(0, 8).map(([type, count]) => (
                    <li key={type} className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-mono text-ink">{type}</span>
                      <span className="tabular-nums text-cyan">{count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-mute">
                  No graph nodes returned for this repository.
                </p>
              )}
            </section>
            <section className="rounded-lg border border-edge bg-panel p-5">
              <h3 className="font-mono text-xs uppercase tracking-wider text-mute">
                Evidence ledger
              </h3>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-ink">
                {graph?.ledger.entries ?? 0}
              </p>
              <p className="mt-1 text-xs text-mute">
                Ledger entries reported by the local graph store
              </p>
              <p className="mt-4 break-all font-mono text-[11px] text-mute">
                Head hash: {graph?.ledger.headHash ?? 'Not available'}
              </p>
              <p className="mt-3 text-xs text-mute">
                Metrics are bounded API results, not extrapolated totals.
              </p>
            </section>
          </div>
        </>
      ) : panel === 'graph' ? (
        <section className="overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge p-4">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-mute">
                Engineering graph
              </h3>
              <p className="mt-1 text-xs text-mute">
                Radial overview of loaded nodes and their stored relationships.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-md border border-edge p-1"
                aria-label="Graph rendering mode"
              >
                <button
                  type="button"
                  aria-pressed={graphViewMode === '2d'}
                  onClick={() => setGraphViewMode('2d')}
                  className={
                    'rounded px-3 py-2 text-xs ' +
                    (graphViewMode === '2d' ? 'bg-cyan/10 text-cyan' : 'text-mute')
                  }
                >
                  2D
                </button>
                <button
                  type="button"
                  aria-pressed={graphViewMode === '3d'}
                  onClick={() => setGraphViewMode('3d')}
                  className={
                    'rounded px-3 py-2 text-xs ' +
                    (graphViewMode === '3d' ? 'bg-cyan/10 text-cyan' : 'text-mute')
                  }
                >
                  3D
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-mute">
                Filter node type
                <select
                  value={graphTypeFilter}
                  onChange={(event) => setGraphTypeFilter(event.target.value)}
                  className="rounded-md border border-edge bg-void px-2 py-2 text-xs text-ink"
                >
                  <option value="all">All types</option>
                  {graphNodeTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {graphPlotNodes.length ? (
            <div className="border-b border-edge bg-void/40 p-3">
              {graphViewMode === '3d' ? (
                <Graph3D
                  nodes={graph3DNodes}
                  edges={graph3DEdges}
                  selectedId={selectedGraphNodeId}
                  onSelect={setSelectedGraphNodeId}
                />
              ) : (
                <svg
                  viewBox="0 0 720 410"
                  role="img"
                  aria-label={`Engineering graph showing ${graphPlotNodes.length} ${graphTypeFilter === 'all' ? '' : graphTypeFilter + ' '}nodes and ${graphPlotEdges.length} visible relationships`}
                  className="h-auto max-h-[420px] w-full"
                >
                  <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5">
                    {graphPlotEdges.map((edge) => (
                      <line
                        key={edge.id}
                        x1={edge.from.x}
                        y1={edge.from.y}
                        x2={edge.to.x}
                        y2={edge.to.y}
                      />
                    ))}
                  </g>
                  <g>
                    {graphPlotNodes.map((node) => (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect graph node ${node.label}`}
                        aria-pressed={selectedGraphNodeId === node.id}
                        onClick={() => setSelectedGraphNodeId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedGraphNodeId(node.id);
                          }
                        }}
                        className="cursor-pointer outline-none focus-visible:opacity-70"
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r="8"
                          fill="currentColor"
                          fillOpacity={selectedGraphNodeId === node.id ? 1 : 0.72}
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <text
                          x={node.x}
                          y={node.y - 14}
                          textAnchor="middle"
                          fontSize="10"
                          fill="currentColor"
                        >
                          {node.label}
                        </text>
                      </g>
                    ))}
                  </g>
                </svg>
              )}
              <p className="px-2 text-[10px] text-mute">
                {graphVisibleNodes.length > graphPlotNodes.length
                  ? `Showing ${graphPlotNodes.length} of ${graphVisibleNodes.length} matching loaded nodes; select a node here or in the table.`
                  : 'Select a node in the graph or table to inspect its exact stored relationships.'}
              </p>
            </div>
          ) : null}
          {nodes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-void text-[10px] uppercase tracking-wider text-mute">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Key / ID</th>
                    <th className="px-4 py-3">Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {graphVisibleNodes.map((item, index) => {
                    const node = objectValue(item);
                    return (
                      <tr
                        key={display(node.id) === '—' ? index : display(node.id)}
                        className="border-t border-edge"
                      >
                        <td className="px-4 py-3 font-mono text-cyan">{display(node.type)}</td>
                        <td className="max-w-[360px] break-all px-4 py-3 text-ink">
                          <button
                            type="button"
                            onClick={() => setSelectedGraphNodeId(display(node.id))}
                            aria-pressed={selectedGraphNodeId === display(node.id)}
                            className="text-left underline decoration-edge underline-offset-4 hover:text-cyan"
                          >
                            {display(node.key ?? node.id)}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-mute">
                          {display(node.validFromCommit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <Empty
                title="Graph is empty"
                detail="Scan a repository to populate architecture nodes and edges."
              />
            </div>
          )}
          {selectedGraphNode ? (
            <aside className="border-t border-edge bg-void/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-mute">
                  Selected graph node
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedGraphNodeId('')}
                  className="text-xs text-mute hover:text-cyan"
                >
                  Clear selection
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-sm text-cyan">
                {display(objectValue(selectedGraphNode).key ?? objectValue(selectedGraphNode).id)}
              </p>
              <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-void p-3 text-xs text-ink">
                {JSON.stringify(selectedGraphNode, null, 2)}
              </pre>
              <h5 className="mt-3 font-mono text-[10px] uppercase tracking-wider text-mute">
                Connected edges · {selectedGraphEdges.length} loaded
              </h5>
              {selectedGraphEdges.length ? (
                <ul className="mt-2 space-y-1">
                  {selectedGraphEdges.slice(0, 100).map((item, index) => {
                    const edge = objectValue(item);
                    return (
                      <li
                        key={display(edge.id) === '—' ? index : display(edge.id)}
                        className="break-all text-xs text-ink"
                      >
                        <span>{display(edge.type)} · </span>
                        {display(edge.fromId) === selectedGraphNodeId ? (
                          <button
                            type="button"
                            onClick={() => setSelectedGraphNodeId(display(edge.toId))}
                            disabled={
                              !nodes.some(
                                (node) => display(objectValue(node).id) === display(edge.toId),
                              )
                            }
                            className="underline decoration-edge underline-offset-4 hover:text-cyan disabled:no-underline disabled:opacity-60"
                          >
                            {display(edge.fromId)} → {display(edge.toId)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedGraphNodeId(display(edge.fromId))}
                            disabled={
                              !nodes.some(
                                (node) => display(objectValue(node).id) === display(edge.fromId),
                              )
                            }
                            className="underline decoration-edge underline-offset-4 hover:text-cyan disabled:no-underline disabled:opacity-60"
                          >
                            {display(edge.fromId)} → {display(edge.toId)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-mute">
                  No connected edges in the loaded graph page.
                </p>
              )}
            </aside>
          ) : null}
          {(graph?.page.hasMoreNodes || graph?.page.hasMoreEdges) && (
            <div className="border-t border-edge p-4">
              <button
                type="button"
                onClick={() => void loadMoreGraph()}
                disabled={loadingMoreGraph || loading}
                className="rounded-md border border-edge px-3 py-2 text-sm text-ink hover:border-cyan hover:text-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loadingMoreGraph ? 'Loading more graph data…' : 'Load next graph page'}
              </button>
              <p className="mt-2 text-xs text-mute">
                Loaded {nodes.length} nodes and {edges.length} edges. Additional records are fetched
                from the local API only when requested.
              </p>
            </div>
          )}
        </section>
      ) : panel === 'evidence' ? (
        <section className="overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="border-b border-edge p-4">
            <h3 className="font-mono text-xs uppercase tracking-wider text-mute">
              Evidence records
            </h3>
          </div>
          {evidenceItems.length ? (
            <div className="divide-y divide-edge">
              {evidenceTimeline.map((item, index) => {
                const entry = objectValue(item);
                const id = display(entry.id);
                return (
                  <article key={id === '—' ? index : id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEvidenceId(id);
                          setEvidenceVerification(null);
                          setEvidenceVerificationError('');
                        }}
                        aria-pressed={selectedEvidenceId === id}
                        className="break-all text-left font-mono text-sm text-ink underline decoration-edge underline-offset-4 hover:text-cyan"
                      >
                        {display(entry.source)}
                      </button>
                      <span className="rounded-full border border-edge px-2 py-1 font-mono text-[10px] text-cyan">
                        {display(entry.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-mute">
                      {display(entry.sourceType)} · {display(entry.commitSha)}
                    </p>
                    {(() => {
                      const recordedAt =
                        typeof entry.timestamp === 'string'
                          ? entry.timestamp
                          : typeof entry.recordedAt === 'string'
                            ? entry.recordedAt
                            : '';
                      const parsed = recordedAt ? Date.parse(recordedAt) : Number.NaN;
                      return !Number.isNaN(parsed) ? (
                        <time
                          dateTime={recordedAt}
                          className="mt-1 block font-mono text-[10px] text-mute"
                        >
                          {new Date(parsed).toLocaleString()}
                        </time>
                      ) : null;
                    })()}
                    <p className="mt-2 break-all font-mono text-[10px] text-mute">
                      {display(entry.contentHash)}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <Empty
                title="No evidence found"
                detail="Ingest CI, test, environment or recorded telemetry evidence through the local API or CLI."
              />
            </div>
          )}
          {evidenceHasMore ? (
            <div className="border-t border-edge p-4">
              <button
                type="button"
                onClick={() => void loadMoreEvidence()}
                disabled={loadingMoreEvidence}
                className="rounded-md border border-edge px-3 py-2 text-sm text-ink hover:border-cyan hover:text-cyan disabled:opacity-40"
              >
                {loadingMoreEvidence ? 'Loading evidence…' : 'Load more evidence'}
              </button>
              <p className="mt-2 text-xs text-mute">
                Showing {evidenceItems.length} stored evidence records.
              </p>
            </div>
          ) : null}
          {selectedEvidence ? (
            <aside className="border-t border-edge bg-void/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-mute">
                  Selected evidence record
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEvidenceId('');
                    setEvidenceVerification(null);
                    setEvidenceVerificationError('');
                  }}
                  className="text-xs text-mute hover:text-cyan"
                >
                  Clear selection
                </button>
              </div>
              <div className="mt-3 rounded-md border border-edge bg-void/60 p-3">
                <label className="block">
                  <span className="text-xs font-medium text-ink">
                    Verify a local artifact against this SHA-256
                  </span>
                  <input
                    type="file"
                    disabled={verifyingEvidence}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void verifyEvidenceArtifact(file);
                      event.currentTarget.value = '';
                    }}
                    className="mt-2 block w-full text-xs text-mute file:mr-3 file:rounded-md file:border file:border-edge file:bg-panel file:px-3 file:py-2 file:text-xs file:text-ink"
                  />
                </label>
                <p className="mt-2 text-[10px] text-mute">
                  Verification runs in this browser only. The file is not uploaded or sent to the
                  API. Maximum file size: 10 MiB.
                </p>
                {verifyingEvidence ? (
                  <p role="status" className="mt-2 text-xs text-mute">
                    Computing SHA-256…
                  </p>
                ) : null}
                {evidenceVerificationError ? (
                  <p role="alert" className="mt-2 text-xs text-bad">
                    {evidenceVerificationError}
                  </p>
                ) : null}
                {evidenceVerification ? (
                  <div className="mt-3 space-y-2">
                    <p
                      className={
                        evidenceVerification.matches ? 'text-xs text-ok' : 'text-xs text-bad'
                      }
                    >
                      {evidenceVerification.matches ? 'HASH MATCH' : 'HASH MISMATCH'} ·{' '}
                      {evidenceVerification.fileName}
                    </p>
                    <p className="break-all font-mono text-[10px] text-mute">
                      Expected: {evidenceVerification.expectedHash}
                    </p>
                    <p className="break-all font-mono text-[10px] text-mute">
                      Actual: {evidenceVerification.actualHash}
                    </p>
                  </div>
                ) : null}
              </div>
              <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-void p-3 text-xs text-ink">
                {JSON.stringify(selectedEvidence, null, 2)}
              </pre>
            </aside>
          ) : null}
        </section>
      ) : panel === 'ai' ? (
        <section className="space-y-5 rounded-lg border border-edge bg-panel p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan">
              Optional · evidence-cited · no automatic actions
            </p>
            <h3 className="mt-2 text-lg font-semibold text-ink">ORBIT AI Analysis</h3>
            <p className="mt-2 text-sm leading-6 text-mute">
              This sends only selected evidence metadata to the local API preview endpoint. No
              source files are read here. The provider request is not sent until you inspect the
              exact preview and explicitly approve it. Provider keys stay on the local API server.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs text-mute">
              Provider
              <select
                value={aiProvider}
                onChange={(event) => {
                  setAiProvider(event.target.value as ApiAIProvider);
                  invalidateAiPreview();
                }}
                className="w-full rounded-md border border-edge bg-void px-3 py-2 text-sm text-ink"
              >
                <option value="ollama">Ollama · local by default</option>
                <option value="openai">OpenAI · remote</option>
                <option value="anthropic">Anthropic · remote</option>
              </select>
            </label>
            <label className="space-y-2 text-xs text-mute">
              Model identifier
              <input
                value={aiModel}
                onChange={(event) => {
                  setAiModel(event.target.value);
                  invalidateAiPreview();
                }}
                placeholder="Enter a model available to your provider"
                className="w-full rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm text-ink"
              />
            </label>
          </div>

          <label className="block space-y-2 text-xs text-mute">
            Analysis question
            <textarea
              value={aiPrompt}
              onChange={(event) => {
                setAiPrompt(event.target.value);
                invalidateAiPreview();
              }}
              rows={3}
              className="w-full rounded-md border border-edge bg-void px-3 py-2 text-sm leading-6 text-ink"
            />
          </label>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-mute">
                Select evidence records
              </p>
              <span className="font-mono text-xs text-mute">
                {selectedEvidenceIds.length} selected · metadata only
              </span>
            </div>
            {evidenceItems.length ? (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-edge p-3">
                {evidenceItems.map((item, index) => {
                  const entry = objectValue(item);
                  const id = display(entry.id);
                  if (id === '—') return null;
                  const checked = selectedEvidenceIds.includes(id);
                  return (
                    <label
                      key={id || index}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-edge p-3"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedEvidenceIds((current) =>
                            checked ? current.filter((value) => value !== id) : [...current, id],
                          );
                          invalidateAiPreview();
                        }}
                        className="mt-1 accent-cyan"
                      />
                      <span className="min-w-0">
                        <span className="block break-all font-mono text-xs text-ink">
                          {display(entry.source)}
                        </span>
                        <span className="mt-1 block text-[11px] text-mute">
                          {display(entry.sourceType)} · {display(entry.status)} · {id}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="No evidence to analyse"
                detail="Ingest CI, test, environment or telemetry evidence first. ORBIT AI does not invent evidence."
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void previewAI()}
              disabled={aiLoading || !selectedRepository || selectedEvidenceIds.length === 0}
              className="rounded-md border border-cyan bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aiLoading ? 'Working…' : 'Preview exact context'}
            </button>
            <button
              type="button"
              onClick={invalidateAiPreview}
              disabled={!aiPreview && !aiResult}
              className="rounded-md border border-edge px-4 py-2 text-sm text-mute hover:text-ink disabled:opacity-40"
            >
              Clear preview
            </button>
          </div>

          {aiPreview && (
            <section className="space-y-3 rounded-md border border-edge bg-void p-4">
              <h4 className="font-mono text-xs uppercase tracking-wider text-cyan">
                Exact provider-bound preview
              </h4>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-mute">Destination</dt>
                  <dd className="mt-1 break-all font-mono text-ink">{aiPreview.destination}</dd>
                </div>
                <div>
                  <dt className="text-mute">Model</dt>
                  <dd className="mt-1 font-mono text-ink">{aiPreview.model}</dd>
                </div>
                <div>
                  <dt className="text-mute">Context size</dt>
                  <dd className="mt-1 text-ink">{aiPreview.bytes} bytes</dd>
                </div>
                <div>
                  <dt className="text-mute">Redactions</dt>
                  <dd className="mt-1 text-ink">{aiPreview.redactions}</dd>
                </div>
              </dl>
              <p className="break-all font-mono text-[10px] text-mute">
                Preview SHA-256: {aiPreview.sha256}
              </p>
              <p className="text-xs text-mute">
                Evidence IDs: {aiPreview.evidenceIds.join(', ') || 'None'}
              </p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-panel p-3 text-[11px] leading-5 text-ink">
                {aiPreview.text}
              </pre>
              <p className="text-xs leading-5 text-mute">{aiPreviewNotice}</p>
              <label className="flex items-start gap-3 text-xs leading-5 text-ink">
                <input
                  type="checkbox"
                  checked={aiConfirmed}
                  onChange={(event) => setAiConfirmed(event.target.checked)}
                  className="mt-1 accent-cyan"
                />
                I reviewed this exact preview and approve sending it to the displayed provider
                destination. I understand that provider data-retention terms may apply.
              </label>
              <button
                type="button"
                onClick={() => void analyseAI()}
                disabled={aiLoading || !aiConfirmed}
                className="rounded-md border border-cyan bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aiLoading ? 'Sending…' : 'Send approved context to provider'}
              </button>
            </section>
          )}

          {aiResult && (
            <section className="space-y-3 rounded-md border border-edge p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-mute">
                  Advisory analysis
                </h4>
                <span className="rounded-full border border-edge px-2 py-1 font-mono text-[10px] text-cyan">
                  {aiResult.citationStatus}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{aiResult.text}</p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-mute">
                {aiResult.limitations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p className="text-[10px] text-mute">
                This output is not verification evidence, does not alter the graph and cannot apply
                code changes.
              </p>
            </section>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-edge bg-panel p-5">
          <h3 className="font-mono text-xs uppercase tracking-wider text-mute">Change Passports</h3>
          {passports.length ? (
            <ul className="mt-4 divide-y divide-edge">
              {passports.map((item, index) => {
                const passport = objectValue(item);
                return (
                  <li
                    key={display(passport.id) === '—' ? index : display(passport.id)}
                    className="py-3"
                  >
                    <p className="break-all font-mono text-sm text-ink">
                      {display(passport.key ?? passport.id)}
                    </p>
                    <p className="mt-1 text-xs text-mute">
                      Version {display(passport.version)} · {display(passport.validFromCommit)}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-4">
              <Empty
                title="No Change Passports yet"
                detail="Create a passport from commit-scoped evidence with the ORBIT CLI or authenticated local API. Missing verification should remain visible, not guessed."
              />
            </div>
          )}
          {passportsHaveMore ? (
            <div className="mt-4 border-t border-edge pt-4">
              <button
                type="button"
                onClick={() => void loadMorePassports()}
                disabled={loadingMorePassports}
                className="rounded-md border border-edge px-3 py-2 text-sm text-ink hover:border-cyan hover:text-cyan disabled:opacity-40"
              >
                {loadingMorePassports ? 'Loading passports…' : 'Load more passports'}
              </button>
              <p className="mt-2 text-xs text-mute">
                Showing {passports.length} stored passport records.
              </p>
            </div>
          ) : null}
        </section>
      )}

      <EngineWorkbenches
        nodes={nodes}
        edges={edges}
        evidence={evidenceItems}
        passports={passports}
        flareHistory={flareHistory}
        onLoadPassportHistory={(passportId) =>
          client.getPassportHistory(repositoryKey, passportId).then((result) => result.history)
        }
        onComparePassports={(beforeId, afterId) =>
          client
            .comparePassports(repositoryKey, beforeId, afterId)
            .then((result) => result.comparison)
        }
        onLoadImpact={(filePath) =>
          client.getImpact(repositoryKey, filePath).then((result) => result.impact)
        }
      />

      <p className="text-[11px] leading-5 text-mute">
        Privacy: the browser client reads only through the authenticated loopback API. The token is
        not persisted. This dashboard does not upload source code, run builds, connect to hardware,
        or claim unmeasured test/coverage results.
      </p>
    </div>
  );
}
