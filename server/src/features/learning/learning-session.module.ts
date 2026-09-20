import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LearningSessionController } from './learning-session.controller.js';
import { LearningSessionService } from './learning-session.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LearningSessionController],
  providers: [LearningSessionService],
  exports: [LearningSessionService],
})
export class LearningSessionModule {}
