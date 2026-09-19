import { Module } from '@nestjs/common';
import { ModelModule } from '../../model/model.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AssessmentController } from './assessment.controller.js';
import { AssessmentRepository } from './assessment.repository.js';
import { AssessmentService } from './assessment.service.js';

@Module({
  imports: [AuthModule, ModelModule],
  controllers: [AssessmentController],
  providers: [AssessmentRepository, AssessmentService],
})
export class AssessmentModule {}
