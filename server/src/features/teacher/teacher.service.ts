import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TeacherInputSchema } from '../../contracts/domain.schema.js';
import { TEACHER_OPTIONS, TEACHER_STORE, type TeacherOptions, type TeacherStorePort } from './teacher.port.js';
import { projectTeacherTrace } from './teacher.projection.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const TEACHER_COOKIE = 'qisi_teacher';
const TTL_MS = 15 * 60 * 1000;
@Injectable()
export class TeacherService {
 constructor(@Inject(TEACHER_STORE) readonly store: TeacherStorePort, @Inject(TEACHER_OPTIONS) readonly options: TeacherOptions) {
  if (!/^[0-9a-f]{64}$/.test(options.credentialSha256) || !options.teacherId || new URL(options.origin).origin !== options.origin) throw new Error('INVALID_TEACHER_CONFIG');
 }
 assertOrigin(origin: string | undefined): asserts origin is string {
  if (origin !== this.options.origin) throw new ForbiddenException('origin is not allowed');
 }
 async login(body: unknown, origin: string | undefined, rateKey: string) {
  this.assertOrigin(origin);
  if (!await this.store.consumeLoginAttempt(hash(rateKey), new Date().toISOString())) throw new HttpException('login rate limited', 429);
  const parsed = z.strictObject({ credential: z.string().min(32).max(256) }).safeParse(body);
  if (!parsed.success) throw new UnauthorizedException('teacher authentication required');
  if (!timingSafeEqual(Buffer.from(hash(parsed.data.credential), 'hex'), Buffer.from(this.options.credentialSha256, 'hex'))) throw new UnauthorizedException('teacher authentication required');
  const token = randomBytes(32).toString('base64url');
  await this.store.createTeacherSession(hash(token), { teacherId: this.options.teacherId, expiresAt: new Date(Date.now() + TTL_MS).toISOString() });
  return { token, maxAge: TTL_MS };
 }
 async logout(cookie: string | undefined, origin: string | undefined) {
  this.assertOrigin(origin);
  if (cookie && tokenSchema.safeParse(cookie).success) await this.store.revokeTeacherSession(hash(cookie));
 }
 async openTrace(body: unknown, cookie: string | undefined, origin: string | undefined, ownerToken?: string) {
  this.assertOrigin(origin);
  const input = TeacherInputSchema.safeParse(body);
  if (!input.success) throw new BadRequestException('invalid teacher request');
  if (!tokenSchema.safeParse(cookie).success) throw new UnauthorizedException('teacher authentication required');
  const teacherTokenHash = hash(cookie!);
  const teacher = await this.store.findTeacherSession(teacherTokenHash);
  if (!teacher || !(Date.parse(teacher.expiresAt) > Date.now())) throw new UnauthorizedException('teacher authentication required');
  const receipt = await this.store.openTraceChecked({ input: input.data, teacherTokenHash, teacherId: teacher.teacherId, origin, ownerToken, payloadHash: hash(JSON.stringify(input.data)) });
  // Fail closed if an adapter violates the exposure contract. No client DTO before await commit.
  if (receipt.sessionId !== input.data.session_id || receipt.exposure.committed !== true || receipt.exposure.scope !== 'whole_task' || receipt.exposure.taskId !== receipt.taskId || !Number.isInteger(receipt.version) || receipt.version !== input.data.expected_version + 1) throw new InternalServerErrorException('invalid trace commit');
  return projectTeacherTrace(receipt);
 }
}
