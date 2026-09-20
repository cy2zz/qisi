import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeSpeechCallbacks } from './speech-client';
import { VoiceInputButton } from './VoiceInputButton';

const mocks = vi.hoisted(() => ({
  callbacks: undefined as RealtimeSpeechCallbacks | undefined,
  captureStop: vi.fn(),
  sessionFinish: vi.fn(),
  sessionClose: vi.fn(),
}));

vi.mock('./audio-capture', () => ({
  createWavHeader: vi.fn(() => new ArrayBuffer(44)),
  pcmToArrayBuffer: vi.fn(() => new ArrayBuffer(8)),
  startAudioCapture: vi.fn().mockImplementation(async () => ({ stop: mocks.captureStop })),
}));

vi.mock('./speech-client', () => ({
  createRealtimeSpeechSession: vi.fn().mockImplementation((callbacks: RealtimeSpeechCallbacks) => {
    mocks.callbacks = callbacks;
    return {
      close: mocks.sessionClose,
      finish: mocks.sessionFinish,
      sendAudio: vi.fn(),
    };
  }),
  transcribeShortSpeech: vi.fn(),
}));

describe('VoiceInputButton realtime silence', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.callbacks = undefined;
  });

  it('stops realtime recognition and explains prolonged silence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T06:00:00Z'));
    mocks.captureStop.mockResolvedValue(new Blob([], { type: 'audio/wav' }));
    render(<VoiceInputButton onTranscript={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '实时语音' }));
    await act(async () => Promise.resolve());
    act(() => mocks.callbacks?.onReady());

    await act(async () => {
      vi.advanceTimersByTime(8_000);
      await Promise.resolve();
    });

    expect(mocks.captureStop).toHaveBeenCalledTimes(1);
    expect(mocks.sessionFinish).toHaveBeenCalledTimes(1);
    expect(screen.getByText('长时间未检测到声音，正在自动结束…')).toBeInTheDocument();
  });

  it('streams raw recognition into the composer and commits the formatted result at the end', async () => {
    mocks.captureStop.mockResolvedValue(new Blob([], { type: 'audio/wav' }));
    const onInterimTranscript = vi.fn();
    const onTranscript = vi.fn();
    render(
      <VoiceInputButton
        onInterimTranscript={onInterimTranscript}
        onTranscript={onTranscript}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '实时语音' }));
    await act(async () => Promise.resolve());
    act(() => mocks.callbacks?.onReady());
    act(() => mocks.callbacks?.onTranscript('根号2除以根号3', false));
    expect(onInterimTranscript).toHaveBeenLastCalledWith('根号2除以根号3');

    act(() => mocks.callbacks?.onDone('$\\frac{\\sqrt{2}}{\\sqrt{3}}$', true));
    expect(onTranscript).toHaveBeenLastCalledWith('$\\frac{\\sqrt{2}}{\\sqrt{3}}$');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
