export type BusinessCurrency = 'INR' | 'USD';

export interface FinancialInputs {
  actualRevenue: number;
  actualExpenses: number;
  actualCustomers: number;
  forecastRevenue: number;
  forecastExpenses: number;
  forecastCustomers: number;
  pricePerSeat: number;
  variableCostPerSeat: number;
  fixedMonthlyCost: number;
  targetSeats: number;
}

export interface PeriodMetrics {
  revenue: number;
  expenses: number;
  profit: number;
  marginPercent: number | null;
  customers: number;
  revenuePerCustomer: number | null;
}

export interface PricingMetrics {
  monthlyRevenue: number;
  variableCosts: number;
  totalCosts: number;
  monthlyProfit: number;
  marginPercent: number | null;
  breakEvenSeats: number | null;
  contributionPerSeat: number;
}

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_COUNT = 1_000_000;

function safeAmount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_AMOUNT);
}

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_COUNT);
}

function periodMetrics(revenueInput: number, expensesInput: number, customersInput: number): PeriodMetrics {
  const revenue = safeAmount(revenueInput);
  const expenses = safeAmount(expensesInput);
  const customers = safeCount(customersInput);
  const profit = revenue - expenses;

  return {
    revenue,
    expenses,
    profit,
    marginPercent: revenue > 0 ? (profit / revenue) * 100 : null,
    customers,
    revenuePerCustomer: customers > 0 ? revenue / customers : null,
  };
}

/** Pure calculations only: callers decide where inputs come from and how they are stored. */
export function calculateBusinessIntelligence(inputs: FinancialInputs) {
  const actual = periodMetrics(inputs.actualRevenue, inputs.actualExpenses, inputs.actualCustomers);
  const forecast = periodMetrics(
    inputs.forecastRevenue,
    inputs.forecastExpenses,
    inputs.forecastCustomers,
  );
  const pricing = calculatePricing({
    pricePerSeat: inputs.pricePerSeat,
    variableCostPerSeat: inputs.variableCostPerSeat,
    fixedMonthlyCost: inputs.fixedMonthlyCost,
    targetSeats: inputs.targetSeats,
  });

  return {
    actual,
    forecast,
    revenueChangePercent:
      actual.revenue > 0 ? ((forecast.revenue - actual.revenue) / actual.revenue) * 100 : null,
    pricing,
  };
}

export function calculatePricing(input: {
  pricePerSeat: number;
  variableCostPerSeat: number;
  fixedMonthlyCost: number;
  targetSeats: number;
}): PricingMetrics {
  const pricePerSeat = safeAmount(input.pricePerSeat);
  const variableCostPerSeat = safeAmount(input.variableCostPerSeat);
  const fixedMonthlyCost = safeAmount(input.fixedMonthlyCost);
  const targetSeats = safeCount(input.targetSeats);
  const contributionPerSeat = pricePerSeat - variableCostPerSeat;
  const monthlyRevenue = pricePerSeat * targetSeats;
  const variableCosts = variableCostPerSeat * targetSeats;
  const totalCosts = variableCosts + fixedMonthlyCost;
  const monthlyProfit = monthlyRevenue - totalCosts;

  return {
    monthlyRevenue,
    variableCosts,
    totalCosts,
    monthlyProfit,
    marginPercent: monthlyRevenue > 0 ? (monthlyProfit / monthlyRevenue) * 100 : null,
    breakEvenSeats:
      contributionPerSeat > 0 ? Math.ceil(fixedMonthlyCost / contributionPerSeat) : null,
    contributionPerSeat,
  };
}

export function formatBusinessCurrency(value: number, currency: BusinessCurrency): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(safeValue);
}

export function formatBusinessPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}
