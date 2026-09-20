import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type PlaybackStatus = 'ended' | 'error' | 'idle' | 'loading' | 'paused' | 'playing';

interface PlaybackState {
  activeId: string | null;
  muted: boolean;
  status: PlaybackStatus;
  volume: number;
}

interface ReadAloudContextValue extends PlaybackState {
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  toggle(id: string, text: string): Promise<void>;
}

interface ReadAloudButtonProps {
  id: string;
  label?: string;
  text: string;
}

const DEFAULT_VOLUME = 0.85;
const ReadAloudContext = createContext<ReadAloudContextValue | null>(null);

async function requestSpeech(text: string, signal: AbortSignal) {
  const response = await fetch('/api/speech/synthesize', {
    body: JSON.stringify({ text }),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('audio/')) {
    throw new Error('speech synthesis failed');
  }
  const audio = await response.blob();
  if (audio.size === 0) throw new Error('empty speech audio');
  return audio;
}

export function ReadAloudProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const lastNonZeroVolumeRef = useRef(DEFAULT_VOLUME);
  const [state, setState] = useState<PlaybackState>({
    activeId: null,
    muted: false,
    status: 'idle',
    volume: DEFAULT_VOLUME,
  });

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
  }, []);

  useEffect(() => () => {
    requestRef.current?.abort();
    releaseAudio();
  }, [releaseAudio]);

  const toggle = useCallback(async (id: string, text: string) => {
    const currentAudio = audioRef.current;
    if (state.activeId === id && currentAudio) {
      if (state.status === 'playing') {
        currentAudio.pause();
        return;
      }
      if (state.status === 'ended') currentAudio.currentTime = 0;
      try {
        await currentAudio.play();
      } catch {
        setState((current) => ({ ...current, status: 'paused' }));
      }
      return;
    }
    if (state.activeId === id && state.status === 'loading') return;

    requestRef.current?.abort();
    releaseAudio();
    const request = new AbortController();
    requestRef.current = request;
    setState((current) => ({ ...current, activeId: id, status: 'loading' }));

    try {
      const audioBlob = await requestSpeech(text, request.signal);
      if (request.signal.aborted) return;
      const sourceUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(sourceUrl);
      sourceUrlRef.current = sourceUrl;
      audioRef.current = audio;
      audio.preload = 'auto';
      audio.volume = state.volume;
      audio.muted = state.muted || state.volume === 0;
      audio.addEventListener('play', () => {
        setState((current) => current.activeId === id
          ? { ...current, status: 'playing' }
          : current);
      });
      audio.addEventListener('pause', () => {
        setState((current) => current.activeId === id && current.status === 'playing'
          ? { ...current, status: 'paused' }
          : current);
      });
      audio.addEventListener('ended', () => {
        setState((current) => current.activeId === id
          ? { ...current, status: 'ended' }
          : current);
      });
      audio.addEventListener('error', () => {
        setState((current) => current.activeId === id
          ? { ...current, status: 'error' }
          : current);
      });

      try {
        await audio.play();
      } catch {
        setState((current) => current.activeId === id
          ? { ...current, status: 'paused' }
          : current);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState((current) => current.activeId === id
        ? { ...current, status: 'error' }
        : current);
    }
  }, [releaseAudio, state.activeId, state.muted, state.status, state.volume]);

  const setVolume = useCallback((nextVolume: number) => {
    const volume = Math.min(1, Math.max(0, nextVolume));
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = volume === 0;
    }
    setState((current) => ({ ...current, muted: volume === 0, volume }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    const audio = audioRef.current;
    if (muted) {
      if (state.volume > 0) lastNonZeroVolumeRef.current = state.volume;
      if (audio) audio.muted = true;
      setState((current) => ({ ...current, muted: true }));
      return;
    }

    const restoredVolume = state.volume === 0 ? lastNonZeroVolumeRef.current : state.volume;
    if (audio) {
      audio.volume = restoredVolume;
      audio.muted = false;
    }
    setState((current) => ({ ...current, muted: false, volume: restoredVolume }));
  }, [state.volume]);

  const value = useMemo<ReadAloudContextValue>(() => ({
    ...state,
    setMuted,
    setVolume,
    toggle,
  }), [setMuted, setVolume, state, toggle]);

  return <ReadAloudContext.Provider value={value}>{children}</ReadAloudContext.Provider>;
}

function SpeakerIcon({ muted, playing }: { muted: boolean; playing: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 9.5v5h3.2l4.3 3.7V5.8L7.2 9.5H4Z" />
      {muted ? (
        <path d="m15.4 9.4 4.2 4.2m0-4.2-4.2 4.2" />
      ) : (
        <>
          <path d="M15 9a4.1 4.1 0 0 1 0 6" />
          {playing ? <path className="speech-wave" d="M18 6.4a8 8 0 0 1 0 11.2" /> : null}
        </>
      )}
    </svg>
  );
}

export function ReadAloudButton({ id, label = '朗读这段内容', text }: ReadAloudButtonProps) {
  const player = useContext(ReadAloudContext);
  if (!player) throw new Error('ReadAloudButton must be inside ReadAloudProvider');

  const active = player.activeId === id;
  const status = active ? player.status : 'idle';
  const buttonLabel = status === 'loading'
    ? '正在生成朗读'
    : status === 'playing'
      ? '暂停朗读'
      : status === 'paused'
        ? '继续朗读'
        : status === 'ended'
          ? '重新朗读'
          : status === 'error'
            ? '重新生成朗读'
            : label;

  return (
    <div className="read-aloud" data-active={active || undefined} data-status={status}>
      <button
        className="read-aloud-trigger"
        type="button"
        aria-label={buttonLabel}
        aria-pressed={status === 'playing'}
        disabled={status === 'loading'}
        title={buttonLabel}
        onClick={() => void player.toggle(id, text)}
      >
        <SpeakerIcon muted={active && player.muted} playing={status === 'playing'} />
      </button>

      {active && status !== 'idle' && status !== 'loading' && status !== 'error' ? (
        <div className="read-aloud-volume" role="group" aria-label="朗读音量控制">
          <button
            type="button"
            aria-label={player.muted ? '恢复音量' : '静音朗读'}
            title={player.muted ? '恢复音量' : '静音朗读'}
            onClick={() => player.setMuted(!player.muted)}
          >
            <SpeakerIcon muted={player.muted} playing={false} />
          </button>
          <input
            aria-label="朗读音量"
            aria-valuetext={`${Math.round(player.volume * 100)}%`}
            max="1"
            min="0"
            step="0.05"
            type="range"
            value={player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
          <output aria-live="polite">{Math.round(player.volume * 100)}%</output>
        </div>
      ) : null}

      {active && status === 'error' ? (
        <span className="read-aloud-error" role="status">朗读暂时不可用</span>
      ) : null}
    </div>
  );
}
