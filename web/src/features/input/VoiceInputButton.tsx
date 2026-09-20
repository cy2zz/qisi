import { useEffect, useRef, useState } from 'react';
import {
  createWavHeader,
  pcmToArrayBuffer,
  startAudioCapture,
  type AudioCapture,
} from './audio-capture';
import {
  createRealtimeSpeechSession,
  transcribeShortSpeech,
  type RealtimeSpeechSession,
} from './speech-client';
import {
  containsAudibleVoice,
  shouldStopForRealtimeSilence,
} from './voice-activity';

type VoiceMode = 'realtime' | 'short';
type StopReason = 'limit' | 'manual' | 'silence';
type VoiceState =
  | 'connecting'
  | 'error'
  | 'idle'
  | 'processing'
  | 'recording-realtime'
  | 'recording-short'
  | 'requesting'
  | 'success';

interface VoiceInputButtonProps {
  disabled?: boolean;
  onInterimTranscript?: (text: string) => void;
  onTranscript: (text: string) => void;
}

const MAX_RECORDING_MS = 60_000;
const REALTIME_CONNECT_TIMEOUT_MS = 10_000;
const REALTIME_RESULT_TIMEOUT_MS = 30_000;
const STREAMING_WAV_LENGTH = 0x7ffff000;

function microphoneIcon(recording: boolean) {
  if (recording) return <span className="voice-stop-icon" aria-hidden="true" />;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M6.5 11.5v.5a5.5 5.5 0 0 0 11 0v-.5M12 17.5V21M9 21h6" />
    </svg>
  );
}

function waveformIcon(recording: boolean) {
  if (recording) return <span className="voice-stop-icon" aria-hidden="true" />;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 10v4M9 6v12M13 3v18M17 7v10M21 10v4" />
    </svg>
  );
}

export function VoiceInputButton({
  disabled = false,
  onInterimTranscript,
  onTranscript,
}: VoiceInputButtonProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<VoiceState>('idle');
  const captureRef = useRef<AudioCapture | null>(null);
  const lastVoiceActivityAtRef = useRef(0);
  const modeRef = useRef<VoiceMode | null>(null);
  const realtimeConnectTimeoutRef = useRef<number | null>(null);
  const realtimeReadyRef = useRef(false);
  const realtimeRef = useRef<RealtimeSpeechSession | null>(null);
  const realtimeResultTimeoutRef = useRef<number | null>(null);
  const queuedChunksRef = useRef<ArrayBuffer[]>([]);
  const transcriptRef = useRef('');
  const startedAtRef = useRef(0);
  const stoppedForSilenceRef = useRef(false);
  const stopRef = useRef<(reason?: StopReason) => void>(() => undefined);

  const isRecording = state === 'recording-realtime' || state === 'recording-short';
  const isBusy = state === 'connecting' || state === 'processing' || state === 'requesting';

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedSeconds(Math.min(60, Math.floor(elapsed / 1000)));
      if (elapsed >= MAX_RECORDING_MS) {
        stopRef.current('limit');
        return;
      }
      if (
        state === 'recording-realtime'
        && shouldStopForRealtimeSilence(lastVoiceActivityAtRef.current, Date.now())
      ) {
        stopRef.current('silence');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording, state]);

  useEffect(
    () => () => {
      clearRealtimeTimeouts();
      void captureRef.current?.stop();
      realtimeRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (state !== 'success') return;
    const timer = window.setTimeout(() => {
      setMessage('');
      setState('idle');
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  function clearRealtimeTimeouts() {
    if (realtimeConnectTimeoutRef.current !== null) {
      window.clearTimeout(realtimeConnectTimeoutRef.current);
      realtimeConnectTimeoutRef.current = null;
    }
    if (realtimeResultTimeoutRef.current !== null) {
      window.clearTimeout(realtimeResultTimeoutRef.current);
      realtimeResultTimeoutRef.current = null;
    }
  }

  function resetResources() {
    clearRealtimeTimeouts();
    captureRef.current = null;
    realtimeRef.current = null;
    realtimeReadyRef.current = false;
    queuedChunksRef.current = [];
    modeRef.current = null;
  }

  function finishWithTranscript(text: string, formulaFormatted: boolean) {
    const transcript = text.trim();
    const stoppedForSilence = stoppedForSilenceRef.current;
    void captureRef.current?.stop();
    resetResources();
    if (!transcript) {
      setMessage(
        stoppedForSilence
          ? '长时间未检测到声音，已自动结束。没有识别到清晰语音。'
          : '没有识别到清晰语音，请靠近麦克风再试一次。',
      );
      stoppedForSilenceRef.current = false;
      setState('error');
      return;
    }
    onTranscript(transcript);
    const resultMessage = formulaFormatted
      ? '公式已整理，请检查后发送。'
      : '已保留识别原文，请检查后发送。';
    setMessage(stoppedForSilence ? `长时间未检测到声音，已自动结束。${resultMessage}` : resultMessage);
    stoppedForSilenceRef.current = false;
    setState('success');
  }

  function fail(error: unknown) {
    void captureRef.current?.stop();
    realtimeRef.current?.close();
    resetResources();
    stoppedForSilenceRef.current = false;
    const fallback = error instanceof DOMException && error.name === 'NotAllowedError'
      ? '没有麦克风权限，请在浏览器设置中允许后重试。'
      : error instanceof DOMException && error.name === 'AbortError'
        ? '语音识别超时，已结束录音，请重试。'
      : error instanceof Error && error.message
        ? error.message
        : '语音识别失败，请重试。';
    setMessage(fallback);
    setState('error');
  }

  async function start(mode: VoiceMode) {
    modeRef.current = mode;
    setState('requesting');
    setMessage('正在请求麦克风权限…');
    setElapsedSeconds(0);
    transcriptRef.current = '';
    stoppedForSilenceRef.current = false;
    lastVoiceActivityAtRef.current = Date.now();

    try {
      const capture = await startAudioCapture((pcm) => {
        if (modeRef.current !== 'realtime') return;
        if (containsAudibleVoice(pcm)) lastVoiceActivityAtRef.current = Date.now();
        const chunk = pcmToArrayBuffer(pcm);
        if (realtimeReadyRef.current) realtimeRef.current?.sendAudio(chunk);
        else queuedChunksRef.current.push(chunk);
      });
      captureRef.current = capture;
      startedAtRef.current = Date.now();

      if (mode === 'short') {
        setMessage('正在录音，结束后统一识别。');
        setState('recording-short');
        return;
      }

      setMessage('正在连接实时识别…');
      setState('connecting');
      const realtimeSession = createRealtimeSpeechSession({
        onDone(text, formulaFormatted) {
          if (modeRef.current !== 'realtime') return;
          finishWithTranscript(text || transcriptRef.current, formulaFormatted);
        },
        onError(errorMessage) {
          if (modeRef.current !== 'realtime') return;
          fail(new Error(errorMessage));
        },
        onReady() {
          if (modeRef.current !== 'realtime') return;
          if (realtimeConnectTimeoutRef.current !== null) {
            window.clearTimeout(realtimeConnectTimeoutRef.current);
            realtimeConnectTimeoutRef.current = null;
          }
          realtimeReadyRef.current = true;
          lastVoiceActivityAtRef.current = Date.now();
          realtimeRef.current?.sendAudio(createWavHeader(STREAMING_WAV_LENGTH));
          for (const chunk of queuedChunksRef.current.splice(0)) {
            realtimeRef.current?.sendAudio(chunk);
          }
          setMessage('实时转写中，停止后整理公式。');
          setState('recording-realtime');
          startedAtRef.current = Date.now();
        },
        onTranscript(text) {
          if (modeRef.current !== 'realtime') return;
          transcriptRef.current = text;
          onInterimTranscript?.(text);
        },
      });
      realtimeRef.current = realtimeSession;
      if (!realtimeReadyRef.current) {
        realtimeConnectTimeoutRef.current = window.setTimeout(() => {
          if (modeRef.current !== 'realtime' || realtimeReadyRef.current) return;
          fail(new Error('实时语音连接超时，已结束录音，请重试。'));
        }, REALTIME_CONNECT_TIMEOUT_MS);
      }
    } catch (error) {
      fail(error);
    }
  }

  async function stop(reason: StopReason = 'manual') {
    const mode = modeRef.current;
    if (!mode || !captureRef.current || state === 'processing') return;
    stoppedForSilenceRef.current = reason === 'silence';
    setState('processing');
    setMessage(
      reason === 'silence'
        ? '长时间未检测到声音，正在自动结束…'
        : mode === 'short'
          ? '正在识别并整理数学公式…'
          : '正在整理数学公式…',
    );

    try {
      const wav = await captureRef.current.stop();
      captureRef.current = null;
      if (mode === 'short') {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        try {
          const draft = await transcribeShortSpeech(wav, controller.signal);
          finishWithTranscript(draft.transcript, draft.formulaFormatted);
        } finally {
          window.clearTimeout(timeout);
        }
      } else {
        realtimeRef.current?.finish();
        if (modeRef.current === 'realtime' && realtimeRef.current) {
          realtimeResultTimeoutRef.current = window.setTimeout(() => {
            if (modeRef.current !== 'realtime') return;
            const transcript = transcriptRef.current.trim();
            if (transcript) onTranscript(transcript);
            fail(new Error(
              transcript
                ? '公式整理超时，已保留实时识别原文，请检查后重试。'
                : '公式整理超时，没有识别到清晰语音，请重试。',
            ));
          }, REALTIME_RESULT_TIMEOUT_MS);
        }
      }
    } catch (error) {
      fail(error);
    }
  }
  stopRef.current = (reason) => void stop(reason);

  function handleMode(mode: VoiceMode) {
    if (isRecording) {
      if (modeRef.current === mode) void stop();
      return;
    }
    if (!isBusy) void start(mode);
  }

  return (
    <div className="voice-input" role="group" aria-label="语音输入">
      {state !== 'idle' && (
        <span
          className="voice-inline-status"
          data-error={state === 'error'}
          role="status"
          aria-live="polite"
          title={message}
        >
          {isRecording
            ? `${state === 'recording-realtime' ? '实时' : '长语音'} 00:${elapsedSeconds.toString().padStart(2, '0')}`
            : message}
        </span>
      )}
      <button
        className="voice-input-trigger voice-input-trigger-long"
        type="button"
        aria-label={state === 'recording-short' ? '停止长语音录音' : '长语音'}
        aria-pressed={state === 'recording-short'}
        data-recording={state === 'recording-short'}
        data-tooltip="长语音"
        disabled={disabled || isBusy || (isRecording && modeRef.current !== 'short')}
        title="长语音：录完后识别"
        onClick={() => handleMode('short')}
      >
        {microphoneIcon(state === 'recording-short')}
      </button>

      <button
        className="voice-input-trigger voice-input-trigger-realtime"
        type="button"
        aria-label={state === 'recording-realtime' ? '停止实时语音录音' : '实时语音'}
        aria-pressed={state === 'recording-realtime'}
        data-recording={state === 'recording-realtime'}
        data-tooltip="实时语音"
        disabled={disabled || isBusy || (isRecording && modeRef.current !== 'realtime')}
        title="实时语音：边说边识别"
        onClick={() => handleMode('realtime')}
      >
        {waveformIcon(state === 'recording-realtime')}
      </button>
    </div>
  );
}
