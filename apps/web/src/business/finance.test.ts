import { describe, expect, it } from 'vitest';
import {
  calculateBusinessIntelligence,
  calculatePricing,
  formatBusinessCurrency,
  formatBusinessPercent,
  type FinancialInputs,
} from './finance.js';

const emptyInputs: FinancialInputs = {
  actualRevenue: 0,
  actualExpenses: 0,
  actualCustomers: 0,
  forecastRevenue: 0,
  forecastExpenses: 0,
  forecastCustomers: 0,
  pricePerSeat: 0,
  variableCostPerSeat: 0,
  fixedMonthlyCost: 0,
  targetSeats: 0,
};

describe('business intelligence calculations', () => {
  it('calculates actual and forecast profit, margins and per-customer revenue', () => {
    const result = calculateBusinessIntelligence({
      ...emptyInputs,
      actualRevenue: 100_000,
      actualExpenses: 60_000,
      actualCustomers: 10,
      forecastRevenue: 125_000,
      forecastExpenses: 70_000,
      forecastCustomers: 12,
    });

    expect(result.actual.profit).toBe(40_000);
    expect(result.actual.marginPercent).toBe(40);
    expect(result.actual.revenuePerCustomer).toBe(10_000);
    expect(result.forecast.profit).toBe(55_000);
    expect(result.forecast.marginPercent).toBe(44);
    expect(result.revenueChangePercent).toBe(25);
  });

  it('uses null rather than divide-by-zero metrics when no actuals exist', () => {
    const result = calculateBusinessIntelligence(emptyInputs);
    expect(result.actual.marginPercent).toBeNull();
    expect(result.actual.revenuePerCustomer).toBeNull();
    expect(result.revenueChangePercent).toBeNull();
    expect(result.pricing.marginPercent).toBeNull();
  });

  it('handles loss-making periods without hiding negative profit or margin', () => {
    const result = calculateBusinessIntelligence({
      ...emptyInputs,
      actualRevenue: 100,
      actualExpenses: 140,
    });
    expect(result.actual.profit).toBe(-40);
    expect(result.actual.marginPercent).toBe(-40);
  });

  it('returns unavailable percentages when finite inputs would overflow a ratio', () => {
    const result = calculateBusinessIntelligence({
      ...emptyInputs,
      actualRevenue: 1e-320,
      actualExpenses: 1_000_000_000_000,
      forecastRevenue: 1_000_000_000_000,
    });
    expect(result.actual.marginPercent).toBeNull();
    expect(result.revenueChangePercent).toBeNull();
    expect(formatBusinessPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('sanitises negative, non-finite and excessive inputs', () => {
    const result = calculateBusinessIntelligence({
      ...emptyInputs,
      actualRevenue: Number.NaN,
      actualExpenses: -50,
      actualCustomers: Number.POSITIVE_INFINITY,
      forecastRevenue: 1e300,
    });
    expect(result.actual.revenue).toBe(0);
    expect(result.actual.expenses).toBe(0);
    expect(result.actual.customers).toBe(0);
    expect(result.forecast.revenue).toBe(1_000_000_000_000);
    expect(Number.isFinite(result.forecast.profit)).toBe(true);
  });
});

describe('pricing simulator', () => {
  it('calculates monthly revenue, costs, profit and break-even seats', () => {
    const result = calculatePricing({
      pricePerSeat: 100,
      variableCostPerSeat: 20,
      fixedMonthlyCost: 400,
      targetSeats: 10,
    });
    expect(result.monthlyRevenue).toBe(1_000);
    expect(result.variableCosts).toBe(200);
    expect(result.totalCosts).toBe(600);
    expect(result.monthlyProfit).toBe(400);
    expect(result.marginPercent).toBe(40);
    expect(result.breakEvenSeats).toBe(5);
  });

  it('does not claim break-even when contribution per seat is zero or negative', () => {
    expect(
      calculatePricing({
        pricePerSeat: 20,
        variableCostPerSeat: 20,
        fixedMonthlyCost: 100,
        targetSeats: 10,
      }).breakEvenSeats,
    ).toBeNull();
    expect(
      calculatePricing({
        pricePerSeat: 10,
        variableCostPerSeat: 20,
        fixedMonthlyCost: 100,
        targetSeats: 10,
      }).breakEvenSeats,
    ).toBeNull();
  });

  it('does not display an infinite break-even seat count for tiny contributions', () => {
    const result = calculatePricing({
      pricePerSeat: 1e-320,
      variableCostPerSeat: 0,
      fixedMonthlyCost: 100,
      targetSeats: 1,
    });
    expect(result.breakEvenSeats).toBeNull();
  });

  it('supports a zero fixed-cost break-even point', () => {
    const result = calculatePricing({
      pricePerSeat: 20,
      variableCostPerSeat: 5,
      fixedMonthlyCost: 0,
      targetSeats: 3,
    });
    expect(result.breakEvenSeats).toBe(0);
    expect(result.monthlyProfit).toBe(45);
  });
});

describe('formatters', () => {
  it('formats INR and USD without locale-dependent decimals', () => {
    expect(formatBusinessCurrency(12500, 'INR')).toContain('12,500');
    expect(formatBusinessCurrency(12500, 'USD')).toContain('12,500');
  });

  it('formats missing and finite percentages safely', () => {
    expect(formatBusinessPercent(null)).toBe('—');
    expect(formatBusinessPercent(Number.NaN)).toBe('—');
    expect(formatBusinessPercent(12.345)).toBe('12.3%');
  });
});
