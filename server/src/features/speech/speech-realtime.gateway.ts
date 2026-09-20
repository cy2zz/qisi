import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AppEnvironment } from '../../config/env.js';
import { isAllowedWebOrigin } from '../../config/web-origin.js';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import { SPEECH_TO_TEXT_PORT, type SpeechToTextPort } from './speech-to-text.port.js';
import { isYoudaoRecognitionFinished } from './youdao-speech.adapter.js';

const REALTIME_PATH = '/api/speech/realtime';
const MAX_STREAM_BYTES = 2_100_000;

interface YoudaoSegment {
  seg_id?: unknown;
  st?: {
    partial?: unknown;
    sentence?: unknown;
    type?: unknown;
  };
}

function rejectUpgrade(socket: Duplex, status: 401 | 403 | 503) {
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Service Unavailable';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sendJson(socket: WebSocket, value: object) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rawDataToBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  throw new Error('unsupported websocket payload');
}

@Injectable()
export class SpeechRealtimeGateway {
  private attached = false;
  private readonly server = new WebSocketServer({ maxPayload: 128 * 1024, noServer: true });

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(SPEECH_TO_TEXT_PORT) private readonly speech: SpeechToTextPort,
    @Inject(SpeechMathFormatterService) private readonly formatter: SpeechMathFormatterService,
  ) {}

  attach(httpServer: Server) {
    if (this.attached) return;
    this.attached = true;

    httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== REALTIME_PATH) return;

      if (!isAllowedWebOrigin(
        request.headers.origin,
        this.config.get('WEB_ORIGIN', { infer: true }),
      )) {
        rejectUpgrade(socket, 403);
        return;
      }

      void this.authenticateUpgrade(request)
        .then(() => {
          this.server.handleUpgrade(request, socket, head, (client) => {
            this.handleClient(client);
          });
        })
        .catch(() => rejectUpgrade(socket, 401));
    });

    httpServer.once('close', () => this.server.close());
  }

  private async authenticateUpgrade(request: IncomingMessage) {
    await this.auth.authenticate(readCookie(request.headers.cookie, AUTH_COOKIE_NAME));
  }

  private handleClient(client: WebSocket) {
    let upstream: WebSocket;
    try {
      upstream = new WebSocket(this.speech.createRealtimeUrl());
    } catch {
      sendJson(client, { message: '语音识别尚未配置', type: 'error' });
      client.close(1011, 'speech unavailable');
      return;
    }

    let totalBytes = 0;
    let completed = false;
    const queuedAudio: Buffer[] = [];
    const segments = new Map<number, string>();

    const closeWithError = (message: string) => {
      if (completed) return;
      completed = true;
      sendJson(client, { message, type: 'error' });
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
      client.close(1011, 'speech error');
    };

    client.on('message', (data, isBinary) => {
      if (!isBinary) {
        closeWithError('语音数据格式不正确');
        return;
      }
      const chunk = rawDataToBuffer(data);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_STREAM_BYTES) {
        closeWithError('单次语音输入不能超过 60 秒');
        return;
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(chunk, { binary: true });
      else if (upstream.readyState === WebSocket.CONNECTING) queuedAudio.push(chunk);
    });

    client.once('close', () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    });

    upstream.once('open', () => {
      for (const chunk of queuedAudio.splice(0)) upstream.send(chunk, { binary: true });
    });

    upstream.on('message', (data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(rawDataToBuffer(data).toString('utf8')) as Record<string, unknown>;
      } catch {
        closeWithError('语音服务返回了无法解析的结果');
        return;
      }

      if (message.action === 'started' && message.errorCode === '0') {
        sendJson(client, { type: 'ready' });
        return;
      }
      if (isYoudaoRecognitionFinished(message)) {
        upstream.close();
        return;
      }
      if (message.action === 'error' || (message.errorCode && message.errorCode !== '0')) {
        closeWithError('语音识别暂时不可用，请重试');
        return;
      }
      if (message.action !== 'recognition' || !Array.isArray(message.result)) return;

      let isFinal = false;
      for (const item of message.result as YoudaoSegment[]) {
        const id = typeof item.seg_id === 'number' ? item.seg_id : undefined;
        const sentence = typeof item.st?.sentence === 'string' ? item.st.sentence.trim() : '';
        if (id === undefined || !sentence) continue;
        segments.set(id, sentence);
        if (item.st?.type === 0 || item.st?.partial === false) isFinal = true;
      }
      const transcript = [...segments.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text)
        .join('')
        .trim();
      if (transcript) sendJson(client, { final: isFinal, text: transcript, type: 'transcript' });
    });

    upstream.once('error', () => closeWithError('无法连接语音识别服务，请重试'));
    upstream.once('close', () => {
      if (completed) return;
      completed = true;
      const rawTranscript = [...segments.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text)
        .join('')
        .trim();
      void this.formatter.format(rawTranscript).then((draft) => {
        sendJson(client, {
          formulaFormatted: draft.formatted,
          rawTranscript,
          text: draft.markdown,
          type: 'done',
        });
        client.close(1000, 'complete');
      });
    });
  }
}
