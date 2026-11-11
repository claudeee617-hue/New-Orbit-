import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EngineWorkbenches } from './EngineWorkbenches.js';

describe('EngineWorkbenches', () => {
  it('renders every engine workbench without inventing evidence', () => {
    const html = renderToStaticMarkup(
      createElement(EngineWorkbenches, {
        nodes: [],
        edges: [],
        evidence: [],
        passports: [],
      }),
    );

    for (const label of [
      'ATLAS',
      'WITNESS',
      'FLARE',
      'CAPSULE',
      'FLIGHT RECORDER',
      'PASSPORTS',
      'REPLAY ROOM',
      'MCP &amp; AI',
    ]) {
      expect(html).toContain(label);
    }

    expect(html).toContain('No matching ATLAS records');
    expect(html).toContain('Missing data stays unmeasured');
    expect(html).not.toContain('100% coverage');
  });

  it('renders only supplied graph and evidence records in the initial ATLAS view', () => {
    const html = renderToStaticMarkup(
      createElement(EngineWorkbenches, {
        nodes: [
          {
            id: 'node-1',
            type: 'Function',
            key: 'src/index.ts::main',
            validFromCommit: 'abc1234',
          },
          {
            id: 'node-2',
            type: 'HardwareDevice',
            key: 'esp32-demo',
          },
        ],
        edges: [{ id: 'edge-1', type: 'CALLS' }],
        evidence: [
          {
            id: 'evidence-1',
            source: 'ci:unit',
            sourceType: 'ci',
            status: 'PASS',
            contentHash: 'sha256-example',
          },
        ],
        passports: [],
      }),
    );

    expect(html).toContain('src/index.ts::main');
    expect(html).toContain('abc1234');
    expect(html).toContain('ATLAS records');
    expect(html).toContain('aria-label="Inspect Function src/index.ts::main"');
    expect(html).not.toContain('esp32-demo');
    expect(html).not.toContain('ci:unit');
  });

  it('shows only exact stored relationships connected to the selected ATLAS node', () => {
    const html = renderToStaticMarkup(
      createElement(EngineWorkbenches, {
        nodes: [
          { id: 'file-1', type: 'File', key: 'src/main.ts' },
          { id: 'symbol-1', type: 'Function', key: 'main' },
          { id: 'other-1', type: 'File', key: 'src/other.ts' },
        ],
        edges: [
          { id: 'edge-1', type: 'CONTAINS', fromId: 'file-1', toId: 'symbol-1' },
          { id: 'edge-2', type: 'IMPORTS', fromId: 'other-1', toId: 'file-1' },
        ],
        evidence: [],
        passports: [],
      }),
    );

    expect(html).toContain('src/main.ts');
    expect(html).not.toContain('Connected relationships (');
  });
});
