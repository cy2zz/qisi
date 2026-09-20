import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  MAX_QUESTION_IMAGE_BYTES,
  validateQuestionImage,
  type ValidatedQuestionImage,
} from './question-image-validation.js';

const QUESTION_IMAGE_HOST = 'qisi-main.oss-cn-hangzhou.aliyuncs.com';
const QUESTION_IMAGE_PATH_PREFIX = '/历年试题/';
const QUESTION_IMAGE_TIMEOUT_MS = 15_000;

function assertTrustedQuestionImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== QUESTION_IMAGE_HOST ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      !decodedPath.startsWith(QUESTION_IMAGE_PATH_PREFIX)
    ) {
      throw new Error('untrusted question image URL');
    }
  } catch {
    throw new BadGatewayException('题库图片地址不受信任');
  }
}

async function readLimitedBody(response: Response) {
  if (!response.body) throw new BadGatewayException('题库图片响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_QUESTION_IMAGE_BYTES) {
      await reader.cancel();
      throw new BadGatewayException('题库图片超过 8MB');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

@Injectable()
export class QuestionImageLoader {
  async load(imageUrl: string): Promise<ValidatedQuestionImage> {
    assertTrustedQuestionImageUrl(imageUrl);

    try {
      const response = await fetch(imageUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(QUESTION_IMAGE_TIMEOUT_MS),
      });
      if (!response.ok) throw new BadGatewayException('题库图片读取失败');

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_QUESTION_IMAGE_BYTES) {
        throw new BadGatewayException('题库图片超过 8MB');
      }

      const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      const body = await readLimitedBody(response);
      return await validateQuestionImage(body, mime);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('题库图片暂时无法读取或格式无效');
    }
  }
}
