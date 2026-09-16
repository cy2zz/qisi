import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { AppEnvironment } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppEnvironment, true>);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
