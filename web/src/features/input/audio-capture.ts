const TARGET_SAMPLE_RATE = 16_000;

export interface AudioCapture {
  stop(): Promise<Blob>;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function createWavHeader(dataLength: number) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, dataLength + 36, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  return buffer;
}

export function downsampleTo16Khz(samples: Float32Array, sourceSampleRate: number) {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate < TARGET_SAMPLE_RATE) {
    throw new Error('当前设备的音频采样率不受支持');
  }
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((outputIndex + 1) * ratio)));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += samples[inputIndex] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function pcmToArrayBuffer(pcm: Int16Array) {
  const copy = new Uint8Array(pcm.byteLength);
  copy.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return copy.buffer;
}

export function createWavFile(chunks: Int16Array[]) {
  const dataLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  return new Blob(
    [createWavHeader(dataLength), ...chunks.map(pcmToArrayBuffer)],
    { type: 'audio/wav' },
  );
}

export async function startAudioCapture(onChunk?: (chunk: Int16Array) => void): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持麦克风录音');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error('当前浏览器不支持实时音频处理');
  }

  const context = new AudioContextConstructor();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentOutput = context.createGain();
  const chunks: Int16Array[] = [];
  let stopped = false;
  silentOutput.gain.value = 0;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const pcm = downsampleTo16Khz(event.inputBuffer.getChannelData(0), context.sampleRate);
    chunks.push(pcm);
    onChunk?.(pcm);
  };
  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);

  return {
    async stop() {
      if (!stopped) {
        stopped = true;
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        silentOutput.disconnect();
        for (const track of stream.getTracks()) track.stop();
        await context.close();
      }
      return createWavFile(chunks);
    },
  };
}
