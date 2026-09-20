import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module.js';
import type { AppEnvironment } from './config/env.js';
import { allowedWebOrigins } from './config/web-origin.js';
import { SpeechRealtimeGateway } from './features/speech/speech-realtime.gateway.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppEnvironment, true>);

  app.setGlobalPrefix('api');
  app.use(
    '/api/media/recognize-question',
    raw({ limit: '8mb', type: ['image/jpeg', 'image/png', 'image/webp'] }),
  );
  app.use(
    '/api/media/handwriting',
    raw({ limit: '8mb', type: ['image/jpeg', 'image/png', 'image/webp'] }),
  );
  app.use('/api/speech/transcribe', raw({ limit: '2mb', type: 'audio/wav' }));
  app.enableCors({
    origin: allowedWebOrigins(config.get('WEB_ORIGIN', { infer: true })),
    credentials: true,
  });
  app.enableShutdownHooks();
  app.get(SpeechRealtimeGateway).attach(app.getHttpServer());

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
