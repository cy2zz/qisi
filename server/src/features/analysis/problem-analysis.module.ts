import { Module } from '@nestjs/common';
import { DiagnosisAgent } from '../../agents/diagnosis/index.js';
import { Guard } from '../../agents/guard/index.js';
import { PreparationAgent } from '../../agents/preparation/index.js';
import { Renderer } from '../../agents/renderer/index.js';
import { StrategyAgent } from '../../agents/strategy/index.js';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BankModule } from '../bank/bank.module.js';
import { MediaModule } from '../media/media.module.js';
import { LearningSessionModule } from '../learning/learning-session.module.js';
import { PreparationModule } from '../preparation/preparation.module.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

@Module({
  imports: [
    AuthModule,
    BankModule,
    LearningSessionModule,
    MediaModule,
    ModelModule,
    PreparationModule,
  ],
  controllers: [ProblemAnalysisController],
  providers: [
    DiagnosisAgent,
    Guard,
    PreparationAgent,
    ProblemAnalysisService,
    Renderer,
    StrategyAgent,
  ],
})
export class ProblemAnalysisModule {}
