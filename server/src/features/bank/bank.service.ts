import { Inject, Injectable } from '@nestjs/common';
import { BankRepository, type PaperFilters } from './bank.repository.js';

@Injectable()
export class BankService {
  constructor(@Inject(BankRepository) private readonly repository: BankRepository) {}

  listFilterOptions() {
    return this.repository.listFilterOptions();
  }

  listPapers(filters: PaperFilters) {
    return this.repository.listPapers(filters);
  }

  getPaper(paperId: string) {
    return this.repository.getPaper(paperId);
  }
}
