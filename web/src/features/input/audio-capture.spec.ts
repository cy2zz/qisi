import { describe, expect, it } from 'vitest';
import { createWavFile, createWavHeader, downsampleTo16Khz } from './audio-capture';

describe('voice audio encoding', () => {
  it('downsamples browser audio to signed 16-bit 16kHz mono PCM', () => {
    const source = new Float32Array(48_000).fill(0.5);
    const pcm = downsampleTo16Khz(source, 48_000);

    expect(pcm).toHaveLength(16_000);
    expect(pcm[0]).toBeGreaterThan(16_000);
  });

  it('creates the WAV header required by the Youdao realtime protocol', () => {
    const header = new DataView(createWavHeader(320));
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(header.buffer, offset, length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(16_000);
    expect(header.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(header.getUint32(40, true)).toBe(320);
  });

  it('combines captured PCM chunks into a valid short-recognition WAV file', async () => {
    const wav = createWavFile([new Int16Array([1, -1]), new Int16Array([2, -2])]);
    const bytes = new Uint8Array(await wav.arrayBuffer());

    expect(wav.type).toBe('audio/wav');
    expect(bytes).toHaveLength(52);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(8);
  });
});
