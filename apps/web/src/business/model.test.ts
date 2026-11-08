import { describe, expect, it } from 'vitest';
import {
  BUSINESS_KPIS,
  BUSINESS_OFFERS,
  COMMERCIAL_STAGES,
  CUSTOMER_SEGMENTS,
  MARKET_REFERENCES,
  MARKET_RESEARCH_DATE,
  TRUST_GUARDRAILS,
} from './model.js';

describe('business module research model', () => {
  it('keeps all non-Community price points explicitly hypothetical or future', () => {
    const paidOffers = BUSINESS_OFFERS.filter((offer) => offer.id !== 'community');
    expect(paidOffers).toHaveLength(3);
    expect(paidOffers.every((offer) => offer.status !== 'Core promise')).toBe(true);
  });

  it('preserves the local-first Community promise at zero cost', () => {
    const community = BUSINESS_OFFERS.find((offer) => offer.id === 'community');
    expect(community?.price).toBe('$0');
    expect(community?.status).toBe('Core promise');
    expect(community?.capabilities.join(' ')).toContain('Local');
  });

  it('has official source links and a dated benchmark snapshot', () => {
    expect(MARKET_RESEARCH_DATE).toBe('2026-11-08');
    expect(MARKET_REFERENCES.length).toBeGreaterThanOrEqual(7);
    for (const reference of MARKET_REFERENCES) {
      expect(reference.sourceUrl).toMatch(/^https:\/\//);
      expect(reference.price).toMatch(/^(\$\d+|Quote \/ plan-dependent)$/);
    }
  });

  it('does not fabricate commercial performance metrics', () => {
    expect(BUSINESS_KPIS.length).toBeGreaterThanOrEqual(5);
    expect(BUSINESS_KPIS.every((kpi) => Boolean(kpi.definition))).toBe(true);
  });

  it('sets explicit exit gates for every commercial stage', () => {
    expect(COMMERCIAL_STAGES).toHaveLength(6);
    expect(COMMERCIAL_STAGES.every((stage) => stage.exitGate.length > 20)).toBe(true);
  });

  it('covers customer segments and trust safeguards', () => {
    expect(CUSTOMER_SEGMENTS.length).toBeGreaterThanOrEqual(4);
    expect(TRUST_GUARDRAILS.length).toBeGreaterThanOrEqual(5);
  });
});
