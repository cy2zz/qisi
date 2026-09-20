import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { ModelImage, ModelImageMime } from '../../model/model.port.js';

export const MAX_QUESTION_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const supportedMimeByFormat: Record<string, ModelImageMime | undefined> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ValidatedQuestionImage extends ModelImage {
  height: number;
  width: number;
}

export async function validateQuestionImage(
  body: unknown,
  declaredMime: string | undefined,
): Promise<ValidatedQuestionImage> {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_QUESTION_IMAGE_BYTES) {
    throw new BadRequestException('图片必须小于 8MB');
  }

  try {
    const image = sharp(body, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    const mime = metadata.format ? supportedMimeByFormat[metadata.format] : undefined;
    const width = metadata.width;
    const height = metadata.height;
    if (
      !mime ||
      declaredMime !== mime ||
      !width ||
      !height ||
      width * height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new Error('unsupported image metadata');
    }

    await image.clone().stats();
    return { bytes: new Uint8Array(body), height, mime, width };
  } catch {
    throw new BadRequestException('只支持可正常打开的 JPEG、PNG 或 WebP 图片，且不能超过 2000 万像素');
  }
}
