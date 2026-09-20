import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { config as loadEnvironmentFile } from 'dotenv';
import { environmentFilePaths, parseEnvironment } from '../src/config/env.js';
import { createDatabase } from '../src/database/database.factory.js';

type AnalyzeResponse = {
  analysis?: unknown;
  preparation?: { cached?: unknown; status?: unknown };
  problemMd?: unknown;
  session?: { id?: unknown; version?: unknown };
};

async function main() {
  for (const environmentFile of environmentFilePaths()) {
    loadEnvironmentFile({ path: environmentFile, override: false, quiet: true });
  }
  const environment = parseEnvironment(process.env);
  const database = createDatabase(environment);
  const apiBaseUrl = `http://127.0.0.1:${environment.PORT}/api`;
  const username = `备课图片实测-${Date.now()}`;
  let userId: string | null = null;

  try {
    const question = await database
      .selectFrom('question')
      .select(['id', 'analysis_image_url', 'question_image_url'])
      .where('status', '=', 'ready')
      .where('analysis_image_url', 'is not', null)
      .where('question_image_url', 'is not', null)
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (!question?.analysis_image_url || !question.question_image_url) {
      throw new Error('no ready bank question with question and solution images');
    }

    const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      body: JSON.stringify({ username }),
      headers: {
        'Content-Type': 'application/json',
        Origin: environment.WEB_ORIGIN,
      },
      method: 'POST',
    });
    if (!loginResponse.ok) throw new Error(`live login failed: HTTP ${loginResponse.status}`);
    const login = await loginResponse.json() as { user?: { id?: unknown } };
    userId = typeof login.user?.id === 'string' ? login.user.id : null;
    const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
    if (!userId || !cookie) throw new Error('live login did not return a user and cookie');

    const analysisResponse = await fetch(`${apiBaseUrl}/problems/analyze`, {
      body: JSON.stringify({
        content: `![题库题目](${question.question_image_url})`,
        problemMd: '题库图片',
        questionId: String(question.id),
        title: '真实题库备课图片验证',
      }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: environment.WEB_ORIGIN,
      },
      method: 'POST',
    });
    if (!analysisResponse.ok) {
      const detail = await analysisResponse.text();
      throw new Error(`live bank preparation failed: HTTP ${analysisResponse.status} ${detail}`);
    }
    const result = await analysisResponse.json() as AnalyzeResponse;
    if (
      !result.analysis
      || typeof result.problemMd !== 'string'
      || typeof result.session?.id !== 'string'
      || (
        result.preparation?.status !== 'ready'
        && result.preparation?.status !== 'needs_review'
        && result.preparation?.status !== 'unavailable'
      )
    ) {
      throw new Error('live bank preparation returned an invalid public response');
    }

    const event = await database
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', result.session.id)
      .where('event_type', '=', 'preparation_bound')
      .executeTakeFirst();
    const eventPayload = (typeof event?.payload_json === 'string'
      ? JSON.parse(event.payload_json)
      : event?.payload_json) as { packetVersion?: unknown; status?: unknown } | undefined;
    if (eventPayload?.status !== result.preparation.status) {
      throw new Error('public preparation status does not match the bound session event');
    }

    if (result.preparation.status === 'unavailable') {
      console.info(JSON.stringify({
        cached: false,
        packetBound: false,
        questionId: String(question.id),
        status: 'unavailable',
      }));
      return;
    }

    const problemHash = createHash('sha256').update(result.problemMd).digest();
    if (typeof eventPayload.packetVersion !== 'string') {
      throw new Error('prepared packet version was not recorded in the session event');
    }
    const packet = await database
      .selectFrom('packets')
      .select(['status', 'version'])
      .where('problem_hash', '=', problemHash)
      .where('version', '=', eventPayload.packetVersion)
      .executeTakeFirst();
    if (!packet || packet.status !== result.preparation.status) {
      throw new Error('prepared packet was not persisted with the public review status');
    }
    if (eventPayload.packetVersion !== packet.version) {
      throw new Error('prepared packet version was not bound to the learning session');
    }

    console.info(JSON.stringify({
      cached: result.preparation.cached === true,
      packetBound: packet.status === 'ready',
      questionId: String(question.id),
      status: packet.status,
    }));
  } finally {
    if (userId) await database.deleteFrom('users').where('id', '=', userId).execute();
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Live bank preparation verification failed');
  process.exitCode = 1;
});
