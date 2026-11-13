import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessOperations } from './BusinessOperations.js';

describe('BusinessOperations', () => {
  it('renders an empty local-first pipeline without fabricated accounts', () => {
    const html = renderToStaticMarkup(<BusinessOperations />);
    expect(html).toContain('Business operations workspace');
    expect(html).toContain('Add an opportunity');
    expect(html).toContain('Export JSON');
    expect(html).toContain('Import JSON');
    expect(html).toContain('No sample customers are preloaded.');
    expect(html).toContain('0 locally recorded opportunities');
  });

  it('explains the local storage and planning-only boundary', () => {
    const html = renderToStaticMarkup(<BusinessOperations />);
    expect(html).toContain('Records stay in this browser&#x27;s local storage');
    expect(html).toContain('not booked revenue or verified customer records');
    expect(html).toContain('not encrypted by the app');
  });
});
