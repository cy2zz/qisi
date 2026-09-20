import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import { MediaController } from './media.controller.js';
import type { MediaService } from './media.service.js';
import type { QuestionImageRecognitionService } from './question-image-recognition.service.js';

function createController() {
  const auth = { authenticate: vi.fn().mockResolvedValue({ id: '7', username: '小林' }) };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) =>
      key === 'WEB_ORIGIN' ? 'http://localhost:5173' : undefined,
    ),
  };
  const recognition = {
    recognize: vi.fn().mockResolvedValue({
      answerMarkdown: null,
      questionType: '函数题',
      stemMarkdown: '已知 $f(x)=x^2$。',
      uncertain: [],
    }),
  };
  const media = {
    confirmTranscript: vi.fn(),
    readOwnedMedia: vi.fn(),
    transcribeHandwriting: vi.fn(),
  };

  return {
    auth,
    controller: new MediaController(
      auth as unknown as AuthService,
      config as unknown as ConfigService<AppEnvironment, true>,
      recognition as unknown as QuestionImageRecognitionService,
      media as unknown as MediaService,
    ),
    media,
    recognition,
  };
}

describe('MediaController', () => {
  it('authenticates, decodes and recognizes a question image', async () => {
    const { auth, controller, recognition } = createController();
    const image = await sharp({
      create: { background: '#ffffff', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();

    await expect(
      controller.recognizeQuestion(
        image,
        'image/png',
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
        'http://localhost:5173',
      ),
    ).resolves.toMatchObject({ recognition: { questionType: '函数题' } });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(recognition.recognize).toHaveBeenCalledWith(
      expect.objectContaining({ mime: 'image/png' }),
    );
  });

  it('rejects cross-origin and fake images before recognition', async () => {
    const { controller, recognition } = createController();

    await expect(
      controller.recognizeQuestion(
        Buffer.from('bad'),
        'image/png',
        undefined,
        'https://attacker.example',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.recognizeQuestion(
        Buffer.from('bad'),
        'image/png',
        undefined,
        'http://localhost:5173',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recognition.recognize).not.toHaveBeenCalled();
  });

  it('creates an owner-scoped handwriting draft and confirms its reviewed revision', async () => {
    const { controller, media } = createController();
    const image = await sharp({
      create: { background: '#ffffff', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();
    const draft = {
      confirmed: false,
      id: '41',
      lines: [{ explicitly_confirmed: false, index: 1, text: '$x=1$', uncertain: false }],
      media_id: '31',
      revision: 1,
    };
    media.transcribeHandwriting.mockResolvedValue({ transcript: draft });
    media.confirmTranscript.mockResolvedValue({ ...draft, confirmed: true, revision: 2 });

    await expect(controller.transcribeHandwriting(
      image,
      '91',
      'image/png',
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      'http://localhost:5173',
    )).resolves.toEqual({ transcript: draft });
    expect(media.transcribeHandwriting).toHaveBeenCalledWith(
      '7',
      '91',
      expect.objectContaining({ mime: 'image/png' }),
    );

    await expect(controller.confirmTranscript(
      '41',
      {
        expected_revision: 1,
        lines: draft.lines,
        request_id: '7cd1cc14-35b3-4e73-8c0a-ad9223330ad8',
        transcript_id: '41',
      },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      'http://localhost:5173',
    )).resolves.toMatchObject({ confirmed: true, revision: 2 });
  });
});
