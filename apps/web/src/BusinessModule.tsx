import {
  BUSINESS_KPIS,
  BUSINESS_OFFERS,
  COMMERCIAL_STAGES,
  CUSTOMER_SEGMENTS,
  MARKET_REFERENCES,
  MARKET_RESEARCH_DATE,
  TRUST_GUARDRAILS,
} from './business/model.js';

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-mute">{description}</p>
    </div>
  );
}

function StatusLabel({ value }: { value: string }) {
  const className =
    value === 'Core promise'
      ? 'border-ok/30 bg-ok/10 text-ok'
      : value === 'Pricing hypothesis'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : 'border-edge bg-void text-mute';

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${className}`}
    >
      {value}
    </span>
  );
}

export function BusinessModule() {
  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-xl border border-edge bg-panel">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.7fr)] lg:p-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan">
              Commercial strategy · planning view
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Grow the business without breaking local-first trust.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-mute">
              ORBIT's proposed model keeps individual verification local and useful, then monetises
              team collaboration, governance, retention and specialist embedded workflows. This
              screen shows strategy and research—not live billing, CRM or revenue data.
            </p>
          </div>
          <div className="rounded-lg border border-edge bg-void p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
              Recommended model
            </p>
            <p className="mt-2 text-xl font-semibold text-ink">Hybrid open-core</p>
            <p className="mt-2 text-sm leading-6 text-mute">
              Free local Community · paid hosted Team · custom Enterprise · Embedded add-on after
              validation.
            </p>
            <div className="mt-4 border-t border-edge pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-mute">
                Commercial status
              </p>
              <p className="mt-1 text-sm text-warn">Strategy proposed · not yet a sales offer</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="offers-heading">
        <SectionHeading
          eyebrow="01 · Packaging"
          title="Four offers, one trust boundary"
          description="Prices outside Community are planning hypotheses or future offers. They are not active checkout prices or validated willingness-to-pay."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {BUSINESS_OFFERS.map((offer) => (
            <article key={offer.id} className="rounded-xl border border-edge bg-panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-mono text-base font-semibold text-ink">{offer.name}</h3>
                  <p className="mt-1 text-xs text-mute">{offer.audience}</p>
                </div>
                <StatusLabel value={offer.status} />
              </div>
              <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-edge pb-4">
                <p className="text-2xl font-semibold tracking-tight text-ink">{offer.price}</p>
                <p className="text-right text-xs text-mute">{offer.billing}</p>
              </div>
              <p className="mt-4 text-sm leading-6 text-mute">{offer.value}</p>
              <ul className="mt-4 space-y-2">
                {offer.capabilities.map((capability) => (
                  <li key={capability} className="flex gap-2 text-sm leading-5 text-ink">
                    <span aria-hidden="true" className="mt-0.5 text-cyan">
                      ›
                    </span>
                    <span>{capability}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="segments-heading">
        <SectionHeading
          eyebrow="02 · Market"
          title="Customer segments and beachhead"
          description="Start with one painful, repeatable engineering workflow. Embedded and enterprise expansion stay gated on proof from earlier stages."
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {CUSTOMER_SEGMENTS.map((segment) => (
            <article key={segment.id} className="rounded-lg border border-edge bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-ink">{segment.name}</h3>
                <span className="font-mono text-[10px] uppercase tracking-wider text-cyan">
                  {segment.motion}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-mute">{segment.pain}</p>
              <p className="mt-3 border-t border-edge pt-3 text-xs text-mute">
                <span className="text-ink">Likely buyer:</span> {segment.buyer}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="benchmarks-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading
            eyebrow="03 · Competitive research"
            title="Public price references"
            description="Adjacent developer tools provide context, not direct feature equivalence. USD public list prices checked on the date shown."
          />
          <p className="mb-5 rounded-md border border-edge bg-panel px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-mute">
            Checked {MARKET_RESEARCH_DATE}
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-void font-mono text-[10px] uppercase tracking-wider text-mute">
              <tr>
                <th className="px-4 py-3 font-medium">Product / plan</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Billing unit</th>
                <th className="px-4 py-3 font-medium">Why it matters</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {MARKET_REFERENCES.map((reference) => (
                <tr key={reference.id} className="border-t border-edge align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{reference.product}</p>
                    <p className="mt-1 text-xs text-mute">{reference.offer}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-cyan">{reference.price}</td>
                  <td className="px-4 py-3 text-xs leading-5 text-mute">{reference.billing}</td>
                  <td className="px-4 py-3 text-xs leading-5 text-mute">{reference.relevance}</td>
                  <td className="px-4 py-3">
                    <a
                      href={reference.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-cyan underline decoration-cyan/40 underline-offset-4 hover:decoration-cyan"
                    >
                      Vendor pricing ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-mute">
          Prices can change and may exclude tax. Annual billing and minimum-contributor rules are
          called out where relevant. These products solve overlapping but different jobs; ORBIT must
          validate its own value with real buyers.
        </p>
      </section>

      <section aria-labelledby="stages-heading">
        <SectionHeading
          eyebrow="04 · Execution gates"
          title="Commercial roadmap"
          description="Progress is gated by user evidence and operational readiness, not by calendar dates or feature-count targets."
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {COMMERCIAL_STAGES.map((stage, index) => (
            <article key={stage.id} className="rounded-lg border border-edge bg-panel p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-void font-mono text-xs text-cyan">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="font-medium text-ink">{stage.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-mute">{stage.productGoal}</p>
                  <p className="mt-3 border-t border-edge pt-3 text-xs leading-5 text-ink">
                    <span className="text-cyan">Exit gate:</span> {stage.exitGate}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="metrics-heading">
        <SectionHeading
          eyebrow="05 · Business health"
          title="What must be measured before scaling"
          description="No commercial integrations or verified customer actuals are connected yet. These indicators deliberately remain unmeasured."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {BUSINESS_KPIS.map((kpi) => (
            <article key={kpi.id} className="rounded-lg border border-edge bg-panel p-4">
              <p className="text-sm font-medium text-ink">{kpi.name}</p>
              <p className="mt-2 font-mono text-xs uppercase tracking-wider text-warn">
                Not measured
              </p>
              <p className="mt-2 text-xs leading-5 text-mute">{kpi.definition}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="trust-heading"
        className="rounded-xl border border-edge bg-panel p-5"
      >
        <SectionHeading
          eyebrow="06 · Non-negotiables"
          title="Trust and privacy guardrails"
          description="Commercial growth cannot turn the optional cloud layer into a dependency for local analysis."
        />
        <ul className="grid gap-3 md:grid-cols-2">
          {TRUST_GUARDRAILS.map((guardrail) => (
            <li key={guardrail} className="flex gap-3 text-sm leading-6 text-ink">
              <span aria-hidden="true" className="text-ok">
                ✓
              </span>
              <span>{guardrail}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-edge pt-4 text-xs leading-5 text-mute">
        Strategy only · No checkout, billing provider, CRM, customer database, revenue ledger or
        subscription entitlement is implemented by this module.
      </footer>
    </div>
  );
}
