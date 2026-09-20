import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  BankRepository,
  type BankScope,
  type PaperFilters,
  type QuestionSelection,
} from './bank.repository.js';

export interface RandomQuestionInput {
  filters: PaperFilters;
  requestId: string;
}

export interface RandomQuestionResponse {
  requestId: string;
  scope: BankScope;
  selection: QuestionSelection | null;
}

interface CachedRandomQuestion {
  expiresAt: number;
  payload: string;
  response: RandomQuestionResponse;
}

const RANDOM_RESULT_TTL_MS = 10 * 60 * 1000;
const MAX_RANDOM_RESULTS = 500;

@Injectable()
export class BankService {
  private readonly randomResults = new Map<string, CachedRandomQuestion>();

  constructor(@Inject(BankRepository) private readonly repository: BankRepository) {}

  listFilterOptions() {
    return this.repository.listFilterOptions();
  }

  async listPapers(filters: PaperFilters) {
    const [paperList, pool] = await Promise.all([
      this.repository.listPapers(filters),
      this.repository.listQuestionPool(filters),
    ]);
    return { ...paperList, scope: pool.scope };
  }

  async drawRandomQuestion(userId: string, input: RandomQuestionInput) {
    this.pruneRandomResults();
    const cacheKey = `${userId}:${input.requestId}`;
    const payload = JSON.stringify({
      keyword: input.filters.keyword ?? null,
      region: input.filters.region ?? null,
      track: input.filters.track ?? null,
      year: input.filters.year ?? null,
    });
    const cached = this.randomResults.get(cacheKey);
    if (cached) {
      if (cached.payload !== payload) {
        throw new ConflictException('random request already used with different filters');
      }
      return cached.response;
    }

    const pool = await this.repository.listQuestionPool(input.filters);
    const selection = pool.candidates.length > 0
      ? pool.candidates[randomInt(pool.candidates.length)] ?? null
      : null;
    const response = { requestId: input.requestId, scope: pool.scope, selection };
    this.randomResults.set(cacheKey, {
      expiresAt: Date.now() + RANDOM_RESULT_TTL_MS,
      payload,
      response,
    });
    if (this.randomResults.size > MAX_RANDOM_RESULTS) {
      const oldestKey = this.randomResults.keys().next().value as string | undefined;
      if (oldestKey) this.randomResults.delete(oldestKey);
    }
    return response;
  }

  getPaper(paperId: string) {
    return this.repository.getPaper(paperId);
  }

  getQuestionForAnalysis(questionId: string) {
    return this.repository.getQuestionForAnalysis(questionId);
  }

  private pruneRandomResults() {
    const now = Date.now();
    for (const [key, value] of this.randomResults) {
      if (value.expiresAt <= now) this.randomResults.delete(key);
    }
  }
}
