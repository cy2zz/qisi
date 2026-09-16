import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Controller('health')
export class AppController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  liveness() {
    return {
      service: 'qisi-server',
      status: 'ok',
    };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.database.ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}
