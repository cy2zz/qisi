import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '../../config/env.js';
import { AUTH_COOKIE_NAME } from './auth.cookie.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

function createController(nodeEnvironment: AppEnvironment['NODE_ENV'] = 'development') {
  const auth = {
    authenticate: vi.fn(),
    login: vi.fn(),
  };
  const config = {
    get: vi.fn((key: keyof AppEnvironment) => {
      if (key === 'NODE_ENV') return nodeEnvironment;
      if (key === 'WEB_ORIGIN') return 'http://localhost:5173';
      return undefined;
    }),
  };
  const response = { cookie: vi.fn() };

  return {
    auth,
    controller: new AuthController(
      auth as unknown as AuthService,
      config as unknown as ConfigService<AppEnvironment, true>,
    ),
    response,
  };
}

describe('AuthController', () => {
  it('sets a long-lived HttpOnly cookie after login', async () => {
    const { auth, controller, response } = createController('production');
    auth.login.mockResolvedValue({
      token: 'a'.repeat(43),
      user: { id: '7', username: '小林' },
    });

    await expect(
      controller.login(
        { username: '小林' },
        'http://localhost:5173',
        response as unknown as Response,
      ),
    ).resolves.toEqual({ user: { id: '7', username: '小林' } });

    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'a'.repeat(43),
      expect.objectContaining({
        httpOnly: true,
        maxAge: 34_560_000_000,
        sameSite: 'lax',
        secure: true,
      }),
    );
  });

  it('rejects login mutations from another origin', async () => {
    const { controller, response } = createController();

    await expect(
      controller.login(
        { username: '小林' },
        'https://attacker.example',
        response as unknown as Response,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('restores a user from the cookie and renews it', async () => {
    const { auth, controller, response } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });

    await expect(
      controller.me(`other=value; ${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`, response as unknown as Response),
    ).resolves.toEqual({ user: { id: '7', username: '小林' } });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'a'.repeat(43),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: false }),
    );
  });
});
