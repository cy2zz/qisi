// 会话端口：把 A 的持久层接到 B 的教学轮上。
//
// 为什么需要这一层：A 的教学链路（/study + features/analysis）与 B 的四角色链路
// （features/tutor + workflows/turn）是两套数据模型。A 的 sessions 表存的是
// problem_markdown + analysis_json + learning_messages；B 的教学轮还需要
// Packet 里的决策图（用于算 canonical goal 与 knownDecisionKeys）。
//
// 两者靠 A 已经设计好的绑定连通：
//   sessions.id
//     → events(event_type='preparation_bound') 的 payload {problemHash, packetVersion}
//     → packets(problem_hash, version).packet_json  ← 就是 B 的 Packet
// 该绑定见 server/src/features/learning/learning-session.service.ts:260。
//
// currentGoal / 历史假设 / 探针 / 实际帮助从已提交事件与 probe_counters 恢复。
// 待对接：题库元数据仍未关联（占位 source/bank_version，is_official=false 不代表自拟题）；
// 独立检验 attempt / canStartCheck 需由 A 的 Assessment 门面提供，不能猜测学生已学会。
// 上述限制不是产品范围删减，也不是项目方已批准的降级。
//
// 本文件只读；写入统一经 LearningSessionService.commitTurn，不再允许只推进版本。

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { PacketSchema, TranscriptLineSchema, type Submission, type Packet } from '../../contracts/domain.schema.js';
import { DatabaseService } from '../../database/database.service.js';
import { CanonicalGoalRegistry } from './probe-counter.js';
import { restorePersistedTeaching } from './persisted-teaching.js';
import type { PrivateMessage } from './student-view.js';
import type { TutorSession, TutorSessionPort } from './tutor.service.js';

/** A 的 sessions.phase 取值与 B 的 StudentView.phase 不是同一套枚举，需映射。 */
const PHASE_MAP: Readonly<Record<string, TutorSession['phase']>> = {
  learning: 'study',
  study: 'study',
  preparing: 'preparing',
  summary: 'summary',
  check_plan: 'check_plan',
  check_answer: 'check_answer',
};

const preparationBoundSchema = z.object({
  packetVersion: z.string().min(1),
  problemHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.string().optional(),
});

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

@Injectable()
export class DatabaseTutorSessionPort implements TutorSessionPort {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async load(sessionId: string, ownerId?: string): Promise<TutorSession | null> {
    if (!ownerId || !/^[1-9]\d*$/.test(sessionId)) return null;
    const client = this.database.client;

    const session = await client
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('user_id', '=', ownerId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session || !(session.phase in PHASE_MAP)) return null;

    // preparation_bound 是「会话 ⇄ Packet」的唯一权威绑定。
    const boundEvent = await client
      .selectFrom('events')
      .select('payload_json')
      .where('session_id', '=', sessionId)
      .where('event_type', '=', 'preparation_bound')
      .where('invalidated', '=', 0)
      .orderBy('seq', 'desc')
      .executeTakeFirst();
    const bound = preparationBoundSchema.safeParse(parseJson(boundEvent?.payload_json));
    if (!bound.success || bound.data.status !== 'ready'
      || bound.data.problemHash !== createHash('sha256').update(session.problem_markdown).digest('hex')) {
      // 没有可用的 Packet 绑定，教学轮无法进行（决策图与 canonical goal 都无从推导）。
      // 显式返回 null，由调用方按「会话不存在/未就绪」处理，不编造一份空图。
      return null;
    }

    const packetRow = await client
      .selectFrom('packets')
      .select(['packet_json', 'problem_id', 'status'])
      .where('problem_hash', '=', Buffer.from(bound.data.problemHash, 'hex'))
      .where('version', '=', bound.data.packetVersion)
      .executeTakeFirst();

    const packetParsed = packetRow
      ? PacketSchema.safeParse(parseJson(packetRow.packet_json))
      : null;
    if (!packetParsed?.success || !packetParsed.data.ready || packetRow?.status !== 'ready'
      || packetParsed.data.problem_hash !== bound.data.problemHash || packetParsed.data.version !== bound.data.packetVersion) return null;
    const packet: Packet = packetParsed.data;

    const messages = await client
      .selectFrom('learning_messages')
      .select(['id', 'request_id', 'role', 'message_type', 'metadata_json', 'content_markdown', 'db_create_time'])
      .where('session_id', '=', sessionId)
      .orderBy('seq', 'asc')
      .execute();

    const privateMessages: PrivateMessage[] = messages.map((message) => ({
      id: message.request_id && (message.role === 'student' || message.role === 'guide')
        ? `${message.role === 'student' ? 'student' : 'teacher'}-${message.request_id}` : String(message.id),
      role: message.role === 'student' ? 'student' : message.role === 'teacher' || message.role === 'guide' ? 'teacher' : 'system',
      text_md: message.content_markdown,
      created_at: new Date(message.db_create_time).toISOString(),
    }));

    const transcriptIds = [...new Set(messages.flatMap(message => {
      if (message.role !== 'student' || message.message_type !== 'student_attempt') return [];
      const metadata = parseJson(message.metadata_json) as {transcriptId?: unknown} | null;
      return typeof metadata?.transcriptId === 'string' && /^[1-9]\d*$/.test(metadata.transcriptId)
        ? [metadata.transcriptId] : [];
    }))];
    const transcripts = transcriptIds.length ? await client.selectFrom('transcripts').selectAll()
      .where('id', 'in', transcriptIds)
      .where('user_id', '=', ownerId).where('expires_at', '>', new Date())
      .where(eb => eb.or([eb('session_id', '=', sessionId), eb('session_id', 'is', null)])).execute() : [];
    const submissions: Submission[] = messages.flatMap((message, index) => {
      if (message.role !== 'student' || message.message_type !== 'student_attempt') return [];
      const metadata = parseJson(message.metadata_json) as {transcriptId?:string; transcriptRevision?:number} | null;
      const transcriptId = metadata?.transcriptId ?? null;
      const revision = metadata?.transcriptRevision ?? 1;
      const current = transcripts.find(row => String(row.id) === transcriptId);
      const lines = current ? TranscriptLineSchema.array().parse(parseJson(current.lines_json)) : [];
      const confirmed = !transcriptId || Boolean(current && current.confirmed === 1 && current.revision === revision
        && lines.map(line => line.text.trim()).filter(Boolean).join('\n\n') === message.content_markdown.trim());
      return [{id:privateMessages[index]!.id, task_id:packet.problem_id, revision, text_md:message.content_markdown,
        source:transcriptId ? 'handwriting' : 'typed', media_id:current?.media_id ?? null, transcript_id:transcriptId,
        confirmed, invalidated:!confirmed, created_at:privateMessages[index]!.created_at}];
    });
    const events = await client.selectFrom('events')
      .select(['id', 'subject_id', 'event_type', 'payload_json', 'invalidated', 'db_create_time'])
      .where('session_id', '=', sessionId)
      .where('event_type', 'in', ['help_exposed', 'diagnostic_probe_shown', 'checked_teaching_turn'])
      .orderBy('seq', 'asc').execute();
    const restored = restorePersistedTeaching(packet.problem_id, bound.data.problemHash, packet.decisions, events, submissions);
    const counters = await client.selectFrom('probe_counters').select(['canonical_goal_key', 'shown_count'])
      .where('session_id', '=', sessionId).where('task_id', '=', packet.problem_id).execute();
    const registry = new CanonicalGoalRegistry();
    registry.register(packet.problem_id, packet.decisions);
    const canonicalKeys = new Set(packet.decisions.map(decision => registry.resolve(packet.problem_id, decision)));
    for (const counter of counters) {
      if (!canonicalKeys.has(counter.canonical_goal_key) || !Number.isInteger(counter.shown_count)
        || counter.shown_count < 0 || counter.shown_count > 2) {
        throw new ServiceUnavailableException('persisted probe counters require reconciliation');
      }
      restored.teachingState.probesShownByGoal[counter.canonical_goal_key] = Math.max(counter.shown_count,
        restored.teachingState.probesShownByGoal[counter.canonical_goal_key] ?? 0);
    }

    return {
      id: String(session.id),
      version: session.version,
      phase: PHASE_MAP[session.phase]!,
      packetVersion: bound.data.packetVersion,
      decisions: packet.decisions,
      routes: packet.routes,
      referenceMd: packet.reference_md,
      checkTask: packet.check_tasks[0] ?? null,
      messages: privateMessages,
      // 题库元数据待通过 A 的读取接口关联；不得据此判断是否真题。
      problem: {
        id: packet.problem_id,
        bank_version: 'session-bound',
        source: '',
        is_official: false,
        statement_md: session.problem_markdown,
        asset_ids: [],
        content_hash: bound.data.problemHash,
        status: 'ready',
        issues: [],
        topic_tags: [],
      },
      // 教学事实已恢复，独立检验状态仍待 Assessment 门面对接。
      currentGoalKey: restored.currentGoalKey,
      teachingState: restored.teachingState,
      submissions,
      attempt: null,
      notice: '',
      canStartCheck: false,
    };
  }

  /** No split version-only write: production submits only through LearningSessionService.commitTurn. */
  async save(): Promise<boolean> {
    throw new ServiceUnavailableException('use the atomic learning transaction');
  }

  /** 供健康检查/诊断使用：确认 binding 链是否可达（不返回私有内容）。 */
  async hasPacketBinding(sessionId: string): Promise<boolean> {
    const row = await this.database.client
      .selectFrom('events')
      .select(sql<number>`count(*)`.as('count'))
      .where('session_id', '=', sessionId)
      .where('event_type', '=', 'preparation_bound')
      .where('invalidated', '=', 0)
      .executeTakeFirst();
    return Number(row?.count ?? 0) > 0;
  }
}
