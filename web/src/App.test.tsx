import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the NestJS health result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('后端状态：ok')).toBeInTheDocument();
    });
  });
});
