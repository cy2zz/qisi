import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudButton, ReadAloudProvider } from './ReadAloud';

class FakeAudio extends EventTarget {
  currentTime = 0;
  muted = false;
  paused = true;
  preload = '';
  src = '';
  volume = 1;

  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });

  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });

  removeAttribute = vi.fn();
  load = vi.fn();
}

describe('ReadAloud', () => {
  let latestAudio: FakeAudio | null;
  const captureAudio = (audio: FakeAudio) => {
    latestAudio = audio;
  };

  beforeEach(() => {
    latestAudio = null;
    vi.stubGlobal('Audio', class extends FakeAudio {
      constructor(src?: string) {
        super();
        this.src = src ?? '';
        captureAudio(this);
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(new Blob(['mp3'], { type: 'audio/mpeg' }), {
            headers: { 'Content-Type': 'audio/mpeg' },
            status: 200,
          }),
        ),
      ),
    );
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:qisi-audio'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts only after a click and exposes working volume and mute controls', async () => {
    render(
      <ReadAloudProvider>
        <ReadAloudButton id="overview" label="朗读题目分析" text="这是一道分式不等式。" />
      </ReadAloudProvider>,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '朗读题目分析' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '暂停朗读' })).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/speech/synthesize',
      expect.objectContaining({
        body: JSON.stringify({ text: '这是一道分式不等式。' }),
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(latestAudio?.volume).toBe(0.85);

    fireEvent.change(screen.getByRole('slider', { name: '朗读音量' }), {
      target: { value: '0.35' },
    });
    expect(latestAudio?.volume).toBe(0.35);

    fireEvent.click(screen.getByRole('button', { name: '静音朗读' }));
    expect(latestAudio?.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '恢复音量' }));
    expect(latestAudio?.muted).toBe(false);
    expect(latestAudio?.volume).toBe(0.35);
  });

  it('moves playback to the newly selected AI reply', async () => {
    render(
      <ReadAloudProvider>
        <ReadAloudButton id="first" label="朗读第一段" text="第一段" />
        <ReadAloudButton id="second" label="朗读第二段" text="第二段" />
      </ReadAloudProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '朗读第一段' }));
    await screen.findByRole('button', { name: '暂停朗读' });
    const firstAudio = latestAudio;

    fireEvent.click(screen.getByRole('button', { name: '朗读第二段' }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(firstAudio?.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '暂停朗读' })).toBeInTheDocument();
  });
});
