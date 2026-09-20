import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Headers,
} from '@nestjs/common';
import { z } from 'zod';
import { AUTH_COOKIE_NAME, readCookie } from '../auth/auth.cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { BankService } from './bank.service.js';

const filterSchema = z
  .object({
    keyword: z.string().trim().min(1).max(100).optional(),
    region: z.string().trim().min(1).max(64).optional(),
    track: z.enum(['文科', '理科', '综合']).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

const paperIdSchema = z.string().regex(/^[1-9]\d*$/);
const randomQuestionSchema = z
  .object({
    filters: filterSchema,
    requestId: z.string().uuid(),
  })
  .strict();

@Controller('bank')
export class BankController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BankService) private readonly bank: BankService,
  ) {}

  @Get('filters')
  @Header('Cache-Control', 'no-store')
  async listFilterOptions(@Headers('cookie') cookieHeader: string | undefined) {
    await this.authenticate(cookieHeader);
    return this.bank.listFilterOptions();
  }

  @Get('papers')
  @Header('Cache-Control', 'no-store')
  async listPapers(
    @Query() query: Record<string, unknown>,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const parsed = filterSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('invalid paper filters');
    await this.authenticate(cookieHeader);
    return this.bank.listPapers(parsed.data);
  }

  @Get('papers/:paperId')
  @Header('Cache-Control', 'no-store')
  async getPaper(
    @Param('paperId') paperId: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const parsedId = paperIdSchema.safeParse(paperId);
    if (!parsedId.success) throw new BadRequestException('invalid paper id');
    await this.authenticate(cookieHeader);
    const paper = await this.bank.getPaper(parsedId.data);
    if (!paper) throw new NotFoundException('paper not found');
    return paper;
  }

  @Post('questions/random')
  @Header('Cache-Control', 'no-store')
  async drawRandomQuestion(
    @Body() body: unknown,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const parsed = randomQuestionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid random question request');
    const user = await this.authenticate(cookieHeader);
    return this.bank.drawRandomQuestion(user.id, parsed.data);
  }

  private async authenticate(cookieHeader: string | undefined) {
    return this.auth.authenticate(readCookie(cookieHeader, AUTH_COOKIE_NAME));
  }
}
