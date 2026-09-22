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
// 【两处已知降级，来自 A 的会话模型不含对应字段，均已在此显式注明】
//
// 1. Problem.bank_version / source 无从取得，用固定占位；is_official 一律 false。
//    项目方明确决定不做题库表 join。**因此 is_official 不可作为「是否真题」的依据**
//    —— 它恒为 false，无法区分真题与自拟题。前端据此隐藏了对应标签，避免把真题
//    显示成自拟题。
//
// 2. currentGoalKey / attempt / notice / canStartCheck 在 A 的模型里没有对应物，
//    返回保守值（null / false / 空串）。B03 的探针与检验状态因此暂不可用。
//
// 本文件只读；写入（提交一轮后的消息落库）见 save() 的说明。

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { PacketSchema, type Packet } from '../../contracts/domain.schema.js';
import { DatabaseService } from '../../database/database.service.js';
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

  async load(sessionId: string): Promise<TutorSession | null> {
    const client = this.database.client;

    const session = await client
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!session) return null;

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
    if (!bound.success) {
      // 没有可用的 Packet 绑定，教学轮无法进行（决策图与 canonical goal 都无从推导）。
      // 显式返回 null，由调用方按「会话不存在/未就绪」处理，不编造一份空图。
      return null;
    }

    const packetRow = await client
      .selectFrom('packets')
      .select(['packet_json', 'problem_id'])
      .where('problem_hash', '=', Buffer.from(bound.data.problemHash, 'hex') as never)
      .where('version', '=', bound.data.packetVersion)
      .executeTakeFirst();

    const packetParsed = packetRow
      ? PacketSchema.safeParse(parseJson(packetRow.packet_json))
      : null;
    if (!packetParsed?.success) return null;
    const packet: Packet = packetParsed.data;

    const messages = await client
      .selectFrom('learning_messages')
      .select(['id', 'role', 'content_markdown', 'db_create_time'])
      .where('session_id', '=', sessionId)
      .orderBy('seq', 'asc')
      .execute();

    const privateMessages: PrivateMessage[] = messages.map((message) => ({
      id: String(message.id),
      role: message.role === 'student' ? 'student' : message.role === 'teacher' ? 'teacher' : 'system',
      text_md: message.content_markdown,
      created_at: new Date(message.db_create_time as unknown as string).toISOString(),
    }));

    return {
      id: String(session.id),
      version: session.version,
      phase: PHASE_MAP[session.phase] ?? 'study',
      packetVersion: bound.data.packetVersion,
      decisions: packet.decisions,
      messages: privateMessages,
      // 见文件头「降级 1」：A 的会话模型不含这些字段，用占位值。
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
      // 见文件头「降级 2」：无对应物，返回保守值。
      currentGoalKey: null,
      attempt: null,
      notice: '',
      canStartCheck: false,
    };
  }

  /**
   * 提交一轮后的写入。
   *
   * **当前实现为版本号乐观推进，不写 learning_messages。** 理由：消息内容由
   * B 的 checked commit 产出，而真正的落库应当与 run/lease/事件同事务——那需要
   * A 的 StorePort 门面（尚未交付，见 B01 步骤 5/6）。此处只保证「同一会话的
   * 并发提交不会双写」：版本对不上就拒绝，由调用方重新读取。
   *
   * 这是一个**不完整**的实现，已在交接中记明；不得据此声称教学轮已持久化。
   */
  async save(session: TutorSession, expectedVersion: number): Promise<boolean> {
    const result = await this.database.client
      .updateTable('sessions')
      .set({ version: session.version })
      .where('id', '=', session.id)
      .where('version', '=', expectedVersion)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
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
