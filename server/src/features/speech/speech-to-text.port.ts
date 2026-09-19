export const SPEECH_TO_TEXT_PORT = Symbol('SPEECH_TO_TEXT_PORT');

export interface SpeechToTextPort {
  createRealtimeUrl(): string;
  transcribeWav(audio: Buffer): Promise<string>;
}
