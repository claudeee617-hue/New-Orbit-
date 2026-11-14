import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Command, FileCheck2, GitBranch, ShieldCheck } from 'lucide-react';
import { ORBIT_TAGLINE } from '@orbit/shared/health';
import { BusinessModule } from './BusinessModule.js';
import { BusinessOperations } from './BusinessOperations.js';
import { CommandCenter } from './CommandCenter.js';
import { loadHealth, type HealthState } from './health.js';

type WorkspaceView = 'overview' | 'business';
type IconName = 'overview' | 'business' | 'scan' | 'evidence' | 'passport';

const glyphs: Record<IconName, typeof Command> = {
  overview: Command,
  business: Building2,
  scan: GitBranch,
  evidence: FileCheck2,
  passport: ShieldCheck,
};

function Glyph({ name }: { name: IconName }) {
  const Icon = glyphs[name];
  return <Icon aria-hidden="true" size={17} strokeWidth={1.65} />;
}

function StatusBadge({ state }: { state: HealthState }) {
  const styles: Record<HealthState['kind'], { label: string; dot: string; text: string }> = {
    loading: { label: 'CHECKING', dot: 'is-loading', text: 'is-loading' },
    connected: { label: 'API CONNECTED', dot: 'is-connected', text: 'is-connected' },
    degraded: { label: 'API DEGRADED', dot: 'is-degraded', text: 'is-degraded' },
    disconnected: { label: 'API OFFLINE', dot: 'is-disconnected', text: 'is-disconnected' },
  };
  const style = styles[state.kind];
  return (
    <span className={`orbit-status ${style.text}`}>
      <i className={`orbit-status-dot ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}

function ApiDetails({ state }: { state: HealthState }) {
  if (state.kind === 'loading')
    return <p className="orbit-api-copy">Contacting the local API and workspace database…</p>;
  if (state.kind === 'disconnected') {
    return (
      <div className="orbit-api-copy">
        <p>{state.reason}</p>
        <p>
          Start the local stack from the repository root with <code>pnpm dev</code>.
        </p>
      </div>
    );
  }
  const { health } = state;
  return (
    <dl className="orbit-api-details">
      <div>
        <dt>Service</dt>
        <dd>{health.service}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{health.version}</dd>
      </div>
      <div>
        <dt>Database</dt>
        <dd>{health.database.connected ? 'Connected' : 'Unreachable'}</dd>
      </div>
      <div>
        <dt>Schema</dt>
        <dd>{health.database.schemaVersion ?? 'Unknown'}</dd>
      </div>
    </dl>
  );
}

const navigation: { id: WorkspaceView; label: string; description: string; icon: IconName }[] = [
  {
    id: 'overview',
    label: 'Command Center',
    description: 'Engineering overview',
    icon: 'overview',
  },
  {
    id: 'business',
    label: 'Business Workspace',
    description: 'Plan and operate',
    icon: 'business',
  },
];

export function App() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  const [view, setView] = useState<WorkspaceView>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavSidebarRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    setState({ kind: 'loading' });
    const controller = new AbortController();
    void loadHealth(fetch, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const mobileLayout = window.matchMedia('(max-width: 820px)');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusableElements = () =>
      Array.from(
        mobileNavSidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0,
      );

    getFocusableElements()[0]?.focus();

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !mobileNavSidebarRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !mobileNavSidebarRef.current?.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    const closeWhenDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileNavOpen(false);
    };

    window.addEventListener('keydown', handleDrawerKeyDown);
    mobileLayout.addEventListener('change', closeWhenDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleDrawerKeyDown);
      mobileLayout.removeEventListener('change', closeWhenDesktop);
      if (mobileLayout.matches) mobileNavTriggerRef.current?.focus();
    };
  }, [mobileNavOpen]);

  const chooseView = (next: WorkspaceView) => {
    setView(next);
    setMobileNavOpen(false);
  };

  return (
    <div className={`orbit-app ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      {mobileNavOpen && (
        <button
          className="orbit-mobile-scrim"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        id="orbit-mobile-navigation"
        ref={mobileNavSidebarRef}
        className={`orbit-sidebar ${mobileNavOpen ? 'is-open' : ''}`}
        role={mobileNavOpen ? 'dialog' : undefined}
        aria-modal={mobileNavOpen ? true : undefined}
        aria-label={mobileNavOpen ? 'Workspace navigation' : 'Main workspace navigation'}
      >
        <div className="orbit-brand-row">
          <div className="orbit-brand-mark" aria-hidden="true">
            <span />
          </div>
          <div className="orbit-brand-copy">
            <strong>ORBIT</strong>
            <span>ENGINEERING INTELLIGENCE</span>
          </div>
          <button
            className="orbit-collapse"
            type="button"
            onClick={() => {
              if (mobileNavOpen) {
                setMobileNavOpen(false);
              } else {
                setSidebarCollapsed((value) => !value);
              }
            }}
            aria-label={
              mobileNavOpen
                ? 'Close navigation'
                : sidebarCollapsed
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
            }
            title={
              mobileNavOpen
                ? 'Close navigation'
                : sidebarCollapsed
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
            }
          >
            <span>{mobileNavOpen ? '×' : sidebarCollapsed ? '›' : '‹'}</span>
          </button>
        </div>

        <div className="orbit-workspace-switcher">
          <span className="orbit-workspace-icon">N</span>
          <span className="orbit-workspace-name">
            <strong>New-Orbit</strong>
            <small>Local workspace</small>
          </span>
          <span className="orbit-workspace-chevron">⌄</span>
        </div>

        <div className="orbit-nav-label">WORKSPACE</div>
        <nav className="orbit-nav">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`orbit-nav-item ${view === item.id ? 'is-active' : ''}`}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => chooseView(item.id)}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="orbit-nav-icon">
                <Glyph name={item.icon} />
              </span>
              <span className="orbit-nav-text">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              {view === item.id && <span className="orbit-nav-active" />}
            </button>
          ))}
        </nav>

        <div className="orbit-nav-label orbit-engines-label">INTELLIGENCE ENGINES</div>
        <div className="orbit-engine-list">
          <div className="orbit-engine-item">
            <span className="orbit-engine-icon">
              <Glyph name="scan" />
            </span>
            <span>
              <strong>ATLAS</strong>
              <small>Repository intelligence</small>
            </span>
            <i />
          </div>
          <div className="orbit-engine-item">
            <span className="orbit-engine-icon">
              <Glyph name="evidence" />
            </span>
            <span>
              <strong>WITNESS · FLARE</strong>
              <small>Evidence and test analysis</small>
            </span>
            <i />
          </div>
          <div className="orbit-engine-item">
            <span className="orbit-engine-icon">
              <Glyph name="passport" />
            </span>
            <span>
              <strong>CHANGE PASSPORT</strong>
              <small>Traceable verification</small>
            </span>
            <i />
          </div>
        </div>

        <div className="orbit-sidebar-bottom">
          <div className="orbit-local-card">
            <div className="orbit-local-card-top">
              <span className="orbit-local-lock">⌑</span>
              <span>LOCAL-FIRST BY DESIGN</span>
            </div>
            <p>Your source, evidence and device records stay in your configured local workspace.</p>
            <span className="orbit-local-chip">NO TELEMETRY BY DEFAULT</span>
          </div>
          <div className="orbit-sidebar-user">
            <span className="orbit-avatar">O</span>
            <span>
              <strong>ORBIT Workspace</strong>
              <small>Private local environment</small>
            </span>
            <span className="orbit-user-menu">···</span>
          </div>
        </div>
      </aside>

      <div className="orbit-main" inert={mobileNavOpen}>
        <header className="orbit-topbar">
          <div className="orbit-topbar-left">
            <button
              ref={mobileNavTriggerRef}
              className="orbit-mobile-menu"
              type="button"
              aria-label="Open navigation"
              aria-controls="orbit-mobile-navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="orbit-breadcrumb">
              <span>Workspace</span>
              <b>/</b>
              <strong>{view === 'overview' ? 'Command Center' : 'Business Workspace'}</strong>
            </div>
          </div>
          <div className="orbit-topbar-actions">
            <span className="orbit-topbar-environment">
              <i /> LOCAL ENVIRONMENT
            </span>
            <StatusBadge state={state} />
            <button
              className="orbit-refresh"
              type="button"
              onClick={refresh}
              disabled={state.kind === 'loading'}
            >
              <span>↻</span>
              <span>Refresh status</span>
            </button>
          </div>
        </header>

        <main className="orbit-content">
          {view === 'overview' ? (
            <>
              <section className="orbit-hero">
                <div>
                  <div className="orbit-eyebrow">
                    <span /> ENGINEERING INTELLIGENCE PLATFORM <b>·</b> PRIVATE WORKSPACE
                  </div>
                  <h1>
                    Understand everything.
                    <br />
                    <em>Prove what works.</em>
                  </h1>
                  <p>
                    {ORBIT_TAGLINE} Your repository, evidence and engineering workflows—connected in
                    one place.
                  </p>
                  <div className="orbit-hero-actions">
                    <button
                      type="button"
                      className="orbit-primary-action"
                      onClick={() =>
                        document
                          .getElementById('orbit-command-center')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                    >
                      Open command center <span>↘</span>
                    </button>
                    <button
                      type="button"
                      className="orbit-secondary-action"
                      onClick={() => chooseView('business')}
                    >
                      Business workspace <span>↗</span>
                    </button>
                  </div>
                </div>
                <div className="orbit-hero-orbit" aria-hidden="true">
                  <div className="orbit-orbit-ring orbit-ring-one" />
                  <div className="orbit-orbit-ring orbit-ring-two" />
                  <div className="orbit-orbit-core">
                    <span>O</span>
                  </div>
                  <div className="orbit-orbit-dot orbit-dot-one" />
                  <div className="orbit-orbit-dot orbit-dot-two" />
                </div>
              </section>

              <section className="orbit-module-strip" aria-label="ORBIT platform engines">
                <article>
                  <span className="orbit-module-number">01</span>
                  <div>
                    <strong>MAP</strong>
                    <small>ATLAS · repository graph</small>
                  </div>
                  <span className="orbit-module-arrow">↗</span>
                </article>
                <article>
                  <span className="orbit-module-number">02</span>
                  <div>
                    <strong>VERIFY</strong>
                    <small>WITNESS · evidence</small>
                  </div>
                  <span className="orbit-module-arrow">↗</span>
                </article>
                <article>
                  <span className="orbit-module-number">03</span>
                  <div>
                    <strong>ANALYSE</strong>
                    <small>FLARE · tests and history</small>
                  </div>
                  <span className="orbit-module-arrow">↗</span>
                </article>
                <article>
                  <span className="orbit-module-number">04</span>
                  <div>
                    <strong>TRACE</strong>
                    <small>Change Passport · provenance</small>
                  </div>
                  <span className="orbit-module-arrow">↗</span>
                </article>
              </section>

              <section className="orbit-api-panel">
                <div className="orbit-api-panel-heading">
                  <div>
                    <span className="orbit-section-kicker">WORKSPACE CONNECTION</span>
                    <h2>Local runtime</h2>
                    <p>Live connection state from your ORBIT API.</p>
                  </div>
                  <StatusBadge state={state} />
                </div>
                <div className="orbit-api-panel-body">
                  <ApiDetails state={state} />
                  <div className="orbit-api-endpoint">
                    <span>API ENDPOINT</span>
                    <code>127.0.0.1:4317</code>
                    <small>Loopback only</small>
                  </div>
                </div>
              </section>

              <section id="orbit-command-center" className="orbit-command-area">
                <div className="orbit-section-heading">
                  <div>
                    <span className="orbit-section-kicker">LIVE ENGINEERING DATA</span>
                    <h2>Command Center</h2>
                    <p>Explore repository maps, evidence records, integrity and change history.</p>
                  </div>
                  <span className="orbit-section-badge">REAL API DATA · NO DEMO METRICS</span>
                </div>
                <CommandCenter />
              </section>
            </>
          ) : (
            <>
              <section className="orbit-business-heading">
                <div className="orbit-eyebrow">
                  <span /> OPERATE WITH CLARITY
                </div>
                <h1>
                  Business <em>workspace.</em>
                </h1>
                <p>
                  Market, opportunity and operations planning—kept separate from engineering
                  evidence.
                </p>
              </section>
              <BusinessModule />
              <div className="orbit-business-operations">
                <BusinessOperations />
              </div>
            </>
          )}
          <footer className="orbit-footer">
            <span>
              <b>ORBIT</b> · ENGINEERING INTELLIGENCE
            </span>
            <span>
              LOCAL-FIRST <i /> EVIDENCE-DRIVEN <i /> TRANSPARENT BY DESIGN
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
