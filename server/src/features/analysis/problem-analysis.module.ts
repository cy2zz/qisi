import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProblemAnalysisController } from './problem-analysis.controller.js';
import { ProblemAnalysisService } from './problem-analysis.service.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [ProblemAnalysisController],
  providers: [ProblemAnalysisService],
})
export class ProblemAnalysisModule {}
