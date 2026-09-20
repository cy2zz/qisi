import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { BankRepository } from './bank.repository.js';
import { BankService } from './bank.service.js';

const scope = {
  bankVersion: 'exam-bank@2026-09-20T00:00:00.000Z',
  invalidCount: 1,
  needsReviewCount: 2,
  paperCount: 1,
  readyCount: 2,
  selectableCount: 2,
  totalCount: 5,
  unreadableCount: 0,
  updatedAt: '2026-09-20T00:00:00.000Z',
};

const candidates = [
  { paper: { id: '41', title: '北京卷' }, question: { id: '801', number: 1 } },
  { paper: { id: '41', title: '北京卷' }, question: { id: '802', number: 2 } },
];

function createService() {
  const repository = {
    listPapers: vi.fn().mockResolvedValue({ papers: [{ id: '41' }], total: 1 }),
    listQuestionPool: vi.fn().mockResolvedValue({ candidates, scope }),
  };
  return {
    repository,
    service: new BankService(repository as unknown as BankRepository),
  };
}

describe('BankService random selection', () => {
  it('returns scope metadata with the paper list', async () => {
    const { service } = createService();

    await expect(service.listPapers({ region: '北京' })).resolves.toEqual({
      papers: [{ id: '41' }],
      scope,
      total: 1,
    });
  });

  it('replays one draw for the same user, request id and filters', async () => {
    const { repository, service } = createService();
    const input = {
      filters: { region: '北京' },
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a001',
    };

    const first = await service.drawRandomQuestion('7', input);
    const retried = await service.drawRandomQuestion('7', input);

    expect(retried).toEqual(first);
    expect(candidates).toContainEqual(first.selection);
    expect(repository.listQuestionPool).toHaveBeenCalledOnce();
  });

  it('rejects reuse of a request id with a different scope', async () => {
    const { service } = createService();
    const requestId = '018f15b8-0b48-7f8a-9db6-4415b775a001';
    await service.drawRandomQuestion('7', { filters: { region: '北京' }, requestId });

    await expect(service.drawRandomQuestion('7', {
      filters: { region: '上海' },
      requestId,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps an empty scope empty instead of silently changing filters', async () => {
    const { repository, service } = createService();
    repository.listQuestionPool.mockResolvedValue({
      candidates: [],
      scope: { ...scope, paperCount: 0, readyCount: 0, selectableCount: 0, totalCount: 0 },
    });

    await expect(service.drawRandomQuestion('7', {
      filters: { keyword: '不存在的试卷' },
      requestId: '018f15b8-0b48-7f8a-9db6-4415b775a002',
    })).resolves.toMatchObject({
      scope: { selectableCount: 0, totalCount: 0 },
      selection: null,
    });
  });
});
