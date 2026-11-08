import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandCenter } from './CommandCenter.js';

const TOKEN = 'orbit-test-token-'.padEnd(48, 'x');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => cleanup());

describe('CommandCenter', () => {
  it('explains local token handling and does not connect without a token', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<CommandCenter />);
    expect(screen.getByRole('heading', { name: 'Connect your ORBIT workspace' })).toBeTruthy();
    expect(screen.getByLabelText('Local API token')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('connects, loads repository data and renders measured workspace metrics', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/repositories')) {
        return response({ repositories: [{ id: 'repo-1', key: 'local/demo', displayName: 'Demo repo' }] });
      }
      if (url.includes('/graph')) {
        return response({
          repository: { id: 'repo-1', key: 'local/demo', displayName: 'Demo repo' },
          nodes: [{ id: 'node-1', type: 'File', key: 'src/index.ts' }],
          edges: [],
          page: { limit: 100, offset: 0, hasMoreNodes: false, hasMoreEdges: false },
          ledger: { entries: 3, headHash: 'abc123' },
        });
      }
      if (url.includes('/evidence')) {
        return response({ repository: {}, evidence: [{ id: 'ev-1', source: 'ci', status: 'PASS' }], returned: 1, limit: 100 });
      }
      if (url.includes('/passports')) {
        return response({ repository: {}, passports: [], page: {} });
      }
      return response({ error: 'NOT_FOUND', message: 'not found' }, 404);
    });

    render(<CommandCenter />);
    fireEvent.change(screen.getByLabelText('Local API token'), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect locally' }));

    expect(await screen.findByText('Engineering Command Center')).toBeTruthy();
    expect(await screen.findByText('Demo repo · local/demo')).toBeTruthy();
    expect(await screen.findByText('Graph nodes')).toBeTruthy();
    expect(await screen.findByText('abc123')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      expect(JSON.stringify(call)).toContain(TOKEN);
    }
    fetchSpy.mockRestore();
  });

  it('offers a safe actionable message when authentication fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ error: 'UNAUTHENTICATED', message: 'bad token' }, 401),
    );
    render(<CommandCenter />);
    fireEvent.change(screen.getByLabelText('Local API token'), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect locally' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('local API token was rejected');
    fetchSpy.mockRestore();
  });
});
