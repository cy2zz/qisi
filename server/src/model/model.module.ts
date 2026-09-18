import { Module } from '@nestjs/common';
import { MODEL_PORT } from './model.port.js';
import { OpenAiCompatibleModelPort } from './openai-compatible-model.port.js';

@Module({
  providers: [{ provide: MODEL_PORT, useClass: OpenAiCompatibleModelPort }],
  exports: [MODEL_PORT],
})
export class ModelModule {}
