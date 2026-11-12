import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BUSINESS_WORKSPACE_STORAGE_KEY,
  calculateBusinessPipelineSummary,
  emptyBusinessWorkspace,
  getLocalDateKey,
  OPPORTUNITY_SEGMENTS,
  OPPORTUNITY_SEGMENT_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  parseBusinessWorkspace,
  serialiseBusinessWorkspace,
  type BusinessOpportunity,
  type BusinessWorkspace,
  type OpportunitySegment,
  type OpportunityStage,
} from './business/operations.js';

function loadLocalWorkspace(): BusinessWorkspace {
  try {
    const saved = window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY);
    return saved ? parseBusinessWorkspace(saved) : emptyBusinessWorkspace();
  } catch {
    return emptyBusinessWorkspace();
  }
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-lg border border-edge bg-void p-4">
      <p className="text-xs text-mute">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-mute">{detail}</p>
    </article>
  );
}

const EMPTY_FORM = {
  account: '',
  segment: 'product-engineering' as OpportunitySegment,
  stage: 'discovery' as OpportunityStage,
  estimatedMonthlyValue: '',
  nextAction: '',
  dueDate: '',
  evidence: '',
};

function money(value: number, currency: 'INR' | 'USD'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function BusinessOperations() {
  const [workspace, setWorkspace] = useState<BusinessWorkspace>(emptyBusinessWorkspace);
  const [loaded, setLoaded] = useState(false);
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [form, setForm] = useState(EMPTY_FORM);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all' | OpportunityStage>('open');
  const [editingId, setEditingId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY);
      if (saved) setWorkspace(parseBusinessWorkspace(saved));
    } catch {
      setError('Saved workspace could not be read. It has not been overwritten; import a valid backup or clear the browser storage manually.');
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(
        BUSINESS_WORKSPACE_STORAGE_KEY,
        serialiseBusinessWorkspace(workspace),
      );
      setNotice('Saved in this browser');
    } catch {
      setError('Browser storage is unavailable or full. Export a JSON backup before leaving this page.');
    }
  }, [loaded, workspace]);

  const summary = calculateBusinessPipelineSummary(workspace);
  const visible = workspace.opportunities.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'open') return item.stage !== 'won' && item.stage !== 'lost';
    return item.stage === filter;
  }).sort((a, b) => {
    if (!a.dueDate) return b.dueDate ? 1 : a.account.localeCompare(b.account);
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function submitOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const amount = Number(form.estimatedMonthlyValue || 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
      setError('Enter a valid non-negative monthly value estimate.');
      return;
    }

    const opportunity: BusinessOpportunity = {
      id: editingId ?? `opp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      account: form.account.trim(),
      segment: form.segment,
      stage: form.stage,
      estimatedMonthlyValue: amount,
      nextAction: form.nextAction.trim(),
      dueDate: form.dueDate,
      evidence: form.evidence.trim(),
    };

    setWorkspace((current) => ({
      ...current,
      opportunities: editingId
        ? current.opportunities.map((item) => (item.id === editingId ? opportunity : item))
        : [...current.opportunities, opportunity],
    }));
    setNotice(editingId ? 'Opportunity updated' : 'Opportunity added');
    resetForm();
  }

  function editOpportunity(item: BusinessOpportunity) {
    setEditingId(item.id);
    setForm({
      account: item.account,
      segment: item.segment,
      stage: item.stage,
      estimatedMonthlyValue: String(item.estimatedMonthlyValue),
      nextAction: item.nextAction,
      dueDate: item.dueDate,
      evidence: item.evidence,
    });
    setError('');
  }

  function deleteOpportunity(id: string) {
    setWorkspace((current) => ({
      ...current,
      opportunities: current.opportunities.filter((item) => item.id !== id),
    }));
    if (editingId === id) resetForm();
    setNotice('Opportunity deleted from this browser');
  }

  function exportBackup() {
    try {
      const blob = new Blob([serialiseBusinessWorkspace(workspace)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `orbit-business-workspace-${getLocalDateKey()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('JSON backup exported');
      setError('');
    } catch {
      setError('Backup could not be exported in this browser.');
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const restored = parseBusinessWorkspace(await file.text());
      setWorkspace(restored);
      resetForm();
      setFilter('open');
      setNotice(`Imported ${restored.opportunities.length} opportunities`);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup could not be imported.');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-edge bg-panel p-5" aria-labelledby="operations-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">Prompt 5 · Local operations</p>
          <h2 id="operations-heading" className="mt-1 text-xl font-semibold text-ink">Business operations workspace</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-mute">
            Track discovery, qualified conversations and pilots with evidence and a next action.
            Estimates are planning inputs—not booked revenue or verified customer records.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportBackup} className="rounded-md border border-edge px-3 py-2 text-xs text-ink hover:border-cyan hover:text-cyan">Export JSON</button>
          <button type="button" onClick={() => importRef.current?.click()} className="rounded-md border border-edge px-3 py-2 text-xs text-ink hover:border-cyan hover:text-cyan">Import JSON</button>
          <input ref={importRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import business workspace JSON" onChange={(event) => void importBackup(event.target.files?.[0])} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Open conversations" value={String(summary.activeAccounts)} detail="Discovery, qualified and pilot" />
        <MetricTile label="Qualified" value={String(summary.qualifiedAccounts)} detail="Qualified and pilot stages" />
        <MetricTile label="Active pilots" value={String(summary.pilotAccounts)} detail="Pilot stage only" />
        <MetricTile label="Follow-ups due" value={String(summary.dueFollowUps)} detail="Due today or earlier" />
        <MetricTile label="Open pipeline estimate" value={money(summary.openPipelineEstimate, currency)} detail="Monthly estimate; not recognised revenue" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-edge py-3">
        <p className="text-xs text-mute">Records stay in this browser's local storage. No sync or CRM connection.</p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-mute" htmlFor="business-currency">Estimate currency</label>
          <select id="business-currency" value={currency} onChange={(event) => setCurrency(event.target.value as 'INR' | 'USD')} className="rounded-md border border-edge bg-void px-2 py-1.5 text-xs text-ink">
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
          <span role="status" className="text-[11px] text-ok">{loaded ? notice || 'Ready' : 'Loading…'}</span>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-xs leading-5 text-bad">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
        <form onSubmit={submitOpportunity} className="space-y-3 rounded-lg border border-edge bg-void p-4">
          <div>
            <h3 className="font-medium text-ink">{editingId ? 'Edit opportunity' : 'Add an opportunity'}</h3>
            <p className="mt-1 text-xs leading-5 text-mute">Use an organisation name or a non-identifying label. Do not store personal or payment details.</p>
          </div>
          <label className="block text-xs text-mute">Account / organisation
            <input required maxLength={120} value={form.account} onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-ink" placeholder="Example: Acme Engineering" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-mute">Segment
              <select value={form.segment} onChange={(event) => setForm((current) => ({ ...current, segment: event.target.value as OpportunitySegment }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-2 py-2 text-xs text-ink">
                {OPPORTUNITY_SEGMENTS.map((segment) => <option key={segment} value={segment}>{OPPORTUNITY_SEGMENT_LABELS[segment]}</option>)}
              </select>
            </label>
            <label className="block text-xs text-mute">Stage
              <select value={form.stage} onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value as OpportunityStage }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-2 py-2 text-xs text-ink">
                {OPPORTUNITY_STAGES.map((stage) => <option key={stage} value={stage}>{OPPORTUNITY_STAGE_LABELS[stage]}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-mute">Estimated monthly value
            <input type="number" min="0" max="1000000000000" step="0.01" value={form.estimatedMonthlyValue} onChange={(event) => setForm((current) => ({ ...current, estimatedMonthlyValue: event.target.value }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-ink" placeholder="0" />
          </label>
          <label className="block text-xs text-mute">Next action
            <input maxLength={180} value={form.nextAction} onChange={(event) => setForm((current) => ({ ...current, nextAction: event.target.value }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-ink" placeholder="Send a pilot outline" />
          </label>
          <label className="block text-xs text-mute">Follow-up date
            <input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-ink" />
          </label>
          <label className="block text-xs text-mute">Evidence / discovery note
            <textarea rows={3} maxLength={1000} value={form.evidence} onChange={(event) => setForm((current) => ({ ...current, evidence: event.target.value }))} className="mt-1 w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-ink" placeholder="Pain observed, workflow, buyer, pilot success criteria…" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-md border border-cyan bg-cyan/10 px-3 py-2 text-xs font-medium text-cyan hover:bg-cyan/20">{editingId ? 'Save changes' : 'Add opportunity'}</button>
            {editingId && <button type="button" onClick={resetForm} className="rounded-md border border-edge px-3 py-2 text-xs text-mute">Cancel edit</button>}
          </div>
        </form>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium text-ink">Pipeline</h3>
              <p className="mt-1 text-xs text-mute">{workspace.opportunities.length} locally recorded opportunities</p>
            </div>
            <label className="text-xs text-mute">Show
              <select value={filter} onChange={(event) => setFilter(event.target.value as 'open' | 'all' | OpportunityStage)} className="ml-2 rounded-md border border-edge bg-void px-2 py-1.5 text-xs text-ink">
                <option value="open">Open only</option>
                <option value="all">All stages</option>
                {OPPORTUNITY_STAGES.map((stage) => <option key={stage} value={stage}>{OPPORTUNITY_STAGE_LABELS[stage]}</option>)}
              </select>
            </label>
          </div>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge p-8 text-center">
              <p className="text-sm font-medium text-ink">No opportunities in this view</p>
              <p className="mt-2 text-xs leading-5 text-mute">Add a real discovery conversation or import a workspace backup. No sample customers are preloaded.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((item) => {
                const overdue = item.dueDate !== '' && item.dueDate <= getLocalDateKey() && item.stage !== 'won' && item.stage !== 'lost';
                return (
                  <article key={item.id} className="rounded-lg border border-edge bg-void p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-medium text-ink">{item.account}</h4>
                        <p className="mt-1 text-xs text-mute">{OPPORTUNITY_SEGMENT_LABELS[item.segment]} · {OPPORTUNITY_STAGE_LABELS[item.stage]}</p>
                      </div>
                      <p className="font-mono text-sm text-cyan">{money(item.estimatedMonthlyValue, currency)}<span className="text-[10px] text-mute"> / mo estimate</span></p>
                    </div>
                    {item.nextAction && <p className="mt-3 text-sm text-ink">Next: {item.nextAction}</p>}
                    {item.dueDate && <p className={`mt-1 text-xs ${overdue ? 'text-warn' : 'text-mute'}`}>{overdue ? 'Follow-up due: ' : 'Follow-up: '}{item.dueDate}</p>}
                    {item.evidence && <p className="mt-3 border-t border-edge pt-3 text-xs leading-5 text-mute">{item.evidence}</p>}
                    <div className="mt-3 flex gap-2 border-t border-edge pt-3">
                      <button type="button" onClick={() => editOpportunity(item)} className="text-xs text-cyan underline underline-offset-4">Edit</button>
                      <button type="button" onClick={() => deleteOpportunity(item.id)} className="text-xs text-bad underline underline-offset-4">Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-5 text-mute">Privacy boundary: this workspace is stored in browser-local storage on this device/profile. It is not encrypted by the app, not synchronised, and may be cleared by browser settings. Use JSON export for backup; never enter secrets, personal customer data, or card details.</p>
    </section>
  );
}
