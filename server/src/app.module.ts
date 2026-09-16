import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { environmentFilePaths, parseEnvironment } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: environmentFilePaths(),
      validate: parseEnvironment,
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
