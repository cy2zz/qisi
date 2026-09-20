import { Module } from '@nestjs/common';
import { PreparationAgent } from '../../agents/preparation/index.js';
import { Guard } from '../../agents/guard/index.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ModelModule } from '../../model/model.module.js';
import { PreparationRepository } from './preparation.repository.js';
import { PreparationService } from './preparation.service.js';

@Module({
  exports: [PreparationService],
  imports: [DatabaseModule, ModelModule],
  providers: [Guard, PreparationAgent, PreparationRepository, PreparationService],
})
export class PreparationModule {}
