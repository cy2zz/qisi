import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SpeechController } from './speech.controller.js';
import { SpeechMathFormatterService } from './speech-math-formatter.service.js';
import { SpeechRealtimeGateway } from './speech-realtime.gateway.js';
import { SPEECH_TO_TEXT_PORT } from './speech-to-text.port.js';
import { YoudaoSpeechAdapter } from './youdao-speech.adapter.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [SpeechController],
  providers: [
    YoudaoSpeechAdapter,
    SpeechMathFormatterService,
    SpeechRealtimeGateway,
    { provide: SPEECH_TO_TEXT_PORT, useExisting: YoudaoSpeechAdapter },
  ],
  exports: [SpeechRealtimeGateway],
})
export class SpeechModule {}
