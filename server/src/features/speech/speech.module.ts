import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SpeechController } from './speech.controller.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import { SpeechRealtimeGateway } from './speech-realtime.gateway.js';
import { SPEECH_TO_TEXT_PORT } from './speech-to-text.port.js';
import { TEXT_TO_SPEECH_PORT } from './text-to-speech.port.js';
import { YoudaoSpeechAdapter } from './youdao-speech.adapter.js';
import { VolcengineTtsAdapter } from './volcengine-tts.adapter.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [SpeechController],
  providers: [
    YoudaoSpeechAdapter,
    SpeechMathFormatterService,
    SpeechRealtimeGateway,
    VolcengineTtsAdapter,
    { provide: SPEECH_TO_TEXT_PORT, useExisting: YoudaoSpeechAdapter },
    { provide: TEXT_TO_SPEECH_PORT, useExisting: VolcengineTtsAdapter },
  ],
  exports: [SpeechRealtimeGateway],
})
export class SpeechModule {}
