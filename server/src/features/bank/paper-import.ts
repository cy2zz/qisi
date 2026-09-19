import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { NormalizedPaper, NormalizedPaperQuestion } from './paper-manifest.js';

export interface PaperImportResult {
  papersInserted: number;
  papersUpdated: number;
  questionsInserted: number;
  questionsUpdated: number;
  relationsInserted: number;
  relationsUpdated: number;
}

function paperMetadata(paper: NormalizedPaper) {
  return JSON.stringify({
    introImage: paper.introImage,
    layout: paper.layout,
    notes: paper.notes,
    prefix: paper.prefix,
    questionCount: paper.questions.length,
    session: paper.session,
    sourceFile: paper.sourceFile,
    sourcePages: paper.sourcePages,
    sourcePdf: paper.sourcePdf,
    track: paper.track,
    variant: paper.variant,
  });
}

function questionMetadata(question: NormalizedPaperQuestion, paper: NormalizedPaper) {
  return JSON.stringify({
    analysisImage: question.analysisImage,
    knowledgePointTags: [],
    paperSourceFile: paper.sourceFile,
    questionImage: question.questionImage,
  });
}

export async function importPaperManifests(
  database: Kysely<Database>,
  papers: NormalizedPaper[],
): Promise<PaperImportResult> {
  const result: PaperImportResult = {
    papersInserted: 0,
    papersUpdated: 0,
    questionsInserted: 0,
    questionsUpdated: 0,
    relationsInserted: 0,
    relationsUpdated: 0,
  };

  await database.transaction().execute(async (transaction) => {
    for (const paper of papers) {
      const existingPaper = await transaction
        .selectFrom('paper')
        .select('id')
        .where('paper_code', '=', paper.paperCode)
        .orderBy('id')
        .executeTakeFirst();
      const values = {
        exam_type: '高考',
        exam_year: paper.examYear,
        is_official: paper.isOfficial ? 1 : 0,
        metadata_json: paperMetadata(paper),
        paper_code: paper.paperCode,
        region: paper.region,
        status: paper.questions.every((question) => question.status === 'ready')
          ? 'ready'
          : 'needs_review',
        subject: '数学',
        title: paper.title,
      };
      let paperId: string;
      if (existingPaper) {
        paperId = String(existingPaper.id);
        await transaction
          .updateTable('paper')
          .set({ ...values, db_update_time: sql`CURRENT_TIMESTAMP` })
          .where('id', '=', paperId)
          .execute();
        result.papersUpdated += 1;
      } else {
        const inserted = await transaction
          .insertInto('paper')
          .values(values)
          .executeTakeFirstOrThrow();
        paperId = String(inserted.insertId);
        result.papersInserted += 1;
      }

      for (const question of paper.questions) {
        const existingQuestion = await transaction
          .selectFrom('question')
          .select('id')
          .where('question_code', '=', question.questionCode)
          .orderBy('id')
          .executeTakeFirst();
        const questionValues = {
          analysis_image_object_key: question.analysisImage?.objectKey ?? null,
          analysis_image_url: question.analysisImage?.url ?? null,
          analysis_markdown: null,
          metadata_json: questionMetadata(question, paper),
          question_code: question.questionCode,
          question_image_object_key: question.questionImage.objectKey,
          question_image_url: question.questionImage.url,
          statement_markdown: null,
          status: question.status,
        };
        let questionId: string;
        if (existingQuestion) {
          questionId = String(existingQuestion.id);
          await transaction
            .updateTable('question')
            .set({ ...questionValues, db_update_time: sql`CURRENT_TIMESTAMP` })
            .where('id', '=', questionId)
            .execute();
          result.questionsUpdated += 1;
        } else {
          const inserted = await transaction
            .insertInto('question')
            .values(questionValues)
            .executeTakeFirstOrThrow();
          questionId = String(inserted.insertId);
          result.questionsInserted += 1;
        }

        const relation = await transaction
          .selectFrom('paper_question')
          .select('id')
          .where('paper_id', '=', paperId)
          .where('question_id', '=', questionId)
          .orderBy('id')
          .executeTakeFirst();
        const relationValues = {
          metadata_json: JSON.stringify({ sourceFile: paper.sourceFile }),
          paper_id: paperId,
          question_id: questionId,
          question_number: question.number,
        };
        if (relation) {
          await transaction
            .updateTable('paper_question')
            .set({ ...relationValues, db_update_time: sql`CURRENT_TIMESTAMP` })
            .where('id', '=', String(relation.id))
            .execute();
          result.relationsUpdated += 1;
        } else {
          await transaction.insertInto('paper_question').values(relationValues).execute();
          result.relationsInserted += 1;
        }
      }
    }
  });

  return result;
}
