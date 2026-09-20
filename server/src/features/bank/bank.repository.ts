import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export interface PaperFilters {
  keyword?: string;
  region?: string;
  track?: '文科' | '理科' | '综合';
  year?: number;
}

export interface BankScope {
  bankVersion: string;
  invalidCount: number;
  needsReviewCount: number;
  paperCount: number;
  readyCount: number;
  selectableCount: number;
  totalCount: number;
  unreadableCount: number;
  updatedAt: string | null;
}

export interface PaperSummary {
  examType: string;
  examYear: number;
  id: string;
  introImageUrl: string | null;
  isOfficial: boolean;
  questionCount: number;
  region: string | null;
  session: string | null;
  status: string;
  subject: string;
  title: string;
  track: string;
  variant: string | null;
}

export interface BankQuestion {
  id: string;
  imageHeight: number | null;
  imageWidth: number | null;
  number: number | null;
  questionCode: string | null;
  questionImageUrl: string | null;
  statementMarkdown: string | null;
  status: string;
}

export interface QuestionSelection {
  paper: PaperSummary;
  question: BankQuestion;
}

export interface QuestionPool {
  candidates: QuestionSelection[];
  scope: BankScope;
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
  analysisImage?: StoredImageMetadata;
  knowledgePointTags?: string[];
  paperSourceFile?: string;
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

function dateValue(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class BankRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listFilterOptions() {
    const rows = await this.database.client
      .selectFrom('paper')
      .select(['exam_year', 'metadata_json', 'region'])
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
      ]);

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

  async listQuestionPool(filters: PaperFilters): Promise<QuestionPool> {
    const rows = await this.database.client
      .selectFrom('paper_question as relation')
      .innerJoin('paper as paper', 'paper.id', 'relation.paper_id')
      .innerJoin('question as question', 'question.id', 'relation.question_id')
      .select([
        'paper.id as paper_id',
        'paper.title as paper_title',
        'paper.exam_year',
        'paper.exam_type',
        'paper.subject',
        'paper.region',
        'paper.is_official',
        'paper.metadata_json as paper_metadata_json',
        'paper.status as paper_status',
        'paper.db_update_time as paper_update_time',
        'question.id as question_id',
        'question.question_code',
        'question.statement_markdown',
        'question.question_image_url',
        'question.metadata_json as question_metadata_json',
        'question.status as question_status',
        'question.db_update_time as question_update_time',
        'relation.question_number',
      ])
      .orderBy('paper.id', 'asc')
      .orderBy('relation.question_number', 'asc')
      .orderBy('relation.id', 'asc')
      .execute();

    const latestUpdate = rows.reduce<Date | string | null>((latest, row) => {
      const candidate = dateValue(row.paper_update_time) >= dateValue(row.question_update_time)
        ? row.paper_update_time
        : row.question_update_time;
      return !latest || dateValue(candidate) > dateValue(latest) ? candidate : latest;
    }, null);
    const matchedRows = rows.filter((row) => {
      const metadata = parseMetadata<StoredPaperMetadata>(row.paper_metadata_json);
      if (filters.year !== undefined && row.exam_year !== filters.year) return false;
      if (filters.region && row.region !== filters.region) return false;
      if (filters.track && metadata.track !== filters.track) return false;
      if (filters.keyword && !row.paper_title.includes(filters.keyword)) return false;
      return true;
    });
    const paperIds = new Set(matchedRows.map((row) => String(row.paper_id)));
    let invalidCount = 0;
    let needsReviewCount = 0;
    let readyCount = 0;
    let unreadableCount = 0;

    const candidates = matchedRows.flatMap((row) => {
      const readable = Boolean(row.question_image_url || row.statement_markdown?.trim());
      if (!readable) unreadableCount += 1;
      if (row.question_status === 'ready') readyCount += 1;
      else if (row.question_status === 'invalid') invalidCount += 1;
      else needsReviewCount += 1;
      if (row.question_status !== 'ready' || !readable) return [];

      const paperMetadata = parseMetadata<StoredPaperMetadata>(row.paper_metadata_json);
      const questionMetadata = parseMetadata<StoredQuestionMetadata>(row.question_metadata_json);
      return [{
        paper: {
          examType: row.exam_type,
          examYear: row.exam_year,
          id: String(row.paper_id),
          introImageUrl: paperMetadata.introImage?.url ?? null,
          isOfficial: row.is_official === 1,
          questionCount: paperMetadata.questionCount ?? 0,
          region: row.region,
          session: paperMetadata.session ?? null,
          status: row.paper_status,
          subject: row.subject,
          title: row.paper_title,
          track: paperMetadata.track ?? '综合',
          variant: paperMetadata.variant ?? null,
        },
        question: {
          id: String(row.question_id),
          imageHeight: questionMetadata.questionImage?.height ?? null,
          imageWidth: questionMetadata.questionImage?.width ?? null,
          number: row.question_number,
          questionCode: row.question_code,
          questionImageUrl: row.question_image_url,
          statementMarkdown: row.statement_markdown,
          status: row.question_status,
        },
      }];
    });
    const updatedAt = latestUpdate ? isoDate(latestUpdate) : null;

    return {
      candidates,
      scope: {
        bankVersion: updatedAt ? `exam-bank@${updatedAt}` : 'exam-bank@empty',
        invalidCount,
        needsReviewCount,
        paperCount: paperIds.size,
        readyCount,
        selectableCount: candidates.length,
        totalCount: matchedRows.length,
        unreadableCount,
        updatedAt,
      },
    };
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

  async getQuestionForAnalysis(questionId: string) {
    const question = await this.database.client
      .selectFrom('question')
      .select([
        'analysis_image_url',
        'analysis_markdown',
        'metadata_json',
        'question_code',
        'question_image_url',
        'statement_markdown',
        'status',
      ])
      .where('id', '=', questionId)
      .where('status', '!=', 'invalid')
      .executeTakeFirst();
    if (!question) return undefined;

    const paper = await this.database.client
      .selectFrom('paper_question as relation')
      .innerJoin('paper as paper', 'paper.id', 'relation.paper_id')
      .select(['paper.is_official', 'paper.paper_code', 'paper.title'])
      .where('relation.question_id', '=', questionId)
      .orderBy('relation.id', 'asc')
      .executeTakeFirst();
    const metadata = parseMetadata<StoredQuestionMetadata>(question.metadata_json);

    return {
      analysisImageUrl: question.analysis_image_url,
      analysisMarkdown: question.analysis_markdown,
      bankVersion: paper?.paper_code ?? metadata.paperSourceFile ?? 'unversioned-bank-question',
      isOfficial: paper?.is_official === 1,
      questionCode: question.question_code,
      questionImageUrl: question.question_image_url,
      source: paper?.title ?? metadata.paperSourceFile ?? question.question_code ?? `题库题目 ${questionId}`,
      statementMarkdown: question.statement_markdown,
      status: question.status === 'ready' ? 'ready' as const : 'needs_review' as const,
      topicTags: Array.isArray(metadata.knowledgePointTags)
        ? metadata.knowledgePointTags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    };
  }
}
