import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Cloud, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';

interface CloudWorkspaceRecord {
  id: string;
  name: string;
  workspaceKey: string;
  role: string;
  createdAt: string;
}

interface WorkspaceResponse {
  workspaces: CloudWorkspaceRecord[];
  nextCursor: string | null;
}

function readableError(status: number, payload: unknown): string {
  const value =
    payload && typeof payload === 'object' ? (payload as { message?: unknown }) : {};
  const message = typeof value.message === 'string' ? value.message : '';

  if (status === 401) {
    return (
      'Cloud identity could not be verified. Refresh your Cloudflare Access session and try again.'
    );
  }
  if (status === 403) return 'Your account is not allowed to access this workspace.';
  if (status === 409) return 'A workspace with this name already exists in your account.';
  return message || 'Cloud workspace request failed (HTTP ' + status + ').';
}

export function CloudWorkspace() {
  const [workspaces, setWorkspaces] = useState<CloudWorkspaceRecord[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);

      const response = await fetch('/api/cloud/v1/workspaces?' + query.toString(), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readableError(response.status, payload));

      const result = payload as WorkspaceResponse;
      if (!Array.isArray(result.workspaces)) {
        throw new Error('Cloud API returned an unexpected workspace response.');
      }
      if (!signal?.aborted) {
        setWorkspaces((current) =>
          append ? [...current, ...result.workspaces] : result.workspaces,
        );
        setNextCursor(result.nextCursor);
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(
          cause instanceof Error ? cause.message : 'Cloud workspace could not be loaded.',
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setError('Workspace name must be between 2 and 80 characters.');
      return;
    }

    setCreating(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/cloud/v1/workspaces', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ name: cleanName }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readableError(response.status, payload));

      const created = (payload as { workspace: CloudWorkspaceRecord }).workspace;
      setWorkspaces((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setName('');
      setNotice('“' + created.name + '” is ready in your private cloud workspace.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace could not be created.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="cloud-workspace-title">
      <div className="overflow-hidden rounded-xl border border-edge bg-panel">
        <div
          className="flex flex-col gap-5 border-b border-edge p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8"
        >
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan">
              ORBIT · SECURE CLOUD
            </p>
            <h2
              id="cloud-workspace-title"
              className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
            >
              Your work, connected.
            </h2>
            <p className="mt-2 text-sm leading-6 text-mute">
              Create and manage private workspaces using Cloudflare Access identity and
              tenant-scoped storage.
            </p>
          </div>
          <div
            className="flex shrink-0 items-center gap-3 rounded-lg border border-ok/25 bg-ok/5 px-4 py-3"
          >
            <ShieldCheck size={19} className="text-ok" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-ink">Identity protected</p>
              <p className="text-[11px] text-mute">Cloudflare Access · D1</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-3 lg:p-8">
          <div className="rounded-lg border border-edge bg-void p-4">
            <Cloud size={18} className="text-cyan" aria-hidden="true" />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-mute">
              Cloud service
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">ORBIT Cloud API</p>
            <p className="mt-1 text-xs text-mute">Authenticated edge runtime</p>
          </div>
          <div className="rounded-lg border border-edge bg-void p-4">
            <Users size={18} className="text-cyan" aria-hidden="true" />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-mute">
              Your workspaces
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {loading ? '—' : workspaces.length}
            </p>
            <p className="mt-1 text-xs text-mute">Visible to your authenticated identity</p>
          </div>
          <div className="rounded-lg border border-edge bg-void p-4">
            <ShieldCheck size={18} className="text-cyan" aria-hidden="true" />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-mute">
              Data boundary
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">Tenant scoped</p>
            <p className="mt-1 text-xs text-mute">Membership-filtered database reads</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form
          onSubmit={createWorkspace}
          className="h-fit rounded-xl border border-edge bg-panel p-5 sm:p-6"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan">
            New workspace
          </p>
          <h3 className="mt-2 text-lg font-semibold text-ink">Start a workspace</h3>
          <p className="mt-1 text-sm leading-6 text-mute">
            A private workspace is created for your signed-in identity.
          </p>
          <label className="mt-5 block">
            <span className="text-xs font-medium text-ink">Workspace name</span>
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={80}
              minLength={2}
              required
              placeholder="e.g. Product Engineering"
              className="mt-2 w-full rounded-md border border-edge bg-void px-3 py-3 text-sm text-ink outline-none transition placeholder:text-mute focus:border-cyan focus:ring-1 focus:ring-cyan"
            />
          </label>
          <button
            type="submit"
            disabled={creating || name.trim().length < 2}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan px-4 py-3 text-sm font-semibold text-void transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} aria-hidden="true" />
            {creating ? 'Creating workspace…' : 'Create private workspace'}
          </button>
          <p className="mt-3 text-xs leading-5 text-mute">
            Names are limited to 80 characters. Workspace keys are generated by ORBIT.
          </p>
        </form>

        <section
          className="rounded-xl border border-edge bg-panel p-5 sm:p-6"
          aria-labelledby="workspace-list-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan">
                Your account
              </p>
              <h3 id="workspace-list-title" className="mt-2 text-lg font-semibold text-ink">
                Private workspaces
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh cloud workspaces"
              className="inline-flex items-center gap-2 rounded-md border border-edge px-3 py-2 text-xs font-medium text-ink transition hover:border-cyan disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                className={loading ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-md border border-warn/30 bg-warn/5 p-3 text-sm text-warn"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mt-5 rounded-md border border-ok/30 bg-ok/5 p-3 text-sm text-ok"
            >
              {notice}
            </p>
          )}

          {loading ? (
            <div
              className="mt-5 rounded-lg border border-dashed border-edge p-8 text-center text-sm text-mute"
            >
              Loading your private workspaces…
            </div>
          ) : workspaces.length === 0 && !error ? (
            <div className="mt-5 rounded-lg border border-dashed border-edge p-8 text-center">
              <Cloud size={24} className="mx-auto text-mute" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-ink">No cloud workspaces yet</p>
              <p className="mt-1 text-xs text-mute">
                Create your first private workspace to get started.
              </p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {workspaces.map((workspace) => (
                <li
                  key={workspace.id}
                  className="flex flex-col gap-3 rounded-lg border border-edge bg-void p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{workspace.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-mute">
                      {workspace.workspaceKey}
                    </p>
                    <p className="mt-2 text-[11px] text-mute">
                      Created{' '}
                      {workspace.createdAt
                        ? new Date(workspace.createdAt).toLocaleDateString()
                        : 'just now'}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-ok/25 bg-ok/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ok">
                    {workspace.role}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {nextCursor && !loading && (
            <button
              type="button"
              onClick={() => void load(undefined, nextCursor, true)}
              disabled={loadingMore}
              className="mt-4 w-full rounded-md border border-edge px-4 py-3 text-xs font-medium text-ink transition hover:border-cyan disabled:opacity-50"
            >
              {loadingMore ? 'Loading more…' : 'Load more workspaces'}
            </button>
          )}
          <p className="mt-5 border-t border-edge pt-4 text-[11px] leading-5 text-mute">
            Cloud workspace identity and membership are available now. Repository scanning, graph,
            evidence, ATLAS and FLARE still run through the local ORBIT runtime.
          </p>
        </section>
      </div>
    </section>
  );
}
