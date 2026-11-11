import { useMemo, useState } from 'react';

type DataRecord = Record<string, unknown>;
type Workbench =
  'atlas' | 'witness' | 'flare' | 'capsule' | 'flight' | 'passports' | 'replay' | 'integrations';

interface EngineWorkbenchesProps {
  nodes: unknown[];
  edges: unknown[];
  evidence: unknown[];
  passports: unknown[];
  onLoadPassportHistory?: (passportId: string) => Promise<unknown>;
  onComparePassports?: (beforeId: string, afterId: string) => Promise<unknown>;
  onLoadImpact?: (filePath: string) => Promise<unknown>;
}

function record(value: unknown): DataRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as DataRecord)
    : {};
}

function label(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'Not recorded';
}

function nodeType(item: unknown): string {
  return label(record(item).type);
}

function nodeKey(item: unknown): string {
  const value = record(item);
  return label(value.key ?? value.path ?? value.id);
}

function evidenceType(item: unknown): string {
  return label(record(item).sourceType).toLowerCase();
}

function evidenceStatus(item: unknown): string {
  return label(record(item).status).toUpperCase();
}

function evidenceHash(item: unknown): string {
  return label(record(item).contentHash);
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-panel/60 p-6">
      <h4 className="font-medium text-ink">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-mute">{detail}</p>
    </div>
  );
}

function DataCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <article className="rounded-lg border border-edge bg-void/50 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-mute">{title}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-mute">{description}</p>
    </article>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value === 'PASS' || value === 'VERIFIED'
      ? 'border-ok/40 text-ok'
      : value === 'FAIL' || value === 'ISSUES'
        ? 'border-bad/40 text-bad'
        : 'border-edge text-mute';
  return (
    <span className={'rounded-full border px-2 py-1 font-mono text-[10px] ' + tone}>{value}</span>
  );
}

export function EngineWorkbenches({
  nodes,
  edges,
  evidence,
  passports,
  onLoadPassportHistory,
  onComparePassports,
  onLoadImpact,
}: EngineWorkbenchesProps) {
  const [active, setActive] = useState<Workbench>('atlas');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [comparisonTargetId, setComparisonTargetId] = useState('');
  const [passportHistory, setPassportHistory] = useState<unknown>(null);
  const [passportComparison, setPassportComparison] = useState<unknown>(null);
  const [passportActionLoading, setPassportActionLoading] = useState(false);
  const [passportActionError, setPassportActionError] = useState('');
  const [atlasImpact, setAtlasImpact] = useState<unknown>(null);
  const [atlasImpactLoading, setAtlasImpactLoading] = useState(false);
  const [atlasImpactError, setAtlasImpactError] = useState('');

  const atlasNodes = useMemo(
    () =>
      nodes.filter((item) =>
        [
          'Repository',
          'File',
          'Symbol',
          'Function',
          'Class',
          'Module',
          'Dependency',
          'Test',
        ].includes(nodeType(item)),
      ),
    [nodes],
  );
  const witnessEvidence = useMemo(
    () => evidence.filter((item) => ['coverage', 'ci'].includes(evidenceType(item))),
    [evidence],
  );
  const flareEvidence = useMemo(
    () => evidence.filter((item) => evidenceType(item) === 'test-report'),
    [evidence],
  );
  const capsuleEvidence = useMemo(
    () => evidence.filter((item) => evidenceType(item) === 'environment'),
    [evidence],
  );
  const flightEvidence = useMemo(
    () => evidence.filter((item) => evidenceType(item) === 'telemetry'),
    [evidence],
  );
  const flareNodes = useMemo(() => nodes.filter((item) => nodeType(item) === 'TestRun'), [nodes]);
  const capsuleNodes = useMemo(
    () => nodes.filter((item) => nodeType(item) === 'Environment'),
    [nodes],
  );
  const flightNodes = useMemo(
    () => nodes.filter((item) => nodeType(item) === 'TelemetrySession'),
    [nodes],
  );

  const selectedPassport = passports.find((item) => {
    const value = record(item);
    return label(value.id ?? value.key) === selectedId;
  });
  const filteredAtlas = atlasNodes.filter((item) => {
    const value = record(item);
    const haystack = [nodeType(item), nodeKey(item), label(value.validFromCommit)]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const selectedAtlas = filteredAtlas.find((item) => {
    const value = record(item);
    return label(value.id ?? value.key ?? value.path) === selectedId;
  });
  const selectedAtlasId = selectedAtlas ? label(record(selectedAtlas).id) : '';
  const relatedAtlasEdges = selectedAtlasId
    ? edges.filter((item) => {
        const value = record(item);
        return value.fromId === selectedAtlasId || value.toId === selectedAtlasId;
      })
    : [];
  const graphNodeLabel = (id: unknown) => {
    const found = nodes.find((item) => label(record(item).id) === label(id));
    return found ? `${nodeType(found)} · ${nodeKey(found)}` : label(id);
  };
  const selectedAtlasAttributes = selectedAtlas ? record(record(selectedAtlas).attrs) : {};
  const selectedAtlasLocation = record(selectedAtlasAttributes.location);
  const memoryTags = Array.isArray(selectedAtlasAttributes.tags)
    ? selectedAtlasAttributes.tags.filter((item): item is string => typeof item === 'string')
    : [];
  const memorySources = Array.isArray(selectedAtlasAttributes.sourceRefs)
    ? selectedAtlasAttributes.sourceRefs
    : [];
  const filteredWitness = witnessEvidence.filter((item) => {
    const value = record(item);
    return [label(value.source), evidenceStatus(item), label(value.commitSha), evidenceHash(item)]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  const tabs: { id: Workbench; label: string; detail: string }[] = [
    { id: 'atlas', label: 'ATLAS', detail: 'Architecture and symbols' },
    { id: 'witness', label: 'WITNESS', detail: 'Coverage and CI evidence' },
    { id: 'flare', label: 'FLARE', detail: 'Test reports' },
    { id: 'capsule', label: 'CAPSULE', detail: 'Environment records' },
    { id: 'flight', label: 'FLIGHT RECORDER', detail: 'Recorded telemetry' },
    { id: 'passports', label: 'PASSPORTS', detail: 'Versioned change records' },
    { id: 'replay', label: 'REPLAY ROOM', detail: 'Non-executing plans' },
    { id: 'integrations', label: 'MCP & AI', detail: 'Local integrations' },
  ];

  function changeTab(next: Workbench) {
    setActive(next);
    setQuery('');
    setSelectedId('');
    setAtlasImpact(null);
    setAtlasImpactError('');
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-edge bg-panel p-4 sm:p-5"
      aria-labelledby="engine-workbenches-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">
            Engine workbenches
          </p>
          <h3 id="engine-workbenches-heading" className="mt-1 text-lg font-semibold text-ink">
            Explore indexed evidence
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-mute">
            These views use only records returned by the local API. Missing data stays unmeasured;
            no test result, coverage percentage or hardware event is inferred.
          </p>
        </div>
        <label className="w-full max-w-sm">
          <span className="sr-only">Filter current workbench</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter current view…"
            className="w-full rounded-md border border-edge bg-void px-3 py-2 text-sm text-ink outline-none focus:border-cyan"
          />
        </label>
      </div>

      <nav aria-label="Engine workbenches" className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active === tab.id}
            onClick={() => changeTab(tab.id)}
            title={tab.detail}
            className={
              'shrink-0 rounded-md border px-3 py-2 text-left transition-colors ' +
              (active === tab.id
                ? 'border-cyan bg-cyan/10 text-cyan'
                : 'border-edge text-mute hover:border-cyan hover:text-ink')
            }
          >
            <span className="block font-mono text-[10px] font-semibold tracking-wider">
              {tab.label}
            </span>
            <span className="mt-1 block text-[10px] opacity-75">{tab.detail}</span>
          </button>
        ))}
      </nav>

      {active === 'atlas' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DataCard
              title="Indexed graph nodes"
              value={nodes.length}
              description="Current bounded API page"
            />
            <DataCard
              title="Relationships"
              value={edges.length}
              description="Current bounded API page"
            />
            <DataCard
              title="ATLAS records"
              value={atlasNodes.length}
              description="Repository, files, symbols and tests"
            />
          </div>
          {filteredAtlas.length ? (
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-void text-[10px] uppercase tracking-wider text-mute">
                  <tr>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Path / key</th>
                    <th className="px-3 py-3">Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAtlas.slice(0, 50).map((item, index) => {
                    const value = record(item);
                    return (
                      <tr
                        key={label(value.id) === 'Not recorded' ? index : label(value.id)}
                        className="border-t border-edge"
                      >
                        <td className="px-3 py-3 font-mono text-cyan">{nodeType(item)}</td>
                        <td className="max-w-[420px] break-all px-3 py-3 text-ink">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(label(value.id ?? value.key ?? value.path));
                              setAtlasImpact(null);
                              setAtlasImpactError('');
                            }}
                            aria-pressed={selectedId === label(value.id ?? value.key ?? value.path)}
                            aria-label={`Inspect ${nodeType(item)} ${nodeKey(item)}`}
                            className="text-left underline decoration-edge underline-offset-4 hover:text-cyan"
                          >
                            {nodeKey(item)}
                          </button>
                        </td>
                        <td className="px-3 py-3 font-mono text-[10px] text-mute">
                          {label(value.validFromCommit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAtlas.length > 50 && (
                <p className="border-t border-edge px-3 py-2 text-xs text-mute">
                  Showing the first 50 matching records of {filteredAtlas.length} in the loaded
                  page.
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              title="No matching ATLAS records"
              detail="Run an ATLAS scan for this repository or clear the filter. The current page is bounded and may not contain every indexed node."
            />
          )}
          {selectedAtlas ? (
            <aside className="rounded-lg border border-edge bg-void/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-mute">
                  Selected ATLAS record
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedId('')}
                  className="text-xs text-mute hover:text-cyan"
                >
                  Clear selection
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-sm text-cyan">{nodeKey(selectedAtlas)}</p>
              {['Function', 'Class', 'Symbol'].includes(nodeType(selectedAtlas)) ? (
                <section className="mt-3 rounded-md border border-edge bg-void/60 p-3">
                  <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    Symbol details
                  </h5>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[
                      ['Name', selectedAtlasAttributes.name],
                      ['Qualified name', selectedAtlasAttributes.qualifiedName],
                      ['Kind', selectedAtlasAttributes.kind],
                      ['File', selectedAtlasAttributes.file],
                      ['Start line', selectedAtlasLocation.startLine],
                      ['End line', selectedAtlasLocation.endLine],
                      ['Exported', selectedAtlasAttributes.exported],
                      ['Complexity', selectedAtlasAttributes.complexity],
                    ].map(([name, value]) => (
                      <div key={String(name)} className="min-w-0">
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-mute">
                          {String(name)}
                        </dt>
                        <dd className="mt-1 break-all text-xs text-ink">{label(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
              {['Decision', 'Documentation'].includes(nodeType(selectedAtlas)) ? (
                <section className="mt-3 rounded-md border border-edge bg-void/60 p-3">
                  <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    Memory record
                  </h5>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[
                      ['Memory kind', selectedAtlasAttributes.memoryKind],
                      ['Decision status', selectedAtlasAttributes.decisionStatus],
                      ['Topic', selectedAtlasAttributes.topic],
                      ['Schema version', selectedAtlasAttributes.schemaVersion],
                    ].map(([name, value]) => (
                      <div key={String(name)} className="min-w-0">
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-mute">
                          {String(name)}
                        </dt>
                        <dd className="mt-1 break-all text-xs text-ink">{label(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs font-medium text-ink">
                    {label(selectedAtlasAttributes.title)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-mute">
                    {label(selectedAtlasAttributes.summary)}
                  </p>
                  {memoryTags.length ? (
                    <p className="mt-3 text-xs text-mute">Tags: {memoryTags.join(', ')}</p>
                  ) : null}
                  {memorySources.length ? (
                    <div className="mt-3">
                      <h6 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                        Source references
                      </h6>
                      <pre className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-void p-2 text-[10px] text-ink">
                        {JSON.stringify(memorySources, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                  {Array.isArray(selectedAtlasAttributes.supersedes) &&
                  selectedAtlasAttributes.supersedes.length ? (
                    <p className="mt-2 break-all text-xs text-mute">
                      Supersedes: {selectedAtlasAttributes.supersedes.join(', ')}
                    </p>
                  ) : null}
                  {Array.isArray(selectedAtlasAttributes.conflictsWith) &&
                  selectedAtlasAttributes.conflictsWith.length ? (
                    <p className="mt-2 break-all text-xs text-bad">
                      Declared conflicts: {selectedAtlasAttributes.conflictsWith.join(', ')}
                    </p>
                  ) : null}
                </section>
              ) : null}
              <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-void p-3 text-xs text-ink">
                {JSON.stringify(selectedAtlas, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-mute">
                Raw stored node fields from the current API page. Relationships below are exact
                stored edge endpoints from the loaded graph page.
              </p>
              <div className="mt-4 border-t border-edge pt-3">
                <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                  Connected relationships ({relatedAtlasEdges.length} loaded)
                </h5>
                {relatedAtlasEdges.length ? (
                  <ul className="mt-2 space-y-2">
                    {relatedAtlasEdges.slice(0, 100).map((edge, index) => {
                      const relation = record(edge);
                      const outgoing = relation.fromId === selectedAtlasId;
                      const otherId = outgoing ? relation.toId : relation.fromId;
                      return (
                        <li
                          key={label(relation.id) === 'Not recorded' ? index : label(relation.id)}
                          className="rounded-md border border-edge bg-void p-2 text-xs"
                        >
                          <p className="font-mono text-cyan">{label(relation.type)}</p>
                          <p className="mt-1 break-all text-ink">
                            {outgoing ? '→ ' : '← '}
                            {graphNodeLabel(otherId)}
                          </p>
                          <p className="mt-1 break-all text-[10px] text-mute">
                            Edge {label(relation.id)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-mute">
                    No connected edges for this node in the currently loaded graph page.
                  </p>
                )}
              </div>
              {nodeType(selectedAtlas) === 'File' ? (
                <div className="mt-4 border-t border-edge pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                      File impact analysis
                    </h5>
                    <button
                      type="button"
                      disabled={!onLoadImpact || atlasImpactLoading}
                      onClick={async () => {
                        setAtlasImpactLoading(true);
                        setAtlasImpactError('');
                        setAtlasImpact(null);
                        try {
                          setAtlasImpact(await onLoadImpact?.(nodeKey(selectedAtlas)));
                        } catch (cause) {
                          setAtlasImpactError(
                            cause instanceof Error ? cause.message : 'Unable to load file impact.',
                          );
                        } finally {
                          setAtlasImpactLoading(false);
                        }
                      }}
                      className="rounded-md border border-edge px-3 py-2 text-xs text-ink hover:border-cyan disabled:opacity-40"
                    >
                      {atlasImpactLoading ? 'Analyzing…' : 'Analyze impact'}
                    </button>
                  </div>
                  {atlasImpactError ? (
                    <p role="alert" className="mt-2 text-xs text-bad">
                      {atlasImpactError}
                    </p>
                  ) : null}
                  {atlasImpact !== null ? (
                    <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-void p-3 text-xs text-ink">
                      {JSON.stringify(atlasImpact, null, 2)}
                    </pre>
                  ) : (
                    <p className="mt-2 text-xs text-mute">
                      Impact is fetched from the local graph only when requested.
                    </p>
                  )}
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : null}

      {active === 'witness' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DataCard
              title="Coverage / CI evidence"
              value={witnessEvidence.length}
              description="Supplied evidence records"
            />
            <DataCard
              title="PASS records"
              value={witnessEvidence.filter((item) => evidenceStatus(item) === 'PASS').length}
              description="Reported as pass by source"
            />
            <DataCard
              title="Failures"
              value={witnessEvidence.filter((item) => evidenceStatus(item) === 'FAIL').length}
              description="Reported as fail by source"
            />
          </div>
          {filteredWitness.length ? (
            <div className="space-y-2">
              {filteredWitness.slice(0, 40).map((item, index) => {
                const value = record(item);
                return (
                  <article
                    key={label(value.id) === 'Not recorded' ? index : label(value.id)}
                    className="rounded-lg border border-edge bg-void/40 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm text-ink">{label(value.source)}</p>
                      <StatusPill value={evidenceStatus(item)} />
                    </div>
                    <p className="mt-2 text-xs text-mute">
                      {label(value.sourceType)} · Commit {label(value.commitSha)}
                    </p>
                    <p className="mt-2 break-all font-mono text-[10px] text-mute">
                      SHA-256 {evidenceHash(item)}
                    </p>
                    <p className="mt-2 text-xs text-mute">{label(value.limitation)}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Coverage is NOT_MEASURED"
              detail="No coverage or CI evidence is present in the current API response. This is not zero coverage and must not be displayed as a percentage."
            />
          )}
        </div>
      ) : null}

      {active === 'flare' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DataCard
              title="Test report evidence"
              value={flareEvidence.length}
              description="Supplied test-report records"
            />
            <DataCard
              title="Test run nodes"
              value={flareNodes.length}
              description="Indexed test-run summaries"
            />
            <DataCard
              title="Observed failures"
              value={flareNodes.reduce<number>(
                (sum, item) =>
                  sum + Number((record(item).attrs && record(record(item).attrs).failed) || 0),
                0,
              )}
              description="From supplied summaries only"
            />
          </div>
          {flareEvidence.length ? (
            <div className="space-y-2">
              {flareEvidence.slice(0, 40).map((item, index) => {
                const value = record(item);
                return (
                  <article
                    key={label(value.id) === 'Not recorded' ? index : label(value.id)}
                    className="rounded-lg border border-edge bg-void/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm text-ink">{label(value.source)}</p>
                      <StatusPill value={evidenceStatus(item)} />
                    </div>
                    <p className="mt-2 text-xs text-mute">
                      Commit {label(value.commitSha)} · {label(value.sourceType)}
                    </p>
                    <p className="mt-2 break-all font-mono text-[10px] text-mute">
                      SHA-256 {evidenceHash(item)}
                    </p>
                  </article>
                );
              })}
              <p className="text-xs text-mute">
                A single test report cannot establish flakiness. Historical, repeated observations
                and sample-size gates are required.
              </p>
            </div>
          ) : (
            <EmptyState
              title="No test history supplied"
              detail="Ingest JUnit, pytest, Jest or Go test reports. FLARE will not label tests flaky from a single run."
            />
          )}
        </div>
      ) : null}

      {active === 'capsule' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DataCard
              title="Environment evidence"
              value={capsuleEvidence.length}
              description="Supplied manifest snapshots"
            />
            <DataCard
              title="Environment nodes"
              value={capsuleNodes.length}
              description="Stored environment fingerprints"
            />
          </div>
          {capsuleEvidence.length ? (
            <div className="space-y-2">
              {capsuleEvidence.slice(0, 40).map((item, index) => {
                const value = record(item);
                return (
                  <article
                    key={label(value.id) === 'Not recorded' ? index : label(value.id)}
                    className="rounded-lg border border-edge bg-void/40 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm text-ink">{label(value.source)}</p>
                      <StatusPill value={evidenceStatus(item)} />
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] text-mute">
                      SHA-256 {evidenceHash(item)}
                    </p>
                    <p className="mt-2 text-xs text-mute">{label(value.limitation)}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Environment is NOT_MEASURED"
              detail="No environment evidence has been ingested. Manifest fingerprints describe supplied configuration, not the complete host operating system or installed dependency tree."
            />
          )}
        </div>
      ) : null}

      {active === 'flight' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <DataCard
              title="Telemetry sessions"
              value={flightNodes.length}
              description="Stored graph sessions"
            />
            <DataCard
              title="Recorded evidence"
              value={flightEvidence.length}
              description="File/API ingestion only"
            />
            <DataCard
              title="DEMO sessions"
              value={flightNodes.filter((item) => record(record(item).attrs).demo === true).length}
              description="Synthetic data, not physical capture"
            />
          </div>
          {flightNodes.length ? (
            <div className="space-y-2">
              {flightNodes.slice(0, 40).map((item, index) => {
                const value = record(item);
                const attrs = record(value.attrs);
                const demo = attrs.demo === true;
                return (
                  <article
                    key={label(value.id) === 'Not recorded' ? index : label(value.id)}
                    className="rounded-lg border border-edge bg-void/40 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-all font-mono text-sm text-ink">{nodeKey(item)}</p>
                      <StatusPill value={demo ? 'DEMO' : 'RECORDED'} />
                    </div>
                    <p className="mt-2 text-xs text-mute">
                      {label(attrs.format)} · {label(attrs.records)} records · Device{' '}
                      {label(attrs.deviceLabel)}
                    </p>
                    <p className="mt-1 text-xs text-mute">
                      Firmware {label(attrs.firmwareBuildId)}
                    </p>
                  </article>
                );
              })}
              <p className="text-xs text-mute">
                These are recorded-file summaries. The current implementation does not open serial
                ports, issue device commands or prove live hardware behavior.
              </p>
            </div>
          ) : (
            <EmptyState
              title="No recorded sessions"
              detail="Import a bounded JSON, NDJSON, CSV or key-value telemetry file. Synthetic ESP32/STM32 fixtures must remain labelled DEMO."
            />
          )}
        </div>
      ) : null}

      {active === 'passports' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            {passports.length ? (
              passports.slice(0, 100).map((item, index) => {
                const value = record(item);
                const id = label(value.id ?? value.key);
                return (
                  <button
                    key={id === 'Not recorded' ? index : id}
                    type="button"
                    onClick={() => {
                      setSelectedId(id);
                      setPassportHistory(null);
                      setPassportComparison(null);
                      setPassportActionError('');
                      setComparisonTargetId('');
                    }}
                    aria-pressed={selectedId === id}
                    className={
                      'w-full rounded-lg border p-3 text-left ' +
                      (selectedId === id ? 'border-cyan bg-cyan/5' : 'border-edge bg-void/40')
                    }
                  >
                    <p className="break-all font-mono text-sm text-ink">
                      {label(value.key ?? value.id)}
                    </p>
                    <p className="mt-1 text-xs text-mute">
                      Version {label(value.version)} · Commit {label(value.validFromCommit)}
                    </p>
                  </button>
                );
              })
            ) : (
              <EmptyState
                title="No Change Passports"
                detail="Create a commit-scoped passport using the local CLI or authenticated API. Missing evidence must remain explicit."
              />
            )}
          </div>
          <aside className="rounded-lg border border-edge bg-void/40 p-4">
            <h4 className="font-mono text-xs uppercase tracking-wider text-mute">
              Selected passport
            </h4>
            {selectedPassport ? (
              <>
                <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-xs text-ink">
                  {JSON.stringify(selectedPassport, null, 2)}
                </pre>
                <div className="mt-4 space-y-3 border-t border-edge pt-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!onLoadPassportHistory || passportActionLoading}
                      onClick={async () => {
                        setPassportActionLoading(true);
                        setPassportActionError('');
                        setPassportComparison(null);
                        try {
                          setPassportHistory(await onLoadPassportHistory?.(selectedId));
                        } catch (cause) {
                          setPassportActionError(
                            cause instanceof Error
                              ? cause.message
                              : 'Unable to load passport history.',
                          );
                        } finally {
                          setPassportActionLoading(false);
                        }
                      }}
                      className="rounded-md border border-edge px-3 py-2 text-xs text-ink hover:border-cyan disabled:opacity-40"
                    >
                      Load version history
                    </button>
                  </div>
                  <label className="block text-xs text-mute">
                    Compare selected passport with
                    <select
                      value={comparisonTargetId}
                      onChange={(event) => setComparisonTargetId(event.target.value)}
                      className="mt-2 block w-full rounded-md border border-edge bg-void px-3 py-2 text-xs text-ink"
                    >
                      <option value="">Choose another passport version</option>
                      {passports
                        .filter((item) => label(record(item).id ?? record(item).key) !== selectedId)
                        .map((item, index) => {
                          const value = record(item);
                          const id = label(value.id ?? value.key);
                          return (
                            <option key={id === 'Not recorded' ? index : id} value={id}>
                              {label(value.key ?? value.id)} · v{label(value.version)}
                            </option>
                          );
                        })}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!comparisonTargetId || !onComparePassports || passportActionLoading}
                    onClick={async () => {
                      setPassportActionLoading(true);
                      setPassportActionError('');
                      setPassportHistory(null);
                      try {
                        setPassportComparison(
                          await onComparePassports?.(selectedId, comparisonTargetId),
                        );
                      } catch (cause) {
                        setPassportActionError(
                          cause instanceof Error ? cause.message : 'Unable to compare passports.',
                        );
                      } finally {
                        setPassportActionLoading(false);
                      }
                    }}
                    className="rounded-md border border-cyan px-3 py-2 text-xs text-cyan hover:bg-cyan/10 disabled:opacity-40"
                  >
                    Compare selected versions
                  </button>
                  {passportActionLoading ? (
                    <p role="status" className="text-xs text-mute">
                      Loading passport data…
                    </p>
                  ) : null}
                  {passportActionError ? (
                    <p role="alert" className="text-xs text-bad">
                      {passportActionError}
                    </p>
                  ) : null}
                  {passportHistory !== null ? (
                    <div>
                      <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                        Version history
                      </h5>
                      {Array.isArray(passportHistory) && passportHistory.length ? (
                        <ol className="mt-3 space-y-3 border-l border-edge pl-4">
                          {passportHistory.map((entry, index) => {
                            const version = record(entry);
                            return (
                              <li
                                key={
                                  label(version.version) === 'Not recorded'
                                    ? index
                                    : label(version.version)
                                }
                              >
                                <div className="rounded-md border border-edge bg-void p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-mono text-sm text-ink">
                                      Version {label(version.version)}
                                    </p>
                                    <StatusPill
                                      value={label(version.verificationStatus).toUpperCase()}
                                    />
                                  </div>
                                  <p className="mt-1 text-xs text-mute">
                                    {label(version.recordedAt)}
                                  </p>
                                  <p className="mt-2 break-all font-mono text-[10px] text-mute">
                                    Commit {label(version.commitSha)}
                                  </p>
                                  <p className="mt-1 break-all font-mono text-[10px] text-mute">
                                    SHA-256 {label(version.contentSha256)}
                                  </p>
                                  <p className="mt-2 text-xs text-mute">
                                    State: {label(version.state)}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="mt-2 text-xs text-mute">No version history was returned.</p>
                      )}
                    </div>
                  ) : null}
                  {passportComparison !== null ? (
                    <div>
                      {(() => {
                        const comparison = record(passportComparison);
                        const changedFiles = record(comparison.changedFiles);
                        const changedFindings = record(comparison.changedFindings);
                        const sections = [
                          ['Added evidence', stringItems(comparison.addedEvidenceIds)],
                          ['Removed evidence', stringItems(comparison.removedEvidenceIds)],
                          ['Added files', stringItems(changedFiles.added)],
                          ['Removed files', stringItems(changedFiles.removed)],
                          ['Added findings', stringItems(changedFindings.added)],
                          ['Removed findings', stringItems(changedFindings.removed)],
                        ] as const;
                        const completeness = Array.isArray(comparison.completenessChanges)
                          ? comparison.completenessChanges
                          : [];
                        return (
                          <>
                            <h5 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                              Version comparison
                            </h5>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <DataCard
                                title="Before"
                                value={label(comparison.beforeStatus)}
                                description="Verification status"
                              />
                              <DataCard
                                title="After"
                                value={label(comparison.afterStatus)}
                                description="Verification status"
                              />
                            </div>
                            <div className="mt-3 space-y-3">
                              {sections.map(([title, values]) => (
                                <section
                                  key={title}
                                  className="rounded-md border border-edge bg-void p-3"
                                >
                                  <h6 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                                    {title} · {values.length}
                                  </h6>
                                  {values.length ? (
                                    <ul className="mt-2 space-y-1">
                                      {values.map((value) => (
                                        <li
                                          key={value}
                                          className="break-all font-mono text-xs text-ink"
                                        >
                                          {value}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-1 text-xs text-mute">No changes reported.</p>
                                  )}
                                </section>
                              ))}
                              <section className="rounded-md border border-edge bg-void p-3">
                                <h6 className="font-mono text-[10px] uppercase tracking-wider text-mute">
                                  Completeness changes · {completeness.length}
                                </h6>
                                {completeness.length ? (
                                  <ul className="mt-2 space-y-2">
                                    {completeness.map((entry, index) => {
                                      const change = record(entry);
                                      return (
                                        <li
                                          key={label(change.dimension) + index}
                                          className="text-xs text-ink"
                                        >
                                          {label(change.dimension)}: {label(change.before)} →{' '}
                                          {label(change.after)}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : (
                                  <p className="mt-1 text-xs text-mute">
                                    No completeness changes reported.
                                  </p>
                                )}
                              </section>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-mute">
                Select a passport to inspect its stored, commit-scoped fields.
              </p>
            )}
          </aside>
        </div>
      ) : null}

      {active === 'replay' ? (
        <div className="space-y-4">
          <EmptyState
            title="Replay Room · non-executing view"
            detail="The backend can create and compare Change Passport records and produce a non-executing reproduction plan. This dashboard view exposes the stored plan only when the selected passport contains one; it never runs commands, builds, tests or device actions."
          />
          {passports.filter((item) => record(record(item).attrs).reproductionPlan !== undefined)
            .length ? (
            passports
              .filter((item) => record(record(item).attrs).reproductionPlan !== undefined)
              .map((item, index) => (
                <article
                  key={label(record(item).id) === 'Not recorded' ? index : label(record(item).id)}
                  className="rounded-lg border border-edge bg-void/40 p-3"
                >
                  <p className="break-all font-mono text-sm text-ink">{nodeKey(item)}</p>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs text-mute">
                    {JSON.stringify(record(record(item).attrs).reproductionPlan, null, 2)}
                  </pre>
                </article>
              ))
          ) : (
            <EmptyState
              title="No stored reproduction plan in this page"
              detail="Generate a plan with the local ORBIT Passport CLI/API. A missing plan is not reconstructed or guessed by the UI."
            />
          )}
        </div>
      ) : null}

      {active === 'integrations' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <article className="rounded-lg border border-edge bg-void/40 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-cyan">
              MCP · available in main
            </p>
            <h4 className="mt-2 font-semibold text-ink">12 read-only stdio tools</h4>
            <p className="mt-2 text-sm leading-6 text-mute">
              MCP reads the already indexed local database. It cannot write graph facts, execute a
              shell command, fetch remote content or control hardware.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-edge bg-void p-3 text-xs text-ink">
              node apps/cli/dist/index.js mcp start --db .orbit/orbit.db --repo local/my-repository
            </pre>
            <p className="mt-2 text-xs text-mute">
              See docs/CLAUDE_CODE_MCP.md for Claude Code setup. Other clients still need
              compatibility testing.
            </p>
          </article>
          <article className="rounded-lg border border-edge bg-void/40 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-violet">
              ORBIT AI · experimental
            </p>
            <h4 className="mt-2 font-semibold text-ink">Explicit preview and approval</h4>
            <p className="mt-2 text-sm leading-6 text-mute">
              Provider adapters and hash-bound approval are being developed separately. AI stays
              disabled by default; external transmission requires a fresh preview and explicit user
              approval.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-mute">
              <li>Provider keys stay on the local API process.</li>
              <li>Redaction is best-effort, not a guarantee.</li>
              <li>AI output is advisory and is not verification evidence.</li>
              <li>No autonomous patch application or shell execution.</li>
            </ul>
          </article>
        </div>
      ) : null}
    </section>
  );
}
