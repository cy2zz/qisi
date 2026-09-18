import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import type { UserRepository } from './user.repository.js';

function createRepository() {
  return {
    findByTokenHash: vi.fn(),
    upsertAndRotateToken: vi.fn(),
  };
}

describe('AuthService', () => {
  it('normalizes a username and stores only the token hash', async () => {
    const repository = createRepository();
    repository.upsertAndRotateToken.mockResolvedValue({
      id: '7',
      username: '高三A班-01',
    });
    const service = new AuthService(repository as unknown as UserRepository);

    const result = await service.login('  高三Ａ班-01  ');

    expect(repository.upsertAndRotateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        username: '高三A班-01',
        usernameNormalized: '高三a班-01',
        tokenHash: expect.any(Buffer),
      }),
    );
    expect(repository.upsertAndRotateToken.mock.calls[0]?.[0].tokenHash).toHaveLength(32);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.user).toEqual({ id: '7', username: '高三A班-01' });
  });

  it('rejects usernames containing unsupported characters', async () => {
    const repository = createRepository();
    const service = new AuthService(repository as unknown as UserRepository);

    await expect(service.login('<script>')).rejects.toMatchObject({ status: 400 });
    expect(repository.upsertAndRotateToken).not.toHaveBeenCalled();
  });

  it('authenticates a cookie token by its hash', async () => {
    const repository = createRepository();
    repository.findByTokenHash.mockResolvedValue({ id: '9', username: '小林' });
    const service = new AuthService(repository as unknown as UserRepository);

    await expect(service.authenticate('a'.repeat(43))).resolves.toEqual({
      id: '9',
      username: '小林',
    });
    expect(repository.findByTokenHash).toHaveBeenCalledWith(expect.any(Buffer));
    expect(repository.findByTokenHash.mock.calls[0]?.[0]).toHaveLength(32);
  });
});
