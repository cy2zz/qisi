import { ApiError } from '../../lib/api';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export interface RealtimeSpeechCallbacks {
  onDone: (text: string, formulaFormatted: boolean) => void;
  onError: (message: string) => void;
  onReady: () => void;
  onTranscript: (text: string, final: boolean) => void;
}

export interface RealtimeSpeechSession {
  close(): void;
  finish(): void;
  sendAudio(chunk: ArrayBuffer): void;
}

export interface SpeechDraft {
  formulaFormatted: boolean;
  transcript: string;
}

function websocketUrl(path: string) {
  const url = new URL(`${apiBaseUrl}${path}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function transcribeShortSpeech(wav: Blob, signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/speech/transcribe`, {
    body: wav,
    credentials: 'include',
    headers: { 'Content-Type': 'audio/wav' },
    method: 'POST',
    signal,
  });
  if (!response.ok) throw new ApiError(response.status);
  const result = (await response.json()) as {
    formulaFormatted?: unknown;
    transcript?: unknown;
  };
  if (typeof result.transcript !== 'string' || !result.transcript.trim()) {
    throw new Error('没有识别到清晰语音');
  }
  return {
    formulaFormatted: result.formulaFormatted === true,
    transcript: result.transcript.trim(),
  };
}

export function createRealtimeSpeechSession(
  callbacks: RealtimeSpeechCallbacks,
): RealtimeSpeechSession {
  const socket = new WebSocket(websocketUrl('/api/speech/realtime'));
  let completed = false;
  let closedByClient = false;

  socket.addEventListener('message', (event) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      callbacks.onError('语音服务返回了无法解析的结果');
      return;
    }

    if (message.type === 'ready') callbacks.onReady();
    if (message.type === 'transcript' && typeof message.text === 'string') {
      callbacks.onTranscript(message.text, message.final === true);
    }
    if (message.type === 'done') {
      completed = true;
      callbacks.onDone(
        typeof message.text === 'string' ? message.text : '',
        message.formulaFormatted === true,
      );
    }
    if (message.type === 'error') {
      completed = true;
      callbacks.onError(
        typeof message.message === 'string' ? message.message : '实时语音识别失败，请重试',
      );
    }
  });
  socket.addEventListener('error', () => {
    if (!completed && !closedByClient) callbacks.onError('无法连接语音识别服务，请重试');
  });
  socket.addEventListener('close', () => {
    if (!completed && !closedByClient) callbacks.onError('实时语音连接已中断，请重试');
  });

  return {
    close() {
      closedByClient = true;
      socket.close();
    },
    finish() {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(new TextEncoder().encode('{"end": "true"}'));
      }
    },
    sendAudio(chunk) {
      if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
    },
  };
}
