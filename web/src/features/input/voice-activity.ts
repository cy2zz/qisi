export const REALTIME_SILENCE_TIMEOUT_MS = 8_000;

const AUDIBLE_MEAN_AMPLITUDE = 600;

export function containsAudibleVoice(pcm: Int16Array) {
  if (pcm.length === 0) return false;
  let amplitude = 0;
  for (const sample of pcm) amplitude += Math.abs(sample);
  return amplitude / pcm.length >= AUDIBLE_MEAN_AMPLITUDE;
}

export function shouldStopForRealtimeSilence(lastVoiceAt: number, now: number) {
  return now - lastVoiceAt >= REALTIME_SILENCE_TIMEOUT_MS;
}
