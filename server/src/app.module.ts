import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { environmentFilePaths, parseEnvironment } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { ProblemAnalysisModule } from './features/analysis/problem-analysis.module.js';
import { BankModule } from './features/bank/bank.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: environmentFilePaths(),
      validate: parseEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    BankModule,
    ProblemAnalysisModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
