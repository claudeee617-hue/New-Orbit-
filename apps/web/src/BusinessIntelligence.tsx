import { useMemo, useState, type ChangeEvent } from 'react';
import {
  calculateBusinessIntelligence,
  formatBusinessCurrency,
  formatBusinessPercent,
  type BusinessCurrency,
  type FinancialInputs,
} from './business/finance.js';

type InputKey = keyof FinancialInputs;
type InputState = Record<InputKey, string>;

const INITIAL_INPUTS: InputState = {
  actualRevenue: '',
  actualExpenses: '',
  actualCustomers: '',
  forecastRevenue: '',
  forecastExpenses: '',
  forecastCustomers: '',
  pricePerSeat: '',
  variableCostPerSeat: '',
  fixedMonthlyCost: '',
  targetSeats: '',
};

const ACTUAL_FIELDS: { key: InputKey; label: string; hint: string }[] = [
  { key: 'actualRevenue', label: 'Actual revenue', hint: 'Revenue recorded for the period' },
  { key: 'actualExpenses', label: 'Actual expenses', hint: 'Operating expenses for the period' },
  { key: 'actualCustomers', label: 'Paying customers', hint: 'Count of paying customers' },
];

const FORECAST_FIELDS: { key: InputKey; label: string; hint: string }[] = [
  { key: 'forecastRevenue', label: 'Forecast revenue', hint: 'Your planned revenue for the period' },
  { key: 'forecastExpenses', label: 'Forecast expenses', hint: 'Your planned expenses for the period' },
  { key: 'forecastCustomers', label: 'Forecast customers', hint: 'Expected paying-customer count' },
];

const PRICING_FIELDS: { key: InputKey; label: string; hint: string }[] = [
  { key: 'pricePerSeat', label: 'Monthly price / seat', hint: 'Scenario assumption' },
  { key: 'variableCostPerSeat', label: 'Variable cost / seat', hint: 'Scenario assumption' },
  { key: 'fixedMonthlyCost', label: 'Fixed monthly costs', hint: 'Scenario assumption' },
  { key: 'targetSeats', label: 'Target paid seats', hint: 'Scenario assumption' },
];

function toNumber(value: string): number {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-edge bg-void p-4">
      <p className="text-xs uppercase tracking-wider text-mute">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-mute">{detail}</p>
    </article>
  );
}

function NumberField({
  field,
  value,
  currency,
  onChange,
}: {
  field: { key: InputKey; label: string; hint: string };
  value: string;
  currency: BusinessCurrency;
  onChange: (key: InputKey, value: string) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.value;
    const isCount = field.key.toLowerCase().includes('customer') || field.key === 'targetSeats';
    const validNumber = isCount ? /^\d*$/.test(next) : /^\d*(\.\d*)?$/.test(next);
    if (next === '' || (validNumber && Number.isFinite(Number(next)))) {
      onChange(field.key, next);
    }
  };

  const isCount = field.key.toLowerCase().includes('customer') || field.key === 'targetSeats';

  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
        {field.label}
        <span className="text-[10px] font-normal uppercase tracking-wider text-mute">
          {isCount ? 'Count' : currency}
        </span>
      </span>
      <input
        type="number"
        min="0"
        step={isCount ? '1' : '0.01'}
        inputMode="decimal"
        value={value}
        onChange={handleChange}
        placeholder="0"
        aria-label={field.label}
        className="mt-2 w-full rounded-md border border-edge bg-panel px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-cyan focus:ring-1 focus:ring-cyan"
      />
      <span className="mt-1 block text-xs text-mute">{field.hint}</span>
    </label>
  );
}

function SectionTitle({
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
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">{eyebrow}</p>
      <h3 className="mt-1 text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-mute">{description}</p>
    </div>
  );
}

export function BusinessIntelligence() {
  const [values, setValues] = useState<InputState>(INITIAL_INPUTS);
  const [currency, setCurrency] = useState<BusinessCurrency>('INR');
  const numericInputs = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, toNumber(value)]),
      ) as FinancialInputs,
    [values],
  );
  const metrics = useMemo(() => calculateBusinessIntelligence(numericInputs), [numericInputs]);

  const update = (key: InputKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const money = (value: number) => formatBusinessCurrency(value, currency);

  const comparisonMaximum = Math.max(metrics.actual.revenue, metrics.forecast.revenue);
  const actualBar =
    comparisonMaximum > 0 ? (metrics.actual.revenue / comparisonMaximum) * 100 : 0;
  const forecastBar =
    comparisonMaximum > 0 ? (metrics.forecast.revenue / comparisonMaximum) * 100 : 0;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-edge bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">
              Prompt 4 · Business intelligence
            </p>
            <h3 className="mt-2 text-xl font-semibold text-ink">
              Turn business assumptions into measurable decisions.
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-mute">
              Enter your own period figures to compare actual performance with a forecast, then test
              unit economics. Values stay in this page's local React state and are not sent to an API
              or saved after refresh.
            </p>
          </div>
          <label className="text-xs text-mute">
            Reporting currency
            <select
              value={currency}
              onChange={(event) => setCurrency(event.currentTarget.value as BusinessCurrency)}
              className="mt-1 block rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm text-ink outline-none focus:border-cyan"
            >
              <option value="INR">INR · ₹</option>
              <option value="USD">USD · $</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-edge pt-4 text-xs text-mute">
          <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 font-mono text-[10px] text-warn">
            USER-ENTERED · NOT CONNECTED
          </span>
          <span>No live accounting, payment, CRM or analytics source is connected.</span>
        </div>
      </section>

      <section>
        <SectionTitle
          eyebrow="01 · Period performance"
          title="Actuals versus forecast"
          description="Enter values for the same reporting period. Blank fields are treated as zero; missing denominators are shown as unavailable rather than inventing a percentage."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-edge bg-panel p-5">
            <h4 className="font-mono text-xs uppercase tracking-wider text-ink">
              Actual performance
            </h4>
            <p className="mt-1 text-xs text-mute">Figures you have actually recorded</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {ACTUAL_FIELDS.map((field) => (
                <NumberField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  currency={currency}
                  onChange={update}
                />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-panel p-5">
            <h4 className="font-mono text-xs uppercase tracking-wider text-ink">
              Forecast performance
            </h4>
            <p className="mt-1 text-xs text-mute">Your planned or scenario values</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {FORECAST_FIELDS.map((field) => (
                <NumberField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  currency={currency}
                  onChange={update}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Actual profit"
            value={money(metrics.actual.profit)}
            detail={\`Margin ${formatBusinessPercent(metrics.actual.marginPercent)}\`}
          />
          <MetricCard
            label="Forecast profit"
            value={money(metrics.forecast.profit)}
            detail={\`Margin ${formatBusinessPercent(metrics.forecast.marginPercent)}\`}
          />
          <MetricCard
            label="Revenue change"
            value={formatBusinessPercent(metrics.revenueChangePercent)}
            detail="Forecast compared with actual"
          />
          <MetricCard
            label="Actual revenue / customer"
            value={
              metrics.actual.revenuePerCustomer === null
                ? '—'
                : money(metrics.actual.revenuePerCustomer)
            }
            detail="Unavailable until customer count is entered"
          />
        </div>
        <div className="mt-4 rounded-xl border border-edge bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-mono text-xs uppercase tracking-wider text-ink">
              Revenue comparison
            </h4>
            <span className="text-[10px] uppercase tracking-wider text-mute">
              Relative scale · user input
            </span>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <div className="mb-2 flex justify-between gap-3 text-xs">
                <span className="text-mute">Actual</span>
                <span className="font-mono text-ink">{money(metrics.actual.revenue)}</span>
              </div>
              <div
                role="img"
                aria-label={\`Actual revenue is ${actualBar.toFixed(1)} percent of the comparison maximum\`}
                className="h-2 overflow-hidden rounded-full bg-void"
              >
                <div
                  className="h-full rounded-full bg-cyan"
                  style={{ width: \`${actualBar}%\` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-2 flex justify-between gap-3 text-xs">
                <span className="text-mute">Forecast</span>
                <span className="font-mono text-ink">{money(metrics.forecast.revenue)}</span>
              </div>
              <div
                role="img"
                aria-label={\`Forecast revenue is ${forecastBar.toFixed(1)} percent of the comparison maximum\`}
                className="h-2 overflow-hidden rounded-full bg-void"
              >
                <div
                  className="h-full rounded-full bg-violet"
                  style={{ width: \`${forecastBar}%\` }}
                />
              </div>
            </div>
          </div>
          {metrics.actual.revenue === 0 && metrics.forecast.revenue === 0 ? (
            <p className="mt-4 text-xs text-mute">
              Add actual or forecast revenue to populate this comparison.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <SectionTitle
          eyebrow="02 · Unit economics"
          title="Pricing and profitability simulator"
          description="Model a possible paid-seat offer. These are editable scenario assumptions—not ORBIT's announced price, measured cost or validated willingness-to-pay."
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="rounded-xl border border-edge bg-panel p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {PRICING_FIELDS.map((field) => (
                <NumberField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  currency={currency}
                  onChange={update}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setValues(INITIAL_INPUTS)}
              className="mt-5 rounded-md border border-edge px-3 py-2 text-xs text-mute transition hover:border-cyan hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
            >
              Reset all inputs
            </button>
          </div>
          <div className="rounded-xl border border-edge bg-panel p-5">
            <p className="font-mono text-xs uppercase tracking-wider text-ink">Scenario output</p>
            <p className="mt-1 text-xs text-mute">Calculated from the four assumptions</p>
            <div className="mt-4 space-y-3">
              {[
                ['Monthly revenue', money(metrics.pricing.monthlyRevenue)],
                ['Variable costs', money(metrics.pricing.variableCosts)],
                ['Total monthly costs', money(metrics.pricing.totalCosts)],
                ['Monthly profit / loss', money(metrics.pricing.monthlyProfit)],
                ['Profit margin', formatBusinessPercent(metrics.pricing.marginPercent)],
                ['Contribution / seat', money(metrics.pricing.contributionPerSeat)],
                [
                  'Break-even seats',
                  metrics.pricing.breakEvenSeats === null
                    ? 'Not achievable at this contribution'
                    : String(metrics.pricing.breakEvenSeats),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 border-b border-edge pb-2 text-sm last:border-0"
                >
                  <span className="text-mute">{label}</span>
                  <span className="text-right font-mono text-ink">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-edge bg-panel p-5">
        <SectionTitle
          eyebrow="03 · Customer intelligence"
          title="Customer analytics are not connected yet"
          description="ORBIT currently has no customer database, CRM or billing feed. We will not display made-up segments, retention curves, acquisition costs or conversion rates as if they were observed."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Paying customers · actual"
            value={String(metrics.actual.customers)}
            detail="Count entered above; not independently verified"
          />
          <MetricCard
            label="Paying customers · forecast"
            value={String(metrics.forecast.customers)}
            detail="Planning assumption entered above"
          />
          <MetricCard
            label="Customer records"
            value="Not connected"
            detail="Connect a privacy-reviewed source in a future phase"
          />
        </div>
        <p className="mt-4 rounded-md border border-edge bg-void p-3 text-xs leading-5 text-mute">
          Next data needed for cohort, churn, acquisition and segment analysis: consented customer
          IDs, plan history, invoice periods, acquisition source and a documented retention policy.
          Do not paste personal or payment-card data into this local calculator.
        </p>
      </section>
    </div>
  );
}
