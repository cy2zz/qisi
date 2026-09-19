import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';
import { DeleteService } from '../../shared/delete.js';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController],
  providers: [DeleteService, HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
