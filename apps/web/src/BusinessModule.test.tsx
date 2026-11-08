import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessModule } from './BusinessModule.js';

describe('BusinessModule', () => {
  it('renders the researched hybrid offer model and pricing maturity labels', () => {
    const html = renderToStaticMarkup(<BusinessModule />);

    expect(html).toContain('Hybrid open-core');
    expect(html).toContain('Community');
    expect(html).toContain('Team');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Embedded');
    expect(html).toContain('Pricing hypothesis');
    expect(html).toContain('Quote / plan-dependent');
  });

  it('shows commercial KPIs as unmeasured rather than fabricated values', () => {
    const html = renderToStaticMarkup(<BusinessModule />);

    expect(html).toContain('Monthly recurring revenue');
    expect(html).toContain('Not measured');
    expect(html).not.toContain('ARR $');
  });

  it('includes roadmap exit gates and local-first privacy safeguards', () => {
    const html = renderToStaticMarkup(<BusinessModule />);

    expect(html).toContain('S0 · Release readiness');
    expect(html).toContain('S5 · Embedded expansion');
    expect(html).toContain('Trust and privacy guardrails');
    expect(html).toContain('No source code, secrets or raw telemetry is uploaded by default.');
  });
});
