import { BadGatewayException, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import { SpeechController } from './speech.controller.js';
import type { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import type { SpeechToTextPort } from './speech-to-text.port.js';

function wavBuffer() {
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(40, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(4, 40);
  return wav;
}

function createController() {
  const auth = { authenticate: vi.fn().mockResolvedValue({ id: '7', username: '小林' }) };
  const speech: SpeechToTextPort = {
    createRealtimeUrl: vi.fn(),
    transcribeWav: vi.fn().mockResolvedValue('先求导'),
  };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) =>
      key === 'WEB_ORIGIN' ? 'http://localhost:5173' : undefined,
    ),
  };
  const formatter = {
    format: vi.fn().mockResolvedValue({
      formatted: true,
      markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$',
    }),
  };

  return {
    auth,
    controller: new SpeechController(
      auth as unknown as AuthService,
      config as unknown as ConfigService<AppEnvironment, true>,
      speech,
      formatter as unknown as SpeechMathFormatterService,
    ),
    formatter,
    speech,
  };
}

describe('SpeechController', () => {
  it('authenticates and formats a manually entered math draft', async () => {
    const { auth, controller, formatter } = createController();

    await expect(
      controller.formatMathDraft(
        { text: '根号2除以根号3等于多少？' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toEqual({
      formatted: true,
      markdown: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$',
    });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(formatter.format).toHaveBeenCalledWith('根号2除以根号3等于多少？');
  });

  it('rejects an empty manual draft before formatting', async () => {
    const { controller, formatter } = createController();

    await expect(
      controller.formatMathDraft(
        { text: '   ' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(formatter.format).not.toHaveBeenCalled();
  });

  it('authenticates and returns a short recognition draft', async () => {
    const { auth, controller, formatter, speech } = createController();
    const audio = wavBuffer();

    await expect(
      controller.transcribe(
        audio,
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toEqual({
      formulaFormatted: true,
      rawTranscript: '先求导',
      transcript: '$\\frac{\\sqrt{2}}{\\sqrt{3}}$',
    });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(speech.transcribeWav).toHaveBeenCalledWith(audio);
    expect(formatter.format).toHaveBeenCalledWith('先求导');
  });

  it('rejects cross-origin and malformed audio before calling the provider', async () => {
    const { controller, speech } = createController();

    await expect(
      controller.transcribe(Buffer.from('bad'), undefined, 'https://attacker.example'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.transcribe(Buffer.from('bad'), undefined, 'http://localhost:5173'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(speech.transcribeWav).not.toHaveBeenCalled();
  });

  it('maps provider failures to a retryable gateway error', async () => {
    const { controller, speech } = createController();
    vi.mocked(speech.transcribeWav).mockRejectedValue(new Error('provider failed'));

    await expect(
      controller.transcribe(wavBuffer(), undefined, 'http://localhost:5173'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
