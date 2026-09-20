import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandwritingInput, type HandwritingInputHandle } from './HandwritingInput';

const file = new File([new Uint8Array([1, 2, 3])], 'answer.png', { type: 'image/png' });

describe('HandwritingInput', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps uncertain handwriting out of the composer until every line is reviewed', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        image: { height: 800, mediaId: '31', url: '/api/media/31', width: 1200 },
        transcript: {
          confirmed: false,
          id: '41',
          lines: [
            { explicitly_confirmed: false, index: 1, text: '$1+\\frac{1}{x^2}$', uncertain: false },
            { explicitly_confirmed: false, index: 2, text: '$x\\geq -1$', uncertain: true },
          ],
          media_id: '31',
          revision: 1,
        },
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        confirmed: true,
        id: '41',
        lines: [
          { explicitly_confirmed: false, index: 1, text: '$1+\\frac{1}{x^2}$', uncertain: false },
          { explicitly_confirmed: true, index: 2, text: '$x\\geq -1$', uncertain: true },
        ],
        media_id: '31',
        revision: 2,
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
    const onConfirmed = vi.fn();
    const ref = createRef<HandwritingInputHandle>();
    render(<HandwritingInput ref={ref} sessionId="91" onConfirmed={onConfirmed} />);

    act(() => ref.current?.selectFile(file));
    fireEvent.click(screen.getByRole('button', { name: '识别手写作答' }));

    const confirm = await screen.findByRole('button', { name: '确认转写并放入输入框' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('待确认')).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认第 2 行' }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({
      markdown: '$1+\\frac{1}{x^2}$\n\n$x\\geq -1$',
      revision: 2,
      transcriptId: '41',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/media/handwriting?sessionId=91',
      expect.objectContaining({ body: file, method: 'POST' }),
    );
  });
});
