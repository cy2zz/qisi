import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import type { DeleteService } from '../../shared/delete.js';
import { HistoryController } from './history.controller.js';
import type { HistoryService } from './history.service.js';

function createController() {
  const auth = {
    authenticate: vi.fn().mockResolvedValue({ id: '7', username: '小林' }),
  };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) =>
      key === 'WEB_ORIGIN' ? 'http://localhost:5173' : undefined,
    ),
  };
  const deletion = {
    deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
  };
  const history = { getHistory: vi.fn() };

  return {
    auth,
    controller: new HistoryController(
      auth as unknown as AuthService,
      config as unknown as ConfigService<AppEnvironment, true>,
      deletion as unknown as DeleteService,
      history as unknown as HistoryService,
    ),
    deletion,
  };
}

describe('HistoryController deletion', () => {
  it('deletes only after same-origin authentication and explicit confirmation', async () => {
    const { auth, controller, deletion } = createController();

    await expect(controller.deleteSession(
      '12',
      { confirm: true },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      'http://localhost:5173',
    )).resolves.toEqual({ deleted: true });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(deletion.deleteSession).toHaveBeenCalledWith('7', '12');
  });

  it('rejects cross-origin and unconfirmed deletion before mutating data', async () => {
    const { controller, deletion } = createController();

    await expect(controller.deleteSession(
      '12',
      { confirm: true },
      undefined,
      'https://attacker.example',
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.deleteSession(
      '12',
      { confirm: false },
      undefined,
      'http://localhost:5173',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(deletion.deleteSession).not.toHaveBeenCalled();
  });
});
