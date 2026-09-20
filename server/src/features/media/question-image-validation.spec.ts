import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_IMAGE_BYTES,
  validateQuestionImage,
} from './question-image-validation.js';

describe('validateQuestionImage', () => {
  it('fully decodes a supported image and returns its trusted mime and dimensions', async () => {
    const image = await sharp({
      create: { background: '#ffffff', channels: 3, height: 12, width: 20 },
    }).png().toBuffer();

    await expect(validateQuestionImage(image, 'image/png')).resolves.toMatchObject({
      height: 12,
      mime: 'image/png',
      width: 20,
    });
  });

  it('rejects fake images and mismatched declared types', async () => {
    await expect(
      validateQuestionImage(Buffer.from('not-an-image'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const jpeg = await sharp({
      create: { background: '#ffffff', channels: 3, height: 2, width: 2 },
    }).jpeg().toBuffer();
    await expect(validateQuestionImage(jpeg, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects oversized byte payloads and SVG before model recognition', async () => {
    await expect(
      validateQuestionImage(Buffer.alloc(MAX_QUESTION_IMAGE_BYTES + 1), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateQuestionImage(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
        'image/svg+xml',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects decoded images above the 20 million pixel limit', async () => {
    const image = await sharp({
      create: { background: '#ffffff', channels: 3, height: 4_001, width: 5_000 },
    }).png().toBuffer();

    await expect(validateQuestionImage(image, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
