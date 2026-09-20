import { BadGatewayException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionImageLoader } from './question-image-loader.js';

const trustedUrl =
  'https://qisi-main.oss-cn-hangzhou.aliyuncs.com/%E5%8E%86%E5%B9%B4%E8%AF%95%E9%A2%98/2025/question.png';

describe('QuestionImageLoader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads and fully validates a trusted permanent OSS question image', async () => {
    const image = await sharp({
      create: { background: '#ffffff', channels: 3, height: 12, width: 20 },
    }).png().toBuffer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(image, {
        headers: { 'Content-Length': String(image.byteLength), 'Content-Type': 'image/png' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new QuestionImageLoader().load(trustedUrl)).resolves.toMatchObject({
      height: 12,
      mime: 'image/png',
      width: 20,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      trustedUrl,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects arbitrary hosts and oversized responses before decoding', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const loader = new QuestionImageLoader();

    await expect(loader.load('https://attacker.example/历年试题/question.png')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(
      new Response('too large', {
        headers: { 'Content-Length': String(8 * 1024 * 1024 + 1), 'Content-Type': 'image/png' },
        status: 200,
      }),
    );
    await expect(loader.load(trustedUrl)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
