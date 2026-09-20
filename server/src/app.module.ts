import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { environmentFilePaths, parseEnvironment } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { ProblemAnalysisModule } from './features/analysis/problem-analysis.module.js';
import { BankModule } from './features/bank/bank.module.js';
import { MediaModule } from './features/media/media.module.js';
import { SpeechModule } from './features/speech/speech.module.js';
import { ReportModule } from './features/report/report.module.js';
import { LearningSessionModule } from './features/learning/learning-session.module.js';
import { AssessmentModule } from './features/assessment/assessment.module.js';
import { HistoryModule } from './features/history/history.module.js';
import { TutorModule } from './features/tutor/tutor.module.js';

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
    AssessmentModule,
    BankModule,
    HistoryModule,
    LearningSessionModule,
    MediaModule,
    ProblemAnalysisModule,
    SpeechModule,
    ReportModule,
    TutorModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
