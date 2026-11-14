import { AlertTriangle, ArrowUpRight, Database, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react';

const officialLinks = [
  { label: 'DPDP Act, 2023', href: 'https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf' },
  { label: 'DPDP Rules, 2025', href: 'https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf' },
  { label: 'Commencement notification G.S.R. 843(E)', href: 'https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf' },
  { label: 'IT (SPDI) Rules, 2011', href: 'https://meity.gov.in/sites/upload_files/dit/files/GSR313E_10511%281%29.pdf' },
];

function Row({ title, detail, status }: { title: string; detail: string; status: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-edge py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-mute">{detail}</p></div>
      <span className="w-fit shrink-0 rounded-full border border-edge px-2.5 py-1 font-mono text-[10px] text-mute">{status}</span>
    </div>
  );
}

export function PrivacyCenter() {
  return (
    <div className="space-y-6" aria-labelledby="privacy-center-title">
      <section className="overflow-hidden rounded-xl border border-edge bg-panel">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-8">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">ORBIT · PRIVACY & TRUST</p>
            <h2 id="privacy-center-title" className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your engineering data stays yours.</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-mute">ORBIT is built local-first. This page describes current product data flows and controls that are actually implemented. It is a transparency centre, not a certification or a claim of complete legal compliance.</p></div>
          <div className="rounded-lg border border-ok/25 bg-ok/5 p-4"><ShieldCheck size={20} className="text-ok" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-ink">Local-first by default</p>
            <p className="mt-1 text-xs leading-5 text-mute">Repository source, graph and evidence remain in the local runtime unless a user separately configures an integration.</p></div>
        </div>
        <div className="grid gap-px border-t border-edge bg-edge sm:grid-cols-3">
          <div className="bg-void/70 p-4"><Database size={17} className="text-cyan" aria-hidden="true" /><p className="mt-2 text-xs font-semibold text-ink">Local workspace</p><p className="mt-1 text-[11px] leading-5 text-mute">SQLite, source paths, graph and evidence</p></div>
          <div className="bg-void/70 p-4"><Fingerprint size={17} className="text-cyan" aria-hidden="true" /><p className="mt-2 text-xs font-semibold text-ink">Cloud identity</p><p className="mt-1 text-[11px] leading-5 text-mute">Cloudflare Access subject and account identity</p></div>
          <div className="bg-void/70 p-4"><LockKeyhole size={17} className="text-cyan" aria-hidden="true" /><p className="mt-2 text-xs font-semibold text-ink">Private cloud routes</p><p className="mt-1 text-[11px] leading-5 text-mute">Access-protected workspace endpoints</p></div>
        </div>
      </section>

      <section className="rounded-xl border border-edge bg-panel p-5 sm:p-6">
        <div className="flex items-start gap-3"><Database size={18} className="mt-0.5 text-cyan" aria-hidden="true" /><div><h3 className="text-sm font-semibold text-ink">What ORBIT processes today</h3><p className="mt-1 text-xs leading-5 text-mute">Data categories and purpose, separated by operating mode.</p></div></div>
        <Row title="Local engineering workspace" detail="Repository paths, symbol and dependency metadata, commit identifiers, test/CI summaries, environment declarations, evidence hashes and recorded telemetry summaries. Stored in the local SQLite workspace controlled by the operator." status="LOCAL" />
        <Row title="Local API credential" detail="The api.token file is generated beside the local database with restrictive permissions on supported Unix systems. The dashboard keeps the token in page memory and sends it only in the Authorization header to the same-origin local API proxy." status="LOCAL SECRET" />
        <Row title="Cloud workspace identity" detail="When a user signs in to the private Cloud Workspace, Cloudflare Access supplies a signed identity assertion. ORBIT Cloud stores the identity subject, email when provided, workspace name/key, membership role and creation timestamp in D1." status="CLOUD" />
        <Row title="Platform and security logs" detail="Cloudflare operates the edge, Pages, Access and Worker infrastructure. Its service logs, authentication cookies and operational processing are subject to Cloudflare's terms and privacy documentation." status="PROVIDER" />
        <Row title="Optional integrations and AI" detail="GitHub, MCP clients and any locally configured AI provider can create separate data flows. The public hosted dashboard does not provide the local engineering API. Do not send source or evidence to an external provider unless the exact data, destination and retention terms have been reviewed." status="OPT-IN / CONFIGURED" />
        <Row title="Business workspace" detail="Opportunity and planning records are stored in browser-local storage on the device/profile. They are not encrypted by ORBIT or synced to the cloud workspace." status="BROWSER-LOCAL" />
      </section>

      <section className="rounded-xl border border-edge bg-panel p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-ink">Controls currently implemented</h3>
        <Row title="Local-first processing" detail="No automatic source-code upload or ORBIT analytics/telemetry collection is intended by default." status="IMPLEMENTED BY DESIGN" />
        <Row title="Local token handling" detail="The UI does not save the local API token to browser storage or place it in a URL." status="IMPLEMENTED" />
        <Row title="Cloud access boundary" detail="The cloud workspace routes require Cloudflare Access identity; the Worker validates the signed assertion and scopes D1 reads to the authenticated subject." status="IMPLEMENTED" />
        <Row title="Bounded cloud requests" detail="The Pages bridge limits request size and query parameters, uses a private service binding and returns no-store responses." status="IMPLEMENTED" />
        <Row title="Optional analytics" detail="No advertising or behavioural analytics feature is configured in the current ORBIT application. Cloudflare Access may set cookies necessary for authentication and session security." status="CURRENT CONFIGURATION" />
      </section>

      <section className="rounded-xl border border-warn/30 bg-warn/5 p-5 sm:p-6">
        <div className="flex items-start gap-3"><AlertTriangle size={19} className="mt-0.5 text-warn" aria-hidden="true" /><div>
          <h3 className="text-sm font-semibold text-ink">Rights and support readiness</h3>
          <p className="mt-2 text-xs leading-6 text-mute">The current release does not yet provide an in-product personal-data access, correction, export or erasure workflow for cloud identity records. It also has no verified public privacy/grievance contact configured. Local SQLite workspace files remain under the local operator's control; Cloud Workspace records are held in the hosted D1 service.</p>
          <p className="mt-2 text-xs leading-6 text-mute">Until a real controller/business contact, request channel, retention schedule and documented deletion process are configured and tested, ORBIT should remain a private beta and should not invite external customers to submit personal or sensitive information.</p>
        </div></div>
      </section>

      <section className="rounded-xl border border-edge bg-panel p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-ink">India privacy-law readiness</h3>
        <p className="mt-1 text-xs leading-5 text-mute">Implementation timeline as at 14 November 2026. Commencement dates are taken from the notified Gazette instruments; legal applicability depends on the actual deployment, processing and user base.</p>
        <div className="mt-4 space-y-1">
          <Row title="13 November 2025 — initial commencement" detail="The initial Act provisions listed in G.S.R. 843(E), plus DPDP Rules 1, 2 and 17–21, commenced." status="IN FORCE" />
          <Row title="13 November 2026 — one-year tranche" detail="DPDP Act section 6(9), section 27(1)(d) and Rule 4 commenced. Rule 4 concerns registered Consent Managers; ORBIT is not represented as a registered Consent Manager." status="IN FORCE" />
          <Row title="13 May 2027 — main compliance tranche" detail="The bulk of Data Fiduciary duties and Data Principal rights in DPDP Act sections 3–17 and Rules 3, 5–16, 22 and 23 are scheduled to commence. Build and test these controls before onboarding customers." status="UPCOMING" />
          <Row title="IT Act section 43A and SPDI Rules" detail="Section 44(2), which omits IT Act section 43A, is scheduled for 13 May 2027. Until then, assess whether section 43A and the SPDI Rules apply to any sensitive personal data ORBIT handles." status="CURRENTLY RELEVANT WHERE APPLICABLE" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {officialLinks.map((item) => <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-edge px-3 py-2 text-xs text-cyan hover:border-cyan">{item.label} <ArrowUpRight size={12} aria-hidden="true" /></a>)}
        </div>
      </section>

      <section className="rounded-xl border border-edge bg-panel p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-ink">Before general availability</h3>
        <p className="mt-1 text-xs leading-5 text-mute">Release gates, not claims of completed compliance.</p>
        <ul className="mt-4 grid gap-2 text-xs leading-5 text-mute sm:grid-cols-2">
          <li>• Confirm the legal Data Fiduciary/controller identity and publish a verified contact.</li>
          <li>• Publish a purpose-specific notice and record consent/version history where required.</li>
          <li>• Add access, correction, erasure, grievance and withdrawal request handling.</li>
          <li>• Define retention/deletion for D1, Access identity, logs, backups and local exports.</li>
          <li>• Sign and review processor terms, subprocessors and cross-border transfer conditions.</li>
          <li>• Test breach response, notification workflows, access logs and backup restoration.</li>
          <li>• Assess age/child-user handling and any SPDI or sector-specific obligations.</li>
          <li>• Obtain India-qualified legal review before describing the service as compliant.</li>
        </ul>
      </section>
    </div>
  );
}
