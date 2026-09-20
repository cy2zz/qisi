import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIE_NAME } from '../auth/auth.cookie.js';
import type { AuthService } from '../auth/auth.service.js';
import { BankController } from './bank.controller.js';
import type { BankService } from './bank.service.js';

function createController() {
  const auth = { authenticate: vi.fn() };
  const bank = {
    drawRandomQuestion: vi.fn(),
    getPaper: vi.fn(),
    listFilterOptions: vi.fn(),
    listPapers: vi.fn(),
  };
  return {
    auth,
    bank,
    controller: new BankController(
      auth as unknown as AuthService,
      bank as unknown as BankService,
    ),
  };
}

describe('BankController', () => {
  it('authenticates and validates year, region, track and keyword filters', async () => {
    const { auth, bank, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.listPapers.mockResolvedValue({ papers: [], total: 0 });

    await expect(
      controller.listPapers(
        { keyword: '北京', region: '北京', track: '综合', year: '2024' },
        `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
      ),
    ).resolves.toEqual({ papers: [], total: 0 });

    expect(auth.authenticate).toHaveBeenCalledWith('a'.repeat(43));
    expect(bank.listPapers).toHaveBeenCalledWith({
      keyword: '北京',
      region: '北京',
      track: '综合',
      year: 2024,
    });
  });

  it('rejects invalid filters before querying the database', async () => {
    const { bank, controller } = createController();

    await expect(controller.listPapers({ year: '20xx' }, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bank.listPapers).not.toHaveBeenCalled();
  });

  it('returns paper questions without exposing analysis images', async () => {
    const { auth, bank, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getPaper.mockResolvedValue({
      id: '1',
      questions: [
        {
          id: '2',
          imageHeight: 425,
          imageWidth: 1600,
          number: 1,
          questionImageUrl: 'https://example.test/question.png',
          status: 'ready',
        },
      ],
      title: '2020年高考数学试卷（北京）',
    });

    const response = await controller.getPaper(
      '1',
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
    );

    expect(JSON.stringify(response)).not.toContain('analysis');
    expect(bank.getPaper).toHaveBeenCalledWith('1');
  });

  it('returns not found when a paper id is absent', async () => {
    const { auth, bank, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.getPaper.mockResolvedValue(undefined);

    await expect(
      controller.getPaper('999', `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('draws once from the explicit scope without accepting a client candidate list', async () => {
    const { auth, bank, controller } = createController();
    auth.authenticate.mockResolvedValue({ id: '7', username: '小林' });
    bank.drawRandomQuestion.mockResolvedValue({
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
      scope: { bankVersion: 'exam-bank@2026-09-20T00:00:00.000Z', selectableCount: 12 },
      selection: { paper: { id: '41' }, question: { id: '801' } },
    });

    await expect(controller.drawRandomQuestion(
      {
        filters: { region: '北京', track: '综合', year: 2024 },
        requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
      },
      `${AUTH_COOKIE_NAME}=${'a'.repeat(43)}`,
    )).resolves.toMatchObject({
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
      selection: { question: { id: '801' } },
    });

    expect(bank.drawRandomQuestion).toHaveBeenCalledWith('7', {
      filters: { region: '北京', track: '综合', year: 2024 },
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
    });
  });

  it('rejects a client-supplied random candidate list', async () => {
    const { bank, controller } = createController();

    await expect(controller.drawRandomQuestion({
      candidates: ['801'],
      filters: {},
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
    }, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(bank.drawRandomQuestion).not.toHaveBeenCalled();
  });
});
