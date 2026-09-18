import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { UserRepository } from './user.repository.js';

const usernameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\p{L}\p{N}_-]+$/u);

const cookieTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest();
}

@Injectable()
export class AuthService {
  constructor(@Inject(UserRepository) private readonly users: UserRepository) {}

  async login(input: unknown) {
    const username = typeof input === 'string' ? input.trim().normalize('NFKC') : '';
    const parsedUsername = usernameSchema.safeParse(username);

    if (!parsedUsername.success) {
      throw new BadRequestException('用户名需为 1–32 个中文、字母、数字、下划线或连字符');
    }

    const token = randomBytes(32).toString('base64url');
    const user = await this.users.upsertAndRotateToken({
      username: parsedUsername.data,
      usernameNormalized: parsedUsername.data.toLocaleLowerCase('zh-CN'),
      tokenHash: hashToken(token),
    });

    return { token, user };
  }

  async authenticate(token: string | undefined) {
    const parsedToken = cookieTokenSchema.safeParse(token);
    if (!parsedToken.success) {
      throw new UnauthorizedException('login required');
    }

    const user = await this.users.findByTokenHash(hashToken(parsedToken.data));
    if (!user) {
      throw new UnauthorizedException('login required');
    }

    return user;
  }
}
