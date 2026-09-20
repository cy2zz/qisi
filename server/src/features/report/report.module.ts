import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
