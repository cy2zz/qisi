export interface TextToSpeechPort {
  synthesize(text: string): Promise<Buffer>;
}

export const TEXT_TO_SPEECH_PORT = Symbol('TEXT_TO_SPEECH_PORT');
