import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export interface PaperFilters {
  keyword?: string;
  region?: string;
  track?: '文科' | '理科' | '综合';
  year?: number;
}

interface StoredImageMetadata {
  height?: number;
  url?: string;
  width?: number;
}

interface StoredPaperMetadata {
  introImage?: StoredImageMetadata | null;
  questionCount?: number;
  session?: string | null;
  track?: string;
  variant?: string;
}

interface StoredQuestionMetadata {
  questionImage?: StoredImageMetadata;
}

function parseMetadata<T extends object>(value: unknown): T {
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  return {} as T;
}

@Injectable()
export class BankRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listFilterOptions() {
    const rows = await this.database.client
      .selectFrom('paper')
      .select(['exam_year', 'metadata_json', 'region'])
      .where('status', '!=', 'invalid')
      .execute();
    const years = [...new Set(rows.map((row) => row.exam_year))].sort((a, b) => b - a);
    const regions = [...new Set(rows.flatMap((row) => (row.region ? [row.region] : [])))].sort(
      (left, right) => left.localeCompare(right, 'zh-CN'),
    );
    const tracks = [
      ...new Set(
        rows.flatMap((row) => {
          const track = parseMetadata<StoredPaperMetadata>(row.metadata_json).track;
          return track ? [track] : [];
        }),
      ),
    ].sort((left, right) => left.localeCompare(right, 'zh-CN'));

    return { regions, tracks, years };
  }

  async listPapers(filters: PaperFilters) {
    let query = this.database.client
      .selectFrom('paper')
      .select([
        'id',
        'title',
        'exam_year',
        'exam_type',
        'subject',
        'region',
        'is_official',
        'metadata_json',
        'status',
      ])
      .where('status', '!=', 'invalid');

    if (filters.year !== undefined) query = query.where('exam_year', '=', filters.year);
    if (filters.region) query = query.where('region', '=', filters.region);
    if (filters.keyword) query = query.where('title', 'like', `%${filters.keyword}%`);

    const rows = await query.orderBy('exam_year', 'desc').orderBy('title', 'asc').execute();
    const papers = rows.flatMap((row) => {
      const metadata = parseMetadata<StoredPaperMetadata>(row.metadata_json);
      if (filters.track && metadata.track !== filters.track) return [];
      return [
        {
          examType: row.exam_type,
          examYear: row.exam_year,
          id: String(row.id),
          introImageUrl: metadata.introImage?.url ?? null,
          isOfficial: row.is_official === 1,
          questionCount: metadata.questionCount ?? 0,
          region: row.region,
          session: metadata.session ?? null,
          status: row.status,
          subject: row.subject,
          title: row.title,
          track: metadata.track ?? '综合',
          variant: metadata.variant ?? null,
        },
      ];
    });
    return { papers, total: papers.length };
  }

  async getPaper(paperId: string) {
    const paper = await this.database.client
      .selectFrom('paper')
      .select([
        'id',
        'title',
        'exam_year',
        'exam_type',
        'subject',
        'region',
        'is_official',
        'metadata_json',
        'status',
      ])
      .where('id', '=', paperId)
      .executeTakeFirst();
    if (!paper) return undefined;

    const questions = await this.database.client
      .selectFrom('paper_question as relation')
      .innerJoin('question as question', 'question.id', 'relation.question_id')
      .select([
        'question.id',
        'question.question_code',
        'question.statement_markdown',
        'question.question_image_url',
        'question.metadata_json',
        'question.status',
        'relation.question_number',
      ])
      .where('relation.paper_id', '=', paperId)
      .orderBy('relation.question_number', 'asc')
      .orderBy('relation.id', 'asc')
      .execute();
    const paperMetadata = parseMetadata<StoredPaperMetadata>(paper.metadata_json);

    return {
      examType: paper.exam_type,
      examYear: paper.exam_year,
      id: String(paper.id),
      introImageUrl: paperMetadata.introImage?.url ?? null,
      isOfficial: paper.is_official === 1,
      questions: questions.map((question) => {
        const metadata = parseMetadata<StoredQuestionMetadata>(question.metadata_json);
        return {
          id: String(question.id),
          imageHeight: metadata.questionImage?.height ?? null,
          imageWidth: metadata.questionImage?.width ?? null,
          number: question.question_number,
          questionCode: question.question_code,
          questionImageUrl: question.question_image_url,
          statementMarkdown: question.statement_markdown,
          status: question.status,
        };
      }),
      region: paper.region,
      session: paperMetadata.session ?? null,
      status: paper.status,
      subject: paper.subject,
      title: paper.title,
      track: paperMetadata.track ?? '综合',
      variant: paperMetadata.variant ?? null,
    };
  }
}
