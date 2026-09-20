import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';
import { DeleteService } from '../../shared/delete.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [HistoryController],
  providers: [DeleteService, HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
