import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import { LearningSessionController } from './learning-session.controller.js';
import type { LearningSessionService } from './learning-session.service.js';

function createController() {
  const auth = {
    authenticate: vi.fn().mockResolvedValue({ id: '7', username: '小林' }),
  };
  const sessions = {
    updateRemediationTrack: vi.fn().mockImplementation(
      (_ownerId: string, _sessionId: string, focus: string | null) => ({
        remediationFocus: focus,
      }),
    ),
  };

  return {
    controller: new LearningSessionController(
      auth as unknown as AuthService,
      sessions as unknown as LearningSessionService,
    ),
    sessions,
  };
}

describe('LearningSessionController remediation track', () => {
  it('persists a controlled remediation focus for the authenticated owner', async () => {
    const { controller, sessions } = createController();

    await expect(controller.updateRemediationTrack(
      '12',
      { focus: 'execution' },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
    )).resolves.toEqual({ remediationFocus: 'execution' });

    expect(sessions.updateRemediationTrack).toHaveBeenCalledWith('7', '12', 'execution');
  });

  it('persists an explicit exit and rejects unknown focus values', async () => {
    const { controller, sessions } = createController();

    await expect(controller.updateRemediationTrack(
      '12',
      { focus: null },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
    )).resolves.toEqual({ remediationFocus: null });
    await expect(controller.updateRemediationTrack(
      '12',
      { focus: 'whole_solution' },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(sessions.updateRemediationTrack).toHaveBeenCalledTimes(1);
    expect(sessions.updateRemediationTrack).toHaveBeenCalledWith('7', '12', null);
  });
});
